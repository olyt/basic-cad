import { describe, expect, it } from 'vitest'
import { createLine } from '../geometry/curve'
import { type DocumentSettings } from './change-set'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import { createHistoryEntry, type HistoryChange } from './history-entry'
import { createIdState, parseId } from './id'
import { restoreHistoryChange } from './restore-history-change'
import { type DrawingDocument } from './schema'

const { document: empty } = createEmptyDocument(createIdState('restore', 0), {
    modelTolerance: { distance: 0.125 },
})
const zero = empty.layers[0]!
const gap = {
    type: 'polyline',
    closed: false,
    segments: [
        createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
        createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 }),
    ],
}
const before = admitDocument({
    ...empty,
    revision: 7,
    layers: [
        zero,
        ...[1, 2].map((index) => ({
            ...zero,
            id: `layer:old:${index}`,
            name: `L${index}`,
        })),
    ],
    sources: [0, 1, 2].map((index) => ({
        id: `source:old:${index}`,
        format: 'dxf',
        fileName: `${index}.dxf`,
        version: 'AC1015',
    })),
    entities: [0, 1, 2].map((index) => ({
        ...empty.defaults,
        id: `entity:old:${index}`,
        layerId: index === 1 ? 'layer:old:1' : zero.id,
        geometry:
            index === 2 ? gap : createLine({ x: -0, y: 0 }, { x: 1, y: 0 }),
        source: { sourceId: `source:old:${index}`, handle: 'AA' },
    })),
})
const after = admitDocument({
    ...before,
    revision: Number.MAX_SAFE_INTEGER,
    units: 'unitless',
    modelTolerance: { distance: 0.0625 },
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
        {
            ...before.entities[2],
            source: undefined,
            geometry: createLine({ x: 0, y: 0 }, { x: 2, y: 0 }),
        },
        {
            ...before.entities[1],
            id: 'entity:new:0',
            layerId: 'layer:new:0',
            source: { sourceId: 'source:new:0' },
        },
    ],
})
const entry = createHistoryEntry(before, after)
const identical = { ...before, revision: 8 }
const unchanged = createHistoryEntry(before, identical).undo
const groups = ['entities', 'layers', 'sources'] as const
const headerOverrides = { id: 'ignored', schemaVersion: 99, revision: 99 }

function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
}

function expectDetached(actual: unknown, original: unknown): void {
    if (typeof original !== 'object' || original === null) {
        return
    }

    expect(actual).not.toBe(original)

    for (const [key, value] of Object.entries(original)) {
        expectDetached((actual as Record<string, unknown>)[key], value)
    }
}

function restore(patch: Partial<HistoryChange>) {
    return restoreHistoryChange(
        freeze(identical),
        freeze({ ...unchanged, ...patch }),
    )
}

describe('ordered history restoration', () => {
    it('undoes and redoes all groups, exact order and settings with their original revisions', () => {
        const change = freeze({
            ...entry.undo,
            settings: { ...entry.undo.settings, ...headerOverrides },
        })
        const restored = restoreHistoryChange(freeze(after), change)
        const redone = restoreHistoryChange(
            freeze(restored),
            freeze(entry.redo),
        )

        expect(restored).toEqual(before)
        expect(redone).toEqual(after)
        expect(restored).not.toBe(after)

        for (const group of groups) {
            expect(restored[group]).not.toBe(after[group])
            expectDetached(restored[group][0], after[group][0])
            expectDetached(restored[group][1], change[group].creates[0])
            expectDetached(restored[group][2], change[group].updates[0])
        }

        expectDetached(restored.defaults, change.settings.defaults)
        expectDetached(restored.modelTolerance, change.settings.modelTolerance)
        expect(after.entities[1]!.source).toBeUndefined()
        expect(before.entities[2]!.geometry).toEqual(gap)
    })

    it.each([false, true])('restores order-only states: %s', (reorder) => {
        const source = { ...before, revision: 0 }
        const order = reorder ? [2, 1, 0] : [0, 1, 2]
        const target = {
            ...source,
            revision: 1,
            entities: order.map((index) => source.entities[index]!),
            layers: order.map((index) => source.layers[index]!),
            sources: order.map((index) => source.sources[index]!),
        }
        const changes = createHistoryEntry(source, target)

        expect(restoreHistoryChange(target, changes.undo)).toEqual(source)
        expect(restoreHistoryChange(source, changes.redo)).toEqual(target)
    })

    it.each([
        { documentId: parseId('document', 'document:other:0') },
        { baseRevision: 7 },
        { baseRevision: 9 },
        { baseRevision: '8' },
        { targetRevision: 8 },
        { targetRevision: -1 },
        { targetRevision: 0.5 },
        { targetRevision: NaN },
        { targetRevision: Infinity },
        { targetRevision: Number.MAX_SAFE_INTEGER + 1 },
        { targetRevision: '7' },
    ])('rejects invalid metadata %j', (patch) => {
        expect(() => restore(patch as Partial<HistoryChange>)).toThrow(
            RangeError,
        )
    })

    it('validates the complete current snapshot before an inverse could repair it', () => {
        const invalid = {
            ...after,
            units: 'unsupported',
        } as unknown as DrawingDocument

        expect(() => restoreHistoryChange(invalid, entry.undo)).toThrow(
            RangeError,
        )
    })

    it('requires every top-level history field even for unchanged record values', () => {
        for (const key of Object.keys(unchanged)) {
            const invalid: Record<string, unknown> = { ...unchanged }

            delete invalid[key]
            expect(() =>
                restoreHistoryChange(
                    identical,
                    invalid as unknown as HistoryChange,
                ),
            ).toThrow(RangeError)
        }
    })

    it.each(groups)('requires every %s list', (group) => {
        for (const field of ['creates', 'updates', 'deletes']) {
            const value = { ...unchanged[group], [field]: undefined }

            expect(() => restore({ [group]: value })).toThrow(RangeError)
        }
    })

    it('requires a complete settings bundle', () => {
        for (const key of Object.keys(unchanged.settings)) {
            const partial: Record<string, unknown> = { ...unchanged.settings }

            delete partial[key]
            expect(() =>
                restore({ settings: partial as unknown as DocumentSettings }),
            ).toThrow(RangeError)
        }
    })

    it.each(groups)('validates complete %s order', (group) => {
        const ids = unchanged.order[group]
        const sparse = Object.assign(Array<unknown>(ids.length), {
            0: ids[0],
            2: ids[2],
        })
        const orders = [
            undefined,
            null,
            {},
            [],
            [...ids, ids[0]],
            [ids[0], ids[0], ids[2]],
            [ids[0], ids[1]!.replace(':', ':missing-'), ids[2]],
            [ids[0], 42, ids[2]],
            sparse,
        ]

        for (const order of orders) {
            expect(() =>
                restore({ order: { ...unchanged.order, [group]: order } }),
            ).toThrow('History order')
        }
    })

    it.each([
        {
            settings: {
                ...unchanged.settings,
                defaults: {
                    ...unchanged.settings.defaults,
                    layerId: parseId('layer', 'layer:missing:0'),
                },
            },
        },
        {
            layers: {
                ...unchanged.layers,
                updates: [{ ...before.layers[2]!, name: ' l1 ' }],
            },
        },
        {
            settings: {
                ...unchanged.settings,
                modelTolerance: { distance: 0.0625 },
            },
        },
    ])('rejects invalid complete targets: %j', (patch) => {
        expect(() => restore(patch)).toThrow(RangeError)
        expect(identical.entities).toEqual(before.entities)
        expect(unchanged.targetRevision).toBe(7)
    })
})
