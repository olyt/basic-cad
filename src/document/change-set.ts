import { type DocumentId } from './id'
import {
    type DrawingDocument,
    type Entity,
    type Layer,
    type SourceFile,
} from './schema'

export interface RecordChanges<Item extends { readonly id: string }> {
    readonly creates?: readonly Item[]
    readonly updates?: readonly Item[]
    readonly deletes?: readonly Item['id'][]
}

export type DocumentSettings = Pick<
    DrawingDocument,
    'units' | 'modelTolerance' | 'defaultLineweight' | 'defaults'
>

export interface ChangeSet {
    readonly documentId: DocumentId
    readonly baseRevision: number
    readonly entities?: RecordChanges<Entity>
    readonly layers?: RecordChanges<Layer>
    readonly sources?: RecordChanges<SourceFile>
    readonly settings?: DocumentSettings
}
