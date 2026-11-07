import { describe, expect, it, vi } from 'vitest'
import { createLine } from '../geometry/curve'
import { applyChangeSet } from './apply-change-set'
import { type ChangeSet, type DocumentSettings } from './change-set'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import { createIdState, parseId } from './id'

const { document: empty } = createEmptyDocument(createIdState('apply', 0), {
    modelTolerance: { distance: 1e-7 },
})
const document = admitDocument({
    ...empty,
    revision: 7,
    layers: [
        empty.layers[0],
        { ...empty.layers[0], id: 'layer:apply:2', name: 'Old' },
    ],
    entities: [0, 1].map((index) => ({
        ...empty.defaults,
        id: `entity:apply:${index}`,
        layerId: 'layer:apply:2',
        geometry: createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
        source: { sourceId: 'source:apply:0' },
    })),
    sources: [0, 1].map((index) => ({
        id: `source:apply:${index}`,
        format: 'dxf',
        fileName: 'Old.dxf',
    })),
    defaults: { ...empty.defaults, layerId: 'layer:apply:2' },
})
const zero = document.layers[0]!
const oldLayer = document.layers[1]!
const first = document.entities[0]!
const second = document.entities[1]!
const oldSource = document.sources[0]!
const spareSource = document.sources[1]!
const settings: DocumentSettings = {
    units: document.units,
    modelTolerance: document.modelTolerance,
    defaultLineweight: document.defaultLineweight,
    defaults: document.defaults,
}
const newLayer = {
    ...oldLayer,
    id: parseId('layer', 'layer:new:0'),
    name: 'New',
}

function commit(changes: Partial<ChangeSet>, input = document) {
    return applyChangeSet(input, {
        documentId: input.id,
        baseRevision: input.revision,
        ...changes,
    })
}

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

