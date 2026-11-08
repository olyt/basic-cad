import { createModelTolerance } from '../geometry/tolerance'
import { type ChangeSet } from './change-set'
import { admitDocument } from './document-admission'
import { admitEntity } from './entity-admission'
import { assertLayerEdits } from './layer-rules'
import { readNumber, readRecord } from './record'
import { admitLayer, admitSourceFile } from './record-admission'
import { applyRecordChanges } from './record-changes'
import { type DrawingDocument } from './schema'

function readSettings(value: unknown) {
    const { units, modelTolerance, defaultLineweight, defaults } =
        readRecord(value)

    const { distance } = readRecord(modelTolerance)

    return {
        units,
        modelTolerance: createModelTolerance(
            readNumber(distance, 'Model tolerance'),
        ),
        defaultLineweight,
        defaults,
    }
}

export function applyChangeSet(
    document: DrawingDocument,
    changeSet: ChangeSet,
): DrawingDocument {
    const current = admitDocument(document)
    const { documentId, baseRevision, entities, layers, sources, settings } =
        readRecord(changeSet)

    if (documentId !== current.id) {
        throw new RangeError('Change set targets a different document.')
    }

    if (baseRevision !== current.revision) {
        throw new RangeError(
            'Change set base revision does not match the document.',
        )
    }

    const nextSettings = readSettings(
        settings === undefined ? current : settings,
    )
    const entityBatch = applyRecordChanges(current.entities, {
        kind: 'entity',
        changes: entities,
        admit: (value) => admitEntity(value, nextSettings.modelTolerance),
    })
    const layerBatch = applyRecordChanges(current.layers, {
        kind: 'layer',
        changes: layers,
        admit: admitLayer,
    })
    const sourceBatch = applyRecordChanges(current.sources, {
        kind: 'source',
        changes: sources,
        admit: admitSourceFile,
    })
    const changed =
        settings !== undefined ||
        entityBatch.changed ||
        layerBatch.changed ||
        sourceBatch.changed

    if (!changed) {
        return current
    }

    if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Document revision is exhausted.')
    }

    const next = admitDocument({
        ...current,
        ...nextSettings,
        entities: entityBatch.records,
        layers: layerBatch.records,
        sources: sourceBatch.records,
        revision: current.revision + 1,
    })

    assertLayerEdits(current, {
        next,
        changedEntityIds: entityBatch.changedIds,
    })

    return next
}
