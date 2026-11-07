import { createModelTolerance } from '../geometry/tolerance'
import { admitDocument } from './document-admission'
import { admitEntity } from './entity-admission'
import { type HistoryChange } from './history-entry'
import { readNumber, readRecord } from './record'
import { admitLayer, admitSourceFile } from './record-admission'
import { applyRecordChanges } from './record-changes'
import { type DrawingDocument } from './schema'

function readChanges(value: unknown) {
    const { creates, updates, deletes } = readRecord(value)

    if (![creates, updates, deletes].every(Array.isArray)) {
        throw new RangeError('History operation arrays are required.')
    }

    return { creates, updates, deletes }
}

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

function restoreOrder<Item extends { readonly id: string }>(
    records: readonly Item[],
    order: unknown,
): Item[] {
    if (!Array.isArray(order) || order.length !== records.length) {
        throw new RangeError('History order must cover every record once.')
    }

    const remaining = new Map(records.map((record) => [record.id, record]))

    return Array.from(order, (id: unknown) => {
        const record = typeof id === 'string' ? remaining.get(id) : undefined

        if (record === undefined) {
            throw new RangeError('History order IDs must be unique and known.')
        }

        remaining.delete(record.id)

        return record
    })
}

export function restoreHistoryChange(
    document: DrawingDocument,
    change: HistoryChange,
): DrawingDocument {
    const current = admitDocument(document)
    const {
        documentId,
        baseRevision,
        targetRevision,
        entities,
        layers,
        sources,
        settings,
        order,
    } = readRecord(change)

    if (documentId !== current.id) {
        throw new RangeError('History change targets a different document.')
    }

    if (baseRevision !== current.revision) {
        throw new RangeError('History base revision must match the document.')
    }

    if (targetRevision === current.revision) {
        throw new RangeError('History target must have a different revision.')
    }

    const targetSettings = readSettings(settings)
    const {
        entities: entityOrder,
        layers: layerOrder,
        sources: sourceOrder,
    } = readRecord(order)
    const entityBatch = applyRecordChanges(current.entities, {
        kind: 'entity',
        changes: readChanges(entities),
        admit: (value) => admitEntity(value, targetSettings.modelTolerance),
    })
    const layerBatch = applyRecordChanges(current.layers, {
        kind: 'layer',
        changes: readChanges(layers),
        admit: admitLayer,
    })
    const sourceBatch = applyRecordChanges(current.sources, {
        kind: 'source',
        changes: readChanges(sources),
        admit: admitSourceFile,
    })

    return admitDocument({
        ...current,
        ...targetSettings,
        revision: targetRevision,
        entities: restoreOrder(entityBatch.records, entityOrder),
        layers: restoreOrder(layerBatch.records, layerOrder),
        sources: restoreOrder(sourceBatch.records, sourceOrder),
    })
}
