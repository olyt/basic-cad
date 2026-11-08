import { applyChangeSet } from './apply-change-set'
import { type ChangeSet } from './change-set'
import { createSpatialIndex, type SpatialIndex } from './spatial-index'

export function applyIndexedChangeSet(
    index: SpatialIndex,
    changes: ChangeSet,
): SpatialIndex {
    const document = applyChangeSet(index.document, changes)

    if (document.revision === index.document.revision) {
        return index
    }

    return createSpatialIndex(document)
}
