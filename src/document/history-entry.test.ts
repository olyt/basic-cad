import { describe, expect, it } from 'vitest'
import { createArc, createLine, type Curve } from '../geometry/curve'
import { type DocumentSettings } from './change-set'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import { createHistoryEntry } from './history-entry'
import { createIdState, parseId } from './id'
import { type DrawingDocument } from './schema'

const { document: empty } = createEmptyDocument(createIdState('base', 0), {
    modelTolerance: { distance: 1e-7 },
})
const zero = empty.layers[0]!
const before = admitDocument({
    ...empty,
    revision: 7,
    layers: [
        zero,
        ...[1, 2].map((index) => ({
            ...zero,
            id: `layer:history:${index}`,
            name: `L${index}`,
        })),
    ],
    sources: [0, 1, 2].map((index) => ({
        id: `source:history:${index}`,
        format: 'dxf',
        fileName: `${index}.dxf`,
        version: 'AC1015',
    })),
    entities: [0, 1, 2].map((index) => ({
        ...empty.defaults,
        id: `entity:history:${index}`,
        layerId: index === 1 ? 'layer:history:1' : zero.id,
        geometry: createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
        source: { sourceId: `source:history:${index}`, handle: 'AA' },
    })),
})
const after = admitDocument({
    ...before,
    revision: 11,
    units: 'unitless',
    modelTolerance: { distance: 0.125 },
    defaultLineweight: 50,
    defaults: { ...before.defaults, layerId: 'layer:new:0' },
    layers: [
        zero,
        { ...before.layers[2], name: 'Changed' },
        { ...zero, id: 'layer:new:0', name: 'New' },
    ],
    sources: [
        before.sources[0],
        { ...before.sources[2], version: undefined },
        { ...before.sources[0], id: 'source:new:0' },
    ],
    entities: [
        before.entities[0],
        { ...before.entities[2], source: undefined },
        {
            ...before.entities[1],
            id: 'entity:new:0',
            layerId: 'layer:new:0',
            source: { sourceId: 'source:new:0' },
        },
    ],
})
const groups = ['entities', 'layers', 'sources'] as const
const noChanges = { creates: [], updates: [], deletes: [] }

function settings(document: DrawingDocument): DocumentSettings {
    const { units, modelTolerance, defaultLineweight, defaults } = document

    return { units, modelTolerance, defaultLineweight, defaults }
}

function withCurve(geometry: Curve, revision = before.revision) {
    return {
        ...before,
        revision,
        entities: [{ ...before.entities[0]!, geometry }],
    }
}

