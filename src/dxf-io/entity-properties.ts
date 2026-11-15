import {
    isEntityColor,
    isEntityLineweight,
    LINEWEIGHT_MODES,
    type EntityColor,
    type EntityLineweight,
    type Linetype,
} from '../document/properties'
import { type EntityProperties } from '../document/schema'
import { attributeTokens, type DxfRecord } from './inventory'
import { type DxfIssue } from './issue'
import { type DxfLayer } from './layers'
import { LINETYPE_NAMES, type DxfLinetype } from './linetypes'
import { type DxfToken } from './tokenize'
import { decodeUnicodeEscapes } from './unicode-escape'

export interface DxfEntityProperties extends Omit<EntityProperties, 'layerId'> {
    readonly layerName: string
}

export interface EntityPropertyContext {
    readonly layers: readonly DxfLayer[]
    readonly linetypes: readonly DxfLinetype[]
}

export interface ReadDxfEntityProperties {
    readonly record: DxfRecord
    readonly handle?: string
    readonly value?: DxfEntityProperties
    readonly issues: readonly DxfIssue[]
}

const DEFAULTS = new Map<number, DxfToken['value'] | undefined>([
    [8, undefined],
    [62, 256],
    [370, -1],
    [6, 'BYLAYER'],
])
const MESSAGES: ReadonlyMap<number, string> = new Map([
    [5, 'Entity handle must be unique, nonempty source text.'],
    [8, 'Entity needs one reference to a known, representable layer.'],
    [62, 'Entity color must be ACI 1–255 or BYLAYER (256).'],
    [370, 'Entity lineweight is repeated or unsupported.'],
    [6, 'Entity linetype must be inherited or qualified CONTINUOUS.'],
])

function groups(record: DxfRecord, code: number): DxfToken[] {
    return Array.from(attributeTokens(record.tokens)).filter(
        (token) => token.code === code,
    )
}

function unsupported(record: DxfRecord, code: number): DxfIssue {
    return {
        kind: 'unsupported',
        code,
        line: groups(record, code).at(-1)?.line ?? record.line,
        message: MESSAGES.get(code)!,
    }
}

function fieldValues(
    record: DxfRecord,
): ReadonlyMap<number, DxfToken['value']> | DxfIssue {
    const fields = new Map<number, DxfToken['value']>()

    for (const [code, fallback] of DEFAULTS) {
        const found = groups(record, code)
        const value = found[0]?.value ?? fallback

        if (found.length > 1 || value === undefined) {
            return unsupported(record, code)
        }

        fields.set(code, value)
    }

    return fields
}

function sourceHandle(record: DxfRecord) {
    const found = groups(record, 5)
    const value = found[0]?.value
    const valid =
        found.length === 1 && typeof value === 'string' && value.trim() !== ''

    return {
        ...(valid ? { handle: value } : {}),
        issues: found.length === 0 || valid ? [] : [unsupported(record, 5)],
    }
}

function resolveLayer(value: unknown, layers: readonly DxfLayer[]) {
    if (typeof value !== 'string') {
        return undefined
    }

    const key = decodeUnicodeEscapes(value).toLowerCase().toUpperCase()
    const matches = layers.filter(
        ({ name }) => name?.toLowerCase().toUpperCase() === key,
    )
    const [layer] = matches

    if (matches.length !== 1 || layer?.value === undefined) {
        return undefined
    }

    return {
        name: layer.value.name,
        unsupported: layer.issues.some(({ kind }) => kind === 'unsupported'),
    }
}

function colorOf(value: unknown): EntityColor | undefined {
    const color = value === 256 ? 'by-layer' : value

    return typeof value === 'number' && isEntityColor(color) ? color : undefined
}

function weightOf(value: unknown): EntityLineweight | undefined {
    if (typeof value !== 'number') {
        return undefined
    }

    const weight = value < 0 ? LINEWEIGHT_MODES[-value - 1] : value

    return isEntityLineweight(weight) ? weight : undefined
}

function linetypeOf(
    value: unknown,
    definitions: readonly DxfLinetype[],
): Linetype | undefined {
    if (typeof value !== 'string') {
        return undefined
    }

    const name = decodeUnicodeEscapes(value).toUpperCase()

    if (name === 'BYLAYER' || name === 'BYBLOCK') {
        return LINETYPE_NAMES.get(name)
    }

    const matches = definitions.filter(
        (item) => item.name?.toUpperCase() === name,
    )
    const qualified =
        name === 'CONTINUOUS' &&
        matches.length === 1 &&
        matches[0]?.value === 'continuous'

    return qualified ? 'continuous' : undefined
}

// Property success alone does not qualify geometry, entity types or extra attributes.
export function readDxfEntityProperties(
    record: DxfRecord,
    context: EntityPropertyContext,
): ReadDxfEntityProperties {
    const fields = fieldValues(record)
    const source = { record, ...sourceHandle(record) }
    const failure = (issue: DxfIssue) => ({
        ...source,
        issues: [...source.issues, issue],
    })

    if ('kind' in fields) {
        return failure(fields)
    }

    const layer = resolveLayer(fields.get(8), context.layers)
    const color = colorOf(fields.get(62))
    const lineweight = weightOf(fields.get(370))
    const linetype = linetypeOf(fields.get(6), context.linetypes)

    if (layer === undefined) {
        return failure(unsupported(record, 8))
    }

    if (color === undefined) {
        return failure(unsupported(record, 62))
    }

    if (lineweight === undefined) {
        return failure(unsupported(record, 370))
    }

    if (linetype === undefined) {
        return failure(unsupported(record, 6))
    }

    if (layer.unsupported) {
        source.issues.push({
            ...unsupported(record, 8),
            message:
                'Referenced layer has unsupported properties; preview only.',
        })
    }

    return {
        ...source,
        value: {
            layerName: layer.name,
            color,
            lineweight,
            linetype,
        },
    }
}
