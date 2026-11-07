import {
    type ChangeSet,
    type DocumentSettings,
    type RecordChanges,
} from './change-set'
import { admitDocument } from './document-admission'
import {
    type DrawingDocument,
    type Entity,
    type Layer,
    type SourceFile,
} from './schema'

export interface DocumentOrder {
    readonly entities: readonly Entity['id'][]
    readonly layers: readonly Layer['id'][]
    readonly sources: readonly SourceFile['id'][]
}

export interface HistoryChange extends ChangeSet {
    readonly targetRevision: number
    readonly entities: Required<RecordChanges<Entity>>
    readonly layers: Required<RecordChanges<Layer>>
    readonly sources: Required<RecordChanges<SourceFile>>
    readonly settings: DocumentSettings
    readonly order: DocumentOrder
}

export interface HistoryEntry {
    readonly undo: HistoryChange
    readonly redo: HistoryChange
}

function sameData(first: unknown, second: unknown): boolean {
    if (Object.is(first, second)) {
        return true
    }

    if (typeof first !== 'object' || first === null) {
        return false
    }

    if (typeof second !== 'object' || second === null) {
        return false
    }

    if (Array.isArray(first) !== Array.isArray(second)) {
        return false
    }

    const a = first as Readonly<Record<string, unknown>>
    const b = second as Readonly<Record<string, unknown>>
    const keys = Object.keys(a)

    return (
        keys.length === Object.keys(b).length &&
        keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
    )
}

function recordChanges<Item extends { readonly id: string }>(
    before: readonly Item[],
    after: readonly Item[],
): Required<RecordChanges<Item>> {
    const previous = new Map(before.map((item) => [item.id, item]))
    const next = new Set(after.map((item) => item.id))

    return {
        creates: after.filter((item) => !previous.has(item.id)),
        updates: after.filter((item) => {
            const original = previous.get(item.id)

            return original !== undefined && !sameData(original, item)
        }),
        deletes: before
            .filter((item) => !next.has(item.id))
            .map((item) => item.id),
    }
}

function captureChange(
    source: DrawingDocument,
    target: DrawingDocument,
): HistoryChange {
    const { units, modelTolerance, defaultLineweight, defaults } = target

    return {
        documentId: source.id,
        baseRevision: source.revision,
        targetRevision: target.revision,
        entities: recordChanges(source.entities, target.entities),
        layers: recordChanges(source.layers, target.layers),
        sources: recordChanges(source.sources, target.sources),
        settings: { units, modelTolerance, defaultLineweight, defaults },
        order: {
            entities: target.entities.map((entity) => entity.id),
            layers: target.layers.map((layer) => layer.id),
            sources: target.sources.map((file) => file.id),
        },
    }
}

export function createHistoryEntry(
    before: DrawingDocument,
    after: DrawingDocument,
): HistoryEntry {
    const previous = admitDocument(before)
    const next = admitDocument(after)

    if (previous.id !== next.id) {
        throw new RangeError(
            'History snapshots must belong to the same document.',
        )
    }

    if (next.revision <= previous.revision) {
        throw new RangeError('History entry revision must advance.')
    }

    return {
        undo: captureChange(next, previous),
        redo: captureChange(previous, next),
    }
}