describe('atomic drawing change sets', () => {
    it('applies all record groups and settings once, resolving forward references', () => {
        const source = { ...oldSource, id: parseId('source', 'source:new:0') }
        const created = {
            ...first,
            id: parseId('entity', 'entity:new:0'),
            layerId: newLayer.id,
            source: { sourceId: source.id },
        }
        const updated = {
            ...first,
            layerId: newLayer.id,
            geometry: createLine({ x: 0, y: 0 }, { x: 2, y: 0 }),
        }
        const changedZero = { ...zero, locked: true }
        const changedSource = { ...oldSource, fileName: 'Updated.dxf' }
        const nextSettings: DocumentSettings = {
            ...settings,
            units: 'inches',
            modelTolerance: { distance: 0.125 },
            defaultLineweight: 50,
            defaults: { ...settings.defaults, layerId: newLayer.id },
        }
        const changes = freeze({
            entities: {
                creates: [created],
                updates: [updated],
                deletes: [second.id],
            },
            layers: {
                creates: [newLayer],
                updates: [changedZero],
                deletes: [oldLayer.id],
            },
            sources: {
                creates: [source],
                updates: [changedSource],
                deletes: [spareSource.id],
            },
            settings: {
                ...nextSettings,
                id: 'ignored',
                schemaVersion: 99,
                revision: 99,
            },
        })
        const result = commit(changes, freeze(document))

        expect(result).toEqual({
            ...document,
            ...nextSettings,
            revision: 8,
            entities: [updated, created],
            layers: [changedZero, newLayer],
            sources: [changedSource, source],
        })
        expectDetached(result.entities[1], created)
        expectDetached(result.layers[1], newLayer)
        expectDetached(result.sources[1], source)
        expectDetached(result.defaults, nextSettings.defaults)
        expectDetached(result.modelTolerance, nextSettings.modelTolerance)
        expect(document.entities).toEqual([first, second])
        expect(changes.entities.updates[0]).toBe(updated)
    })

    it.each([
        {},
        {
            entities: {},
            layers: { creates: [], updates: [], deletes: [] },
            sources: {},
            settings: undefined,
        },
    ])(
        'returns an independent no-op snapshot without changing revision: %j',
        (changes) => {
            const result = commit(changes, freeze(document))

            expect(result).toEqual(document)
            expectDetached(result, document)
        },
    )

    it.each([{ settings }, { entities: { updates: [first] } }])(
        'increments revision for supplied identical changes %j',
        (changes) => {
            expect(commit(changes)).toEqual({ ...document, revision: 8 })
        },
    )

    it.each([null, undefined, []])(
        'rejects malformed change-set metadata %j',
        (changes) => {
            expect(() =>
                applyChangeSet(document, changes as unknown as ChangeSet),
            ).toThrow(RangeError)
        },
    )

    it.each([
        { documentId: parseId('document', 'document:other:0') },
        { documentId: undefined },
        { baseRevision: 6 },
        { baseRevision: 8 },
        { baseRevision: undefined },
        { baseRevision: '7' },
    ])('requires exact drawing identity and base revision: %j', (changes) => {
        expect(() => commit(changes as Partial<ChangeSet>)).toThrow(RangeError)
    })

    it('rejects null replacement settings', () => {
        expect(() =>
            commit({ settings: null as unknown as DocumentSettings }),
        ).toThrow(RangeError)
    })

    it('requires all four settings fields rather than retaining missing old values', () => {
        for (const key of Object.keys(settings)) {
            const incomplete: Record<string, unknown> = { ...settings }

            delete incomplete[key]
            expect(() =>
                commit({ settings: incomplete as unknown as DocumentSettings }),
            ).toThrow(RangeError)
        }
    })

    it.each([
        { sources: { deletes: [oldSource.id] } },
        { layers: { deletes: [zero.id] } },
        { layers: { creates: [{ ...newLayer, name: ' old ' }] } },
        {
            entities: {
                updates: [
                    { ...first, layerId: parseId('layer', 'layer:missing:0') },
                ],
            },
        },
        {
            entities: { updates: [{ ...first, lineweight: 50 as const }] },
            sources: {
                creates: [
                    {
                        ...oldSource,
                        id: parseId('source', 'source:bad:0'),
                        fileName: '',
                    },
                ],
            },
        },
    ])(
        'rejects invalid batches without changing source data: %j',
        (changes) => {
            expect(() => commit(freeze(changes), freeze(document))).toThrow(
                RangeError,
            )
            expect(document.revision).toBe(7)
            expect(document.entities).toEqual([first, second])
        },
    )

    it('admits the complete source before a batch can delete an invalid record', () => {
        const invalid = {
            ...first,
            layerId: parseId('layer', 'layer:missing:0'),
        }
        const input = { ...document, entities: [invalid] }

        expect(() => commit({}, input)).toThrow(RangeError)
        expect(() =>
            commit({ entities: { deletes: [first.id] } }, input),
        ).toThrow(RangeError)
    })

    it('uses final tolerance for new curves and rechecks unchanged polyline joints', () => {
        const geometry = {
            type: 'polyline' as const,
            closed: false,
            segments: [
                createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
                createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 }),
            ],
        }
        const created = {
            ...first,
            id: parseId('entity', 'entity:gap:0'),
            geometry,
        }
        const loose = { ...settings, modelTolerance: { distance: 0.125 } }
        const tight = { ...settings, modelTolerance: { distance: 0.0625 } }
        const input = {
            ...document,
            modelTolerance: loose.modelTolerance,
            entities: [created],
        }
        const result = commit({
            settings: loose,
            entities: { creates: [created] },
        })

        expect(result.entities[2]!.geometry).toEqual(geometry)
        expect(() => commit({ settings: tight }, input)).toThrow(RangeError)
        expect(
            commit(
                { settings: tight, entities: { deletes: [created.id] } },
                input,
            ).entities,
        ).toEqual([])
    })

    it('allows exhausted no-ops but never wraps a changing revision', () => {
        const exhausted = { ...document, revision: Number.MAX_SAFE_INTEGER }

        expect(commit({}, exhausted).revision).toBe(Number.MAX_SAFE_INTEGER)
        expect(() => commit({ settings }, exhausted)).toThrow('exhausted')
        expect(
            commit(
                { settings },
                { ...document, revision: Number.MAX_SAFE_INTEGER - 1 },
            ).revision,
        ).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('reads supplied settings fields once before validating their values', () => {
        const getUnits = vi.fn(() => 'unitless' as const)
        const input = Object.defineProperty({ ...settings }, 'units', {
            get: getUnits,
        })

        expect(commit({ settings: input }).units).toBe('unitless')
        expect(getUnits).toHaveBeenCalledOnce()
    })
})
