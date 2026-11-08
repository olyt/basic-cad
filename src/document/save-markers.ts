import { parseId, type DocumentId } from './id'
import { readNumber, readRecord, readText } from './record'
import { type DrawingDocument } from './schema'

type MarkerField = 'lastSaved' | 'lastExported'

export interface DocumentRevision {
    readonly documentId: DocumentId
    readonly revision: number
}

export interface SaveMarkers {
    readonly documentId: DocumentId
    readonly lastSaved: number | null
    readonly lastExported: number | null
}

export interface SaveStatus {
    readonly unsaved: boolean
    readonly unexported: boolean
}

function readRevision(value: unknown): number {
    const revision = readNumber(value, 'Snapshot revision')

    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new RangeError(
            'Snapshot revision must be a nonnegative safe integer.',
        )
    }

    return revision
}

function readSnapshot(value: unknown): DocumentRevision {
    const { documentId, revision } = readRecord(value)

    return {
        documentId: parseId('document', readText(documentId, 'Document ID')),
        revision: readRevision(revision),
    }
}

export function captureDocumentRevision(
    document: DrawingDocument,
): DocumentRevision {
    const { id, revision } = readRecord(document)

    return readSnapshot({ documentId: id, revision })
}

export function admitSaveMarkers(value: unknown): SaveMarkers {
    const { documentId, lastSaved, lastExported } = readRecord(value)

    return {
        documentId: parseId('document', readText(documentId, 'Document ID')),
        lastSaved: lastSaved === null ? null : readRevision(lastSaved),
        lastExported: lastExported === null ? null : readRevision(lastExported),
    }
}

export function createSaveMarkers(document: DrawingDocument): SaveMarkers {
    const { documentId } = captureDocumentRevision(document)

    return { documentId, lastSaved: null, lastExported: null }
}

function matchingSnapshot(markers: SaveMarkers, snapshot: DocumentRevision) {
    const current = admitSaveMarkers(markers)
    const captured = readSnapshot(snapshot)

    if (current.documentId !== captured.documentId) {
        throw new RangeError('Save markers belong to a different document.')
    }

    return { current, revision: captured.revision }
}

function recordCompletion(
    markers: SaveMarkers,
    update: {
        readonly field: MarkerField
        readonly snapshot: DocumentRevision
    },
): SaveMarkers {
    const { current, revision } = matchingSnapshot(markers, update.snapshot)

    return { ...current, [update.field]: revision }
}

export function markSaved(
    markers: SaveMarkers,
    snapshot: DocumentRevision,
): SaveMarkers {
    return recordCompletion(markers, { field: 'lastSaved', snapshot })
}

export function markExported(
    markers: SaveMarkers,
    snapshot: DocumentRevision,
): SaveMarkers {
    return recordCompletion(markers, { field: 'lastExported', snapshot })
}

export function getSaveStatus(
    document: DrawingDocument,
    markers: SaveMarkers,
): SaveStatus {
    const { current, revision } = matchingSnapshot(
        markers,
        captureDocumentRevision(document),
    )

    return {
        unsaved: current.lastSaved !== revision,
        unexported: current.lastExported !== revision,
    }
}
