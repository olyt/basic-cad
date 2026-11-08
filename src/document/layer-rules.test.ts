import { describe, expect, it } from 'vitest'
import { createLine } from '../geometry/curve'
import { applyChangeSet } from './apply-change-set'
import { type ChangeSet, type DocumentSettings } from './change-set'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import { createHistoryEntry } from './history-entry'
import { createIdState, parseId } from './id'
import { restoreHistoryChange } from './restore-history-change'
import { type Layer } from './schema'

const { document: empty } = createEmptyDocument(createIdState('rules', 0), {
    modelTolerance: { distance: 1e-7 },
})
const zero = empty.layers[0]!

function layer(name: string, properties: Partial<Layer> = {}): Layer {
    return {
        ...zero,
        id: parseId('layer', `layer:${name}:0`),
        name,
        ...properties,
    }
}

const work = layer('Work')
const target = layer('Target')
const locked = layer('Locked', { locked: true })
const frozen = layer('Frozen', { frozen: true, visible: false })
const document = admitDocument({
    ...empty,
    revision: 4,
    defaults: { ...empty.defaults, layerId: work.id },
    layers: [zero, work, target, locked, frozen],
    entities: [work, locked].map(({ id }, index) => ({
        ...empty.defaults,
        id: `entity:rules:${index}`,
        layerId: id,
        geometry: createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
    })),
})
const entity = document.entities[0]!
const lockedEntity = document.entities[1]!
const created = { ...entity, id: parseId('entity', 'entity:new:0') }
const replacement = layer('Replacement', { name: '0' })

function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
}

function select(current: Layer): DocumentSettings {
    return {
        units: document.units,
        modelTolerance: document.modelTolerance,
        defaultLineweight: document.defaultLineweight,
        defaults: { ...document.defaults, layerId: current.id },
    }
}

function apply(changes: Partial<ChangeSet>) {
    return applyChangeSet(
        freeze(document),
        freeze({
            documentId: document.id,
            baseRevision: document.revision,
            ...changes,
        }),
    )
}

