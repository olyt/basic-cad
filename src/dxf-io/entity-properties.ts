import {
    isEntityColor,
    isEntityLineweight,
    LINEWEIGHT_MODES,
    type EntityColor,
    type EntityLineweight,
    type Linetype,
} from '../document/properties'
import { type EntityProperties } from '../document/schema'
import { attributeGroups, type DxfRecord } from './inventory'
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

export interface DxfReferenceIndex {
    // Keyed by folded name; undefined marks a name that more than one layer folds to.
    readonly layers: ReadonlyMap<string, DxfLayer | undefined>
    readonly continuous: boolean
}

export interface ReadDxfEntityProperties {
    readonly record: DxfRecord
    readonly handle?: string
    readonly value?: DxfEntityProperties
    readonly issues: readonly DxfIssue[]
}

interface EntityGroups {
    readonly record: DxfRecord
    readonly groups: ReadonlyMap<number, readonly DxfToken[]>
}

const DEFAULTS = new Map<number, DxfToken['value'] | undefined>([
    [8, undefined],
    [62, 256],
    [370, -1],
    [6, 'BYLAYER'],
])
const PROPERTY_CODES = [5, ...DEFAULTS.keys()]
const MESSAGES: ReadonlyMap<number, string> = new Map([
    [5, 'Entity handle must be unique, nonempty source text.'],
    [8, 'Entity needs one reference to a known, representable layer.'],
    [62, 'Entity color must be ACI 1–255 or BYLAYER (256).'],
    [370, 'Entity lineweight is repeated or unsupported.'],
    [6, 'Entity linetype must be inherited or qualified CONTINUOUS.'],
])

function foldName(name: string): string {
    return name.toLowerCase().toUpperCase()
}

function entityGroups(record: DxfRecord): EntityGroups {
    return { record, groups: attributeGroups(record.tokens, PROPERTY_CODES) }
}

function found(entity: EntityGroups, code: number): readonly DxfToken[] {
    return entity.groups.get(code) ?? []
}

function unsupported(entity: EntityGroups, code: number): DxfIssue {
    return {
        kind: 'unsupported',
        code,
        line: found(entity, code).at(-1)?.line ?? entity.record.line,
        message: MESSAGES.get(code)!,
    }
}

function fieldValues(
    entity: EntityGroups,
): ReadonlyMap<number, DxfToken['value']> | DxfIssue {
    const fields = new Map<number, DxfToken['value']>()

    for (const [code, fallback] of DEFAULTS) {
        const groups = found(entity, code)
        const value = groups[0]?.value ?? fallback

        if (groups.length > 1 || value === undefined) {
            return unsupported(entity, code)
        }

        fields.set(code, value)
    }

    return fields
}

function sourceHandle(entity: EntityGroups) {
    const groups = found(entity, 5)
    const value = groups[0]?.value
    const valid =
        groups.length === 1 && typeof value === 'string' && value.trim() !== ''

    return {
        ...(valid ? { handle: value } : {}),
        issues: groups.length === 0 || valid ? [] : [unsupported(entity, 5)],
    }
}

function resolveLayer(value: unknown, references: DxfReferenceIndex) {
    if (typeof value !== 'string') {
        return undefined
    }

    const layer = references.layers.get(foldName(decodeUnicodeEscapes(value)))

    if (layer?.value === undefined) {
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
    references: DxfReferenceIndex,
): Linetype | undefined {
    if (typeof value !== 'string') {
        return undefined
    }

    const name = decodeUnicodeEscapes(value).toUpperCase()

    if (name === 'BYLAYER' || name === 'BYBLOCK') {
        return LINETYPE_NAMES.get(name)
    }

    return name === 'CONTINUOUS' && references.continuous
        ? 'continuous'
        : undefined
}

// Built once per drawing so each entity lookup is independent of the layer count.
export function indexDxfReferences(
    context: EntityPropertyContext,
): DxfReferenceIndex {
    const layers = new Map<string, DxfLayer | undefined>()

    for (const layer of context.layers) {
        if (layer.name !== undefined) {
            const key = foldName(layer.name)

            layers.set(key, layers.has(key) ? undefined : layer)
        }
    }

    const continuous = context.linetypes.filter(
        (item) => item.name?.toUpperCase() === 'CONTINUOUS',
    )

    return {
        layers,
        continuous:
            continuous.length === 1 && continuous[0]?.value === 'continuous',
    }
}

// Property success alone does not qualify geometry, entity types or extra attributes.
export function readDxfEntityProperties(
    record: DxfRecord,
    references: DxfReferenceIndex,
): ReadDxfEntityProperties {
    const entity = entityGroups(record)
    const fields = fieldValues(entity)
    const source = { record, ...sourceHandle(entity) }
    const failure = (issue: DxfIssue) => ({
        ...source,
        issues: [...source.issues, issue],
    })

    if ('kind' in fields) {
        return failure(fields)
    }

    const layer = resolveLayer(fields.get(8), references)
    const color = colorOf(fields.get(62))
    const lineweight = weightOf(fields.get(370))
    const linetype = linetypeOf(fields.get(6), references)

    if (layer === undefined) {
        return failure(unsupported(entity, 8))
    }

    if (color === undefined) {
        return failure(unsupported(entity, 62))
    }

    if (lineweight === undefined) {
        return failure(unsupported(entity, 370))
    }

    if (linetype === undefined) {
        return failure(unsupported(entity, 6))
    }

    if (layer.unsupported) {
        source.issues.push({
            ...unsupported(entity, 8),
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
