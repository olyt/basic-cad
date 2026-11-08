import { describe, expect, it } from 'vitest'
import { createLine } from '../geometry/curve'
import { type ChangeSet, type DocumentSettings } from './change-set'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import {
    commitHistory,
    createHistory,
    redoHistory,
    undoHistory,
    type DocumentHistory,
    type HistoryOptions,
} from './history'
import { createIdState, parseId } from './id'

const { document: empty } = createEmptyDocument(createIdState('history', 0), {
    modelTolerance: { distance: 0.125 },
})
const document = admitDocument({
    ...empty,
    revision: 4,
    layers: [
        empty.layers[0],
        { ...empty.layers[0], id: 'layer:other:0', name: 'Other' },
    ],
    entities: [0, 1, 2].map((index) => ({
        ...empty.defaults,
        id: `entity:history:${index}`,
        geometry: createLine({ x: index, y: 0 }, { x: index, y: 1 }),
    })),
})

function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
}

function create(capacity = 3, highWaterRevision = document.revision) {
    return createHistory(freeze(document), { capacity, highWaterRevision })
}

function commit(history: DocumentHistory, changes: Partial<ChangeSet>) {
    return commitHistory(
        freeze(history),
        freeze({
            documentId: history.document.id,
            baseRevision: history.document.revision,
            ...changes,
        }),
    )
}

function advance(history: DocumentHistory) {
    return commit(history, {
        entities: { updates: [history.document.entities[0]!] },
    })
}

