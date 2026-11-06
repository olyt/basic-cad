import {
    createModelTolerance,
    type ModelTolerance,
} from '../geometry/tolerance'
import { allocateId, type IdState } from './id'
import { createAciColor } from './properties'
import {
    DOCUMENT_SCHEMA_VERSION,
    type DrawingDocument,
    type Layer,
} from './schema'
import { isDrawingUnits, type DrawingUnits } from './units'

export interface NewDocumentOptions {
    readonly modelTolerance: ModelTolerance
    readonly units?: DrawingUnits
}

export function createEmptyDocument(
    idState: IdState,
    options: NewDocumentOptions,
): { readonly document: DrawingDocument; readonly nextIdState: IdState } {
    const units = options.units === undefined ? 'millimeters' : options.units
    const modelTolerance = createModelTolerance(
        options.modelTolerance?.distance ?? NaN,
    )

    if (!isDrawingUnits(units)) {
        throw new RangeError('Drawing units are unsupported.')
    }

    const documentId = allocateId('document', idState)
    const layerId = allocateId('layer', documentId.nextState)
    const layer: Layer = {
        id: layerId.id,
        name: '0',
        color: createAciColor(7),
        visible: true,
        frozen: false,
        locked: false,
        lineweight: 'default',
        linetype: 'continuous',
    }
    const document: DrawingDocument = {
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        id: documentId.id,
        revision: 0,
        units,
        modelTolerance,
        defaultLineweight: 25,
        defaults: {
            layerId: layer.id,
            color: 'by-layer',
            lineweight: 'by-layer',
            linetype: 'by-layer',
        },
        layers: [layer],
        entities: [],
        sources: [],
    }

    return { document, nextIdState: layerId.nextState }
}
