import { applyChangeSet } from './apply-change-set'
import { type ChangeSet } from './change-set'
import { admitDocument } from './document-admission'
import { createHistoryEntry, type HistoryEntry } from './history-entry'
import { readNumber, readRecord } from './record'
import { restoreHistoryChange } from './restore-history-change'
import { type DrawingDocument } from './schema'

type HistoryDirection = 'undo' | 'redo'

export interface HistoryOptions {
    readonly capacity: number
    readonly highWaterRevision: number
}

export interface DocumentHistory extends HistoryOptions {
    readonly document: DrawingDocument
    readonly undoStack: readonly HistoryEntry[]
    readonly redoStack: readonly HistoryEntry[]
}

function readInteger(value: unknown, name: string): number {
    const integer = readNumber(value, name)

    if (!Number.isSafeInteger(integer) || integer < 0) {
        throw new RangeError(`${name} must be a nonnegative safe integer.`)
    }

    return integer
}

function readLimits(value: unknown, revision: number): HistoryOptions {
    const { capacity, highWaterRevision } = readRecord(value)
    const limit = readInteger(capacity, 'History capacity')
    const checkpoint = readInteger(
        highWaterRevision,
        'History revision checkpoint',
    )

    if (checkpoint < revision) {
        throw new RangeError(
            'History revision checkpoint is behind the document.',
        )
    }

    return { capacity: limit, highWaterRevision: checkpoint }
}

export function createHistory(
    document: DrawingDocument,
    options: HistoryOptions,
): DocumentHistory {
    const current = admitDocument(document)
    const limits = readLimits(options, current.revision)

    return { ...limits, document: current, undoStack: [], redoStack: [] }
}

export function commitHistory(
    history: DocumentHistory,
    changeSet: ChangeSet,
): DocumentHistory {
    const { document: current, undoStack } = history
    const limits = readLimits(history, current.revision)
    const applied = applyChangeSet(current, changeSet)

    if (applied.revision === current.revision) {
        return history
    }

    if (limits.highWaterRevision === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('History revision checkpoint is exhausted.')
    }

    const document = { ...applied, revision: limits.highWaterRevision + 1 }
    const entries =
        limits.capacity === 0
            ? []
            : [...undoStack, createHistoryEntry(current, document)]

    return {
        ...limits,
        document,
        highWaterRevision: document.revision,
        undoStack: entries.slice(Math.max(0, entries.length - limits.capacity)),
        redoStack: [],
    }
}

function navigateHistory(
    history: DocumentHistory,
    direction: HistoryDirection,
): DocumentHistory {
    const { document: current, undoStack, redoStack } = history
    const limits = readLimits(history, current.revision)
    const from = direction === 'undo' ? undoStack : redoStack
    const to = direction === 'undo' ? redoStack : undoStack
    const entry = from.at(-1)

    if (entry === undefined) {
        return history
    }

    const document = restoreHistoryChange(current, entry[direction])
    const remaining = from.slice(0, -1)
    const destination = [...to, entry]

    return {
        ...readLimits(limits, document.revision),
        document,
        undoStack: direction === 'undo' ? remaining : destination,
        redoStack: direction === 'redo' ? remaining : destination,
    }
}

export function undoHistory(history: DocumentHistory): DocumentHistory {
    return navigateHistory(history, 'undo')
}

export function redoHistory(history: DocumentHistory): DocumentHistory {
    return navigateHistory(history, 'redo')
}
