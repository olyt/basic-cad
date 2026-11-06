import { parseId } from './id'
import {
    isAciColor,
    isEntityColor,
    isEntityLineweight,
    isLayerLineweight,
    isLayerName,
    isLinetype,
} from './properties'
import { readBoolean, readRecord, readText } from './record'
import {
    isSourceFormat,
    type EntityProperties,
    type EntitySource,
    type Layer,
    type SourceFile,
} from './schema'

export function admitEntityProperties(value: unknown): EntityProperties {
    const { layerId, color, lineweight, linetype } = readRecord(value)

    if (!isEntityColor(color)) {
        throw new RangeError('Entity color is unsupported.')
    }

    if (!isEntityLineweight(lineweight)) {
        throw new RangeError('Entity lineweight is unsupported.')
    }

    if (!isLinetype(linetype)) {
        throw new RangeError('Entity linetype is unsupported.')
    }

    return {
        layerId: parseId('layer', readText(layerId, 'Layer ID')),
        color,
        lineweight,
        linetype,
    }
}

export function admitLayer(value: unknown): Layer {
    const { id, name, color, visible, frozen, locked, lineweight, linetype } =
        readRecord(value)

    if (!isLayerName(name)) {
        throw new RangeError(
            'Layer name must be visible text on one line, at most 255 characters, without reserved CAD characters.',
        )
    }

    if (!isAciColor(color)) {
        throw new RangeError('Layer color must be an ACI index from 1 to 255.')
    }

    if (!isLayerLineweight(lineweight)) {
        throw new RangeError('Layer lineweight is unsupported.')
    }

    if (linetype !== 'continuous') {
        throw new RangeError('Layer linetype must be continuous.')
    }

    return {
        id: parseId('layer', readText(id, 'Layer ID')),
        name,
        color,
        visible: readBoolean(visible, 'Layer visibility'),
        frozen: readBoolean(frozen, 'Layer frozen flag'),
        locked: readBoolean(locked, 'Layer locked flag'),
        lineweight,
        linetype,
    }
}

export function admitSourceFile(value: unknown): SourceFile {
    const { id, format, fileName, version } = readRecord(value)

    if (!isSourceFormat(format)) {
        throw new RangeError('Source format is unsupported.')
    }

    return {
        id: parseId('source', readText(id, 'Source ID')),
        format,
        fileName: readText(fileName, 'Source filename'),
        ...(version === undefined
            ? {}
            : { version: readText(version, 'Source version') }),
    }
}

export function admitEntitySource(value: unknown): EntitySource {
    const { sourceId, handle } = readRecord(value)

    return {
        sourceId: parseId('source', readText(sourceId, 'Source ID')),
        ...(handle === undefined
            ? {}
            : { handle: readText(handle, 'Source handle') }),
    }
}