describe('bounded drawing history', () => {
    it('admits an independent document with explicit limits and empty stacks', () => {
        const history = create(2, 9)
        const fresh = createHistory(empty, {
            capacity: 0,
            highWaterRevision: 0,
        })

        expect(history).toMatchObject({
            capacity: 2,
            highWaterRevision: 9,
            document,
            undoStack: [],
            redoStack: [],
        })
        expect(history.document).not.toBe(document)
        expect(history.document.entities).not.toBe(document.entities)
        expect(history.document.entities[0]!.geometry).not.toBe(
            document.entities[0]!.geometry,
        )
        expect(fresh.highWaterRevision).toBe(0)
        expect(undoHistory(history)).toBe(history)
        expect(redoHistory(history)).toBe(history)
    })

    it('admits the whole source even when both checkpoint options are valid', () => {
        const invalid = {
            ...document,
            defaults: {
                ...document.defaults,
                layerId: parseId('layer', 'layer:missing:0'),
            },
        }

        expect(() =>
            createHistory(invalid, { capacity: 2, highWaterRevision: 9 }),
        ).toThrow(RangeError)
    })

    it.each([undefined, null, {}, { capacity: 2 }, { highWaterRevision: 0 }])(
        'requires both explicit options even at revision zero: %j',
        (options) => {
            expect(() =>
                createHistory(empty, options as unknown as HistoryOptions),
            ).toThrow(RangeError)
        },
    )

    it.each(['capacity', 'highWaterRevision'] as const)(
        'validates safe nonnegative %s',
        (field) => {
            for (const value of [
                undefined,
                null,
                -1,
                0.5,
                NaN,
                Infinity,
                Number.MAX_SAFE_INTEGER + 1,
                '4',
            ]) {
                const options = {
                    capacity: 3,
                    highWaterRevision: 4,
                    [field]: value,
                }

                expect(() =>
                    createHistory(document, options as HistoryOptions),
                ).toThrow(RangeError)
            }
        },
    )

    it('restores middle deletions, properties, layer flags and complete settings through multiple steps', () => {
        const initial = create()
        const deleted = commit(initial, {
            entities: { deletes: [document.entities[1]!.id] },
        })
        const settings: DocumentSettings = {
            units: 'inches',
            modelTolerance: { distance: 1e-6 },
            defaultLineweight: 100,
            defaults: { ...document.defaults, layerId: document.layers[1]!.id },
        }
        const changed = commit(deleted, {
            entities: {
                updates: [{ ...deleted.document.entities[1]!, lineweight: 50 }],
            },
            layers: {
                updates: [
                    { ...document.layers[1]!, visible: false, locked: true },
                ],
            },
            settings,
        })
        const firstUndo = undoHistory(freeze(changed))
        const secondUndo = undoHistory(freeze(firstUndo))
        const firstRedo = redoHistory(freeze(secondUndo))
        const secondRedo = redoHistory(freeze(firstRedo))

        expect(firstUndo.document).toEqual(deleted.document)
        expect(secondUndo.document).toEqual(initial.document)
        expect(firstRedo.document).toEqual(deleted.document)
        expect(secondRedo.document).toEqual(changed.document)
        expect(secondUndo.highWaterRevision).toBe(6)
        expect(secondRedo.highWaterRevision).toBe(6)
        expect(initial.document).toEqual(document)
        expect(changed.undoStack).toHaveLength(2)
    })

    it('branches from a recovered counter without reusing a discarded saved revision', () => {
        const first = advance(create(3, 40))
        const saved = advance(first)
        const undone = undoHistory(freeze(saved))
        const branch = advance(undone)

        expect(first.document.revision).toBe(41)
        expect(first.undoStack[0]!.redo.entities.updates).toEqual([])
        expect(undone.document).toEqual(first.document)
        expect(undone.highWaterRevision).toBe(42)
        expect(branch.document.revision).toBe(43)
        expect(branch.document.revision).not.toBe(saved.document.revision)
        expect(branch.redoStack).toEqual([])
        expect(redoHistory(branch)).toBe(branch)
        expect(undone.redoStack).toHaveLength(1)
    })

    it('preserves the exact redo state and counter after empty or rejected commits', () => {
        const history = freeze(undoHistory(advance(advance(create()))))
        const noOperations = { entities: {}, layers: {}, sources: {} }

        expect(commit(history, {})).toBe(history)
        expect(commit(history, noOperations)).toBe(history)

        for (const changes of [
            { baseRevision: 4 },
            { documentId: parseId('document', 'document:other:0') },
            { layers: { deletes: [document.layers[0]!.id] } },
        ]) {
            expect(() => commit(history, changes)).toThrow(RangeError)
        }

        expect(history.highWaterRevision).toBe(6)
        expect(history.document.revision).toBe(5)
        expect(history.redoStack).toHaveLength(1)
        expect(advance(history).document.revision).toBe(7)
    })

    it('evicts only the oldest undo entries and bounds total retained entries during navigation', () => {
        const first = advance(create(2))
        const second = advance(first)
        const third = advance(second)
        const once = undoHistory(freeze(third))
        const twice = undoHistory(freeze(once))
        const redone = redoHistory(freeze(redoHistory(freeze(twice))))

        expect(third.undoStack).toHaveLength(2)
        expect(once.document).toEqual(second.document)
        expect(twice.document).toEqual(first.document)
        expect(undoHistory(twice)).toBe(twice)
        expect(redone.document).toEqual(third.document)

        for (const state of [third, once, twice, redone]) {
            expect(state.undoStack.length + state.redoStack.length).toBe(2)
            expect(state.highWaterRevision).toBe(7)
        }
    })

    it('applies changes with capacity zero while retaining no undo or redo entries', () => {
        const initial = create(0)
        const changed = commit(initial, {
            entities: { deletes: [document.entities[1]!.id] },
        })

        expect(changed.document.entities.map(({ id }) => id)).toEqual([
            document.entities[0]!.id,
            document.entities[2]!.id,
        ])
        expect(changed.highWaterRevision).toBe(5)
        expect(changed.undoStack).toEqual([])
        expect(changed.redoStack).toEqual([])
        expect(undoHistory(changed)).toBe(changed)
        expect(redoHistory(changed)).toBe(changed)
    })

    it('keeps exhausted checkpoints through undo and allows no-op/navigation but no new branches', () => {
        const initial = create(2, Number.MAX_SAFE_INTEGER - 1)
        const final = advance(initial)
        const undone = undoHistory(freeze(final))

        expect(final.document.revision).toBe(Number.MAX_SAFE_INTEGER)
        expect(commit(final, {})).toBe(final)
        expect(undone.document).toEqual(initial.document)
        expect(undone.highWaterRevision).toBe(Number.MAX_SAFE_INTEGER)
        expect(commit(undone, {})).toBe(undone)
        expect(() => advance(undone)).toThrow('exhausted')
        expect(redoHistory(undone).document).toEqual(final.document)
        expect(undone.redoStack).toHaveLength(1)
    })

    it.each([{ capacity: -1 }, { highWaterRevision: 3 }])(
        'validates limit coherency before every operation: %j',
        (patch) => {
            const invalid = { ...create(), ...patch }

            expect(() => createHistory(document, invalid)).toThrow(RangeError)
            expect(() => commit(invalid, {})).toThrow(RangeError)
            expect(() => undoHistory(invalid)).toThrow(RangeError)
            expect(() => redoHistory(invalid)).toThrow(RangeError)
        },
    )
})