describe('layer edit rules', () => {
    it.each([
        { deletes: [zero.id], creates: [replacement] },
        { updates: [{ ...zero, name: 'Renamed' }], creates: [replacement] },
        {
            updates: [
                { ...zero, name: work.name },
                { ...work, name: '0' },
            ],
        },
    ])(
        'protects the original layer 0 identity despite a valid final replacement: %j',
        (layers) => {
            expect(() => apply({ layers })).toThrow('Layer 0')
            expect(document.layers[0]).toEqual(zero)
            expect(document.revision).toBe(4)
        },
    )

    it('permits other layer 0 properties on a noncurrent layer', () => {
        const changed = {
            ...zero,
            visible: false,
            frozen: true,
            locked: true,
            lineweight: 50 as const,
        }
        const result = apply({ layers: { updates: [changed] } })

        expect(result.layers[0]).toEqual(changed)
        expect(result.revision).toBe(5)
    })

    it.each([
        {
            name: 'create',
            entities: { creates: [{ ...created, layerId: locked.id }] },
        },
        { name: 'identical update', entities: { updates: [lockedEntity] } },
        { name: 'delete', entities: { deletes: [lockedEntity.id] } },
        {
            name: 'move in',
            entities: { updates: [{ ...entity, layerId: locked.id }] },
        },
        {
            name: 'move out',
            entities: { updates: [{ ...lockedEntity, layerId: target.id }] },
        },
    ])(
        'rejects $name on a locked layer, including a same-batch unlock',
        ({ entities }) => {
            expect(() => apply({ entities })).toThrow(/locked/i)
            expect(() =>
                apply({
                    entities,
                    layers: { updates: [{ ...locked, locked: false }] },
                }),
            ).toThrow(/locked/i)
            expect(document.revision).toBe(4)
        },
    )

    it.each([
        { creates: [created] },
        { updates: [entity] },
        { deletes: [entity.id] },
        { updates: [{ ...entity, layerId: target.id }] },
    ])(
        'rejects edits while the source or destination becomes locked: %j',
        (entities) => {
            expect(() =>
                apply({
                    entities,
                    layers: { updates: [{ ...work, locked: true }] },
                }),
            ).toThrow(/locked/i)
        },
    )

    it.each([target, layer('New')])(
        'rejects edits into locked new or existing $name layers',
        (destination) => {
            const operation =
                destination.id === target.id ? 'updates' : 'creates'
            const layers = { [operation]: [{ ...destination, locked: true }] }

            expect(() =>
                apply({
                    layers,
                    entities: {
                        creates: [{ ...created, layerId: destination.id }],
                    },
                }),
            ).toThrow(/locked/i)
            expect(() =>
                apply({
                    layers,
                    entities: {
                        updates: [{ ...entity, layerId: destination.id }],
                    },
                }),
            ).toThrow(/locked/i)
        },
    )

    it('permits locked-layer metadata and unrelated editing/settings without touching locked entities', () => {
        const changed = {
            ...locked,
            visible: false,
            frozen: true,
            lineweight: 50 as const,
        }
        const result = apply({
            layers: { updates: [changed] },
            entities: { updates: [{ ...entity, lineweight: 50 }] },
            settings: { ...select(work), units: 'inches' },
        })

        expect(result.layers.find(({ id }) => id === locked.id)).toEqual(
            changed,
        )
        expect(result.entities[1]).toEqual(lockedEntity)
        expect(result.entities[0]!.lineweight).toBe(50)
        expect(result.units).toBe('inches')
    })

    it.each([
        { entities: { deletes: [entity.id] } },
        { settings: select(target) },
    ])(
        'refuses deletion while an entity or defaults still references the layer: %j',
        (changes) => {
            expect(() =>
                apply({ ...changes, layers: { deletes: [work.id] } }),
            ).toThrow(RangeError)
        },
    )

    it.each([
        { updates: [{ ...entity, layerId: target.id }] },
        { deletes: [entity.id] },
    ])(
        'permits deleting a layer after all final users are moved or deleted: %j',
        (entities) => {
            const result = apply({
                entities,
                layers: { deletes: [work.id] },
                settings: select(target),
            })

            expect(result.layers.some(({ id }) => id === work.id)).toBe(false)
            expect(result.defaults.layerId).toBe(target.id)
        },
    )

    it.each([
        { layers: { updates: [{ ...work, frozen: true }] } },
        { settings: select(frozen) },
        {
            settings: select(target),
            layers: { updates: [{ ...target, frozen: true }] },
        },
    ])('refuses a frozen final current layer: %j', (changes) => {
        expect(() => apply(changes)).toThrow(/current layer.*frozen/i)
    })

    it('rejects a frozen current layer at admission before a batch could thaw it', () => {
        const invalid = {
            ...document,
            defaults: { ...document.defaults, layerId: frozen.id },
        }
        const changes = {
            documentId: document.id,
            baseRevision: 4,
            layers: { updates: [{ ...frozen, frozen: false }] },
        }

        expect(() => admitDocument(invalid)).toThrow(/current layer.*frozen/i)
        expect(() => applyChangeSet(invalid, changes)).toThrow(
            /current layer.*frozen/i,
        )
    })

    it('evaluates current-layer freezing and thawing against the final snapshot', () => {
        const result = apply({
            settings: select(target),
            layers: { updates: [{ ...work, frozen: true, visible: false }] },
        })
        const thawed = apply({
            settings: select(frozen),
            layers: { updates: [{ ...frozen, frozen: false, visible: true }] },
        })

        expect(result.defaults.layerId).toBe(target.id)
        expect(result.layers.find(({ id }) => id === work.id)!.frozen).toBe(
            true,
        )
        expect(thawed.defaults.layerId).toBe(frozen.id)
    })

    it('replays exact entity and lock-flag transitions without forward-edit permission checks', () => {
        const updated = {
            ...entity,
            geometry: createLine({ x: 0, y: 0 }, { x: 2, y: 0 }),
        }
        const layers = document.layers.map((current) =>
            current.id === work.id ? { ...current, locked: true } : current,
        )
        const after = admitDocument({
            ...document,
            revision: 5,
            layers,
            entities: [updated, lockedEntity],
        })
        const entry = createHistoryEntry(document, after)

        expect(() =>
            apply({
                entities: { updates: [updated] },
                layers: { updates: [{ ...work, locked: true }] },
            }),
        ).toThrow(/locked/i)

        const restored = restoreHistoryChange(freeze(after), freeze(entry.undo))

        expect(restored).toEqual(document)
        expect(restoreHistoryChange(restored, entry.redo)).toEqual(after)
    })
})