describe('history entry construction', () => {
    it('captures inverse and redo records, settings and middle-deletion order in every group', () => {
        const { undo, redo } = createHistoryEntry(before, after)

        expect(undo).toMatchObject({
            documentId: before.id,
            baseRevision: 11,
            targetRevision: 7,
        })
        expect(redo).toMatchObject({
            documentId: before.id,
            baseRevision: 7,
            targetRevision: 11,
        })
        expect(undo.settings).toEqual(settings(before))
        expect(redo.settings).toEqual(settings(after))

        for (const group of groups) {
            expect(redo[group]).toEqual({
                creates: [after[group][2]],
                updates: [after[group][1]],
                deletes: [before[group][1]!.id],
            })
            expect(undo[group]).toEqual({
                creates: [before[group][1]],
                updates: [before[group][2]],
                deletes: [after[group][2]!.id],
            })
            expect(undo.order[group]).toEqual(before[group].map(({ id }) => id))
            expect(redo.order[group]).toEqual(after[group].map(({ id }) => id))
            expect(undo[group].creates[0]).not.toBe(before[group][1])
            expect(redo[group].updates[0]).not.toBe(after[group][1])
        }

        expect(redo.entities.updates[0]).not.toHaveProperty('source')
        expect(undo.entities.updates[0]!.source).toEqual(
            before.entities[2]!.source,
        )
        expect(redo.sources.updates[0]).not.toHaveProperty('version')
        expect(undo.sources.updates[0]!.version).toBe('AC1015')
        expect(undo.settings.defaults).not.toBe(before.defaults)
        expect(redo.settings.modelTolerance).not.toBe(after.modelTolerance)
    })

    it.each([false, true])('captures order separately: %s', (reordered) => {
        const order = reordered ? [2, 1, 0] : [0, 1, 2]
        const target = {
            ...before,
            revision: Number.MAX_SAFE_INTEGER,
            entities: order.map((index) => before.entities[index]!),
            layers: order.map((index) => before.layers[index]!),
            sources: order.map((index) => before.sources[index]!),
        }
        const { undo, redo } = createHistoryEntry(before, target)

        expect(redo.targetRevision).toBe(Number.MAX_SAFE_INTEGER)

        for (const group of groups) {
            expect(undo[group]).toEqual(noChanges)
            expect(redo[group]).toEqual(noChanges)
            expect(undo.order[group]).toEqual(before[group].map(({ id }) => id))
            expect(redo.order[group]).toEqual(target[group].map(({ id }) => id))
        }
    })

    it('captures admitted arc values and remains independent of later input mutations', () => {
        const oldGeometry = {
            type: 'arc' as const,
            center: { x: 0, y: 0 },
            radius: 2,
            startAngle: -0.25,
            sweep: -0.5,
        }
        const newGeometry = {
            ...oldGeometry,
            center: { x: 0, y: 0 },
            startAngle: -0.5,
            extra: true,
        }
        const input = withCurve(oldGeometry)
        const target = withCurve(newGeometry, 8)
        const entry = createHistoryEntry(input, target)
        const expectedOld = createArc(oldGeometry)
        const expectedNew = createArc(newGeometry)

        oldGeometry.center.x = 100
        newGeometry.center.x = 200
        expect(entry.undo.entities.updates[0]!.geometry).toEqual(expectedOld)
        expect(entry.redo.entities.updates[0]!.geometry).toEqual(expectedNew)
    })

    it('captures a geometry update differing only by signed zero', () => {
        const oldGeometry = createLine({ x: -0, y: 0 }, { x: 1, y: 0 })
        const newGeometry = createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
        const { undo, redo } = createHistoryEntry(
            withCurve(oldGeometry),
            withCurve(newGeometry, 8),
        )

        expect(undo.entities.updates).toHaveLength(1)
        expect(redo.entities.updates).toHaveLength(1)
        expect(undo.entities.updates[0]!.geometry).toEqual(oldGeometry)
        expect(redo.entities.updates[0]!.geometry).toEqual(newGeometry)
    })

    it('captures cyclic polyline segment order even when the closed locus is unchanged', () => {
        const a = { x: 0, y: 0 }
        const b = { x: 1, y: 0 }
        const c = { x: 0, y: 1 }
        const segments = [createLine(a, b), createLine(b, c), createLine(c, a)]
        const oldGeometry = {
            type: 'polyline' as const,
            closed: true,
            segments,
        }
        const newGeometry = {
            ...oldGeometry,
            segments: [segments[1]!, segments[2]!, segments[0]!],
        }
        const { undo, redo } = createHistoryEntry(
            withCurve(oldGeometry),
            withCurve(newGeometry, 8),
        )

        expect(undo.entities.updates[0]!.geometry).toEqual(oldGeometry)
        expect(redo.entities.updates[0]!.geometry).toEqual(newGeometry)
    })

    it('validates both full snapshots before constructing an entry', () => {
        const invalid = {
            ...before,
            units: 'unsupported',
        } as unknown as DrawingDocument

        expect(() => createHistoryEntry(invalid, after)).toThrow(RangeError)
        expect(() =>
            createHistoryEntry(before, { ...invalid, revision: 11 }),
        ).toThrow(RangeError)
    })

    it('rejects snapshots belonging to different documents', () => {
        const target = { ...after, id: parseId('document', 'document:other:0') }

        expect(() => createHistoryEntry(before, target)).toThrow(RangeError)
    })

    it.each([7, 6])('rejects nonadvancing revision %s', (revision) => {
        expect(() =>
            createHistoryEntry(before, { ...after, revision }),
        ).toThrow(RangeError)
    })
})
