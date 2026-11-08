import { describe, expect, it } from 'vitest'
import { createCircle } from '../geometry/curve'
import {
    all,
    brute,
    document,
    freeze,
    queries,
} from '../test-support/spatial-cases'
import { type ChangeSet } from './change-set'
import {
    createHistory,
    commitHistory,
    undoHistory,
    redoHistory,
} from './history'
import { applyIndexedChangeSet } from './indexed-change-set'
import { parseId } from './id'
import { createSpatialIndex, type SpatialIndex } from './spatial-index'

const moved = {
    ...document.entities[0]!,
    geometry: createCircle({ x: 5000, y: 5000 }, 20),
}
const created = {
    ...document.entities[0]!,
    id: parseId('entity', 'entity:added:0'),
    geometry: createCircle({ x: -5000, y: -5000 }, 10),
}

function apply(index: SpatialIndex, changes: Partial<ChangeSet>) {
    return applyIndexedChangeSet(
        freeze(index),
        freeze({
            documentId: index.document.id,
            baseRevision: index.document.revision,
            ...changes,
        }),
    )
}

describe('indexed drawing changes', () => {
    it('matches independent brute force on seeded mixed curves after record and metadata changes', () => {
        const initial = createSpatialIndex(document)
        const changed = apply(initial, {
            entities: {
                creates: [created],
                updates: [moved],
                deletes: [document.entities[4]!.id],
            },
        })
        const metadata = apply(changed, {
            layers: { updates: [{ ...document.layers[1]!, visible: true }] },
        })

        expect(changed.document.revision).toBe(1)
        expect(changed.document.entities[0]).toEqual(moved)
        expect(changed.document.entities.at(-1)).toEqual(created)
        expect(changed.query(all)).not.toContain(document.entities[4]!.id)
        expect(metadata.document.revision).toBe(2)
        expect(metadata.document.layers[1]!.visible).toBe(true)
        expect(metadata).not.toBe(changed)
        expect(apply(metadata, {})).toBe(metadata)

        for (const index of [changed, metadata]) {
            for (const query of queries) {
                expect(index.query(query)).toEqual(brute(index.document, query))
            }
        }
    })

    it('keeps the old document and query closure unchanged after failed batches', () => {
        const index = createSpatialIndex(document)
        const invalid = {
            ...moved,
            geometry: {
                type: 'circle' as const,
                center: { x: 0, y: 0 },
                radius: 0,
            },
        }

        for (const changes of [
            { baseRevision: -1 },
            { documentId: parseId('document', 'document:other:0') },
            { entities: { deletes: [document.entities[3]!.id] } },
            { entities: { creates: [created], updates: [invalid] } },
        ]) {
            expect(() => apply(index, changes)).toThrow(RangeError)
            expect(index.document).toEqual(document)
            expect(index.query(all)).toEqual(
                document.entities.map(({ id }) => id),
            )
        }
    })

    it('rebuilds exact undo, redo and branch snapshots without applying their changes twice', () => {
        const initial = createHistory(document, {
            capacity: 3,
            highWaterRevision: 0,
        })
        const request = {
            documentId: document.id,
            baseRevision: 0,
            entities: { updates: [moved] },
        }
        const changed = commitHistory(initial, request)
        const undone = undoHistory(changed)
        const branch = commitHistory(undone, {
            ...request,
            entities: { deletes: [document.entities[4]!.id] },
        })

        expect(branch.document.revision).toBe(2)

        for (const state of [changed, undone, redoHistory(undone), branch]) {
            const index = createSpatialIndex(state.document)

            expect(index.document.revision).toBe(state.document.revision)

            for (const query of queries) {
                expect(index.query(query)).toEqual(brute(state.document, query))
            }
        }
    })
})
