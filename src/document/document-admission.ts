import { createModelTolerance } from '../geometry/tolerance'
import { admitEntity } from './entity-admission'
import { parseId } from './id'
import { isLineweightValue } from './properties'
import { readNumber, readRecord, readText } from './record'
import {
    admitEntityProperties,
    admitLayer,
    admitSourceFile,
} from './record-admission'
import { DOCUMENT_SCHEMA_VERSION, type DrawingDocument } from './schema'
import { isDrawingUnits } from './units'

function readRevision(value: unknown): number {
    const revision = readNumber(value, 'Document revision')

    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new RangeError(
            'Document revision must be a nonnegative safe integer.',
        )
    }

    return revision
}

function readRecords<Value>(
    value: unknown,
    admit: (value: unknown) => Value,
): Value[] {
    if (!Array.isArray(value)) {
        throw new RangeError('Document collections must be arrays.')
    }

    return Array.from(value, admit)
}

function uniqueValues(
    values: readonly string[],
    name: string,
): ReadonlySet<string> {
    const unique = new Set(values)

    if (unique.size !== values.length) {
        throw new RangeError(`${name} must be unique.`)
    }

    return unique
}

function assertReference(id: string, ids: ReadonlySet<string>): void {
    if (!ids.has(id)) {
        throw new RangeError(`Unresolved document reference: ${id}.`)
    }
}

function assertDocumentConsistency(document: DrawingDocument): void {
    const { layers, sources, entities, defaults } = document
    const layerIds = uniqueValues(
        layers.map((layer) => layer.id),
        'Layer IDs',
    )
    const sourceIds = uniqueValues(
        sources.map((source) => source.id),
        'Source IDs',
    )

    uniqueValues(
        entities.map((entity) => entity.id),
        'Entity IDs',
    )
    // Lowercasing first folds signs such as Kelvin K; uppercasing then matches ß with SS.
    uniqueValues(
        layers.map((layer) => layer.name.trim().toLowerCase().toUpperCase()),
        'Layer names',
    )

    if (!layers.some((layer) => layer.name === '0')) {
        throw new RangeError('A drawing must contain layer 0.')
    }

    assertReference(defaults.layerId, layerIds)

    if (layers.some((layer) => layer.id === defaults.layerId && layer.frozen)) {
        throw new RangeError('The current layer cannot be frozen.')
    }

    for (const { layerId, source } of entities) {
        assertReference(layerId, layerIds)

        if (source !== undefined) {
            assertReference(source.sourceId, sourceIds)
        }
    }
}

export function admitDocument(value: unknown): DrawingDocument {
    const {
        schemaVersion,
        id,
        revision,
        units,
        modelTolerance,
        defaultLineweight,
        defaults,
        layers,
        entities,
        sources,
    } = readRecord(value)

    if (schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
        throw new RangeError('Document schema version is unsupported.')
    }

    if (!isDrawingUnits(units)) {
        throw new RangeError('Drawing units are unsupported.')
    }

    if (!isLineweightValue(defaultLineweight)) {
        throw new RangeError(
            'Document default lineweight must be an explicit supported value.',
        )
    }

    const { distance } = readRecord(modelTolerance)
    const tolerance = createModelTolerance(
        readNumber(distance, 'Model tolerance'),
    )
    const document: DrawingDocument = {
        schemaVersion,
        id: parseId('document', readText(id, 'Document ID')),
        revision: readRevision(revision),
        units,
        modelTolerance: tolerance,
        defaultLineweight,
        defaults: admitEntityProperties(defaults),
        layers: readRecords(layers, admitLayer),
        entities: readRecords(entities, (entity) =>
            admitEntity(entity, tolerance),
        ),
        sources: readRecords(sources, admitSourceFile),
    }

    assertDocumentConsistency(document)

    return document
}
