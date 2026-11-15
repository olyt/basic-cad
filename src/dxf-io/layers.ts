import {
    isAciColor,
    isLayerLineweight,
    isLayerName,
    layerNameKey,
} from '../document/properties'
import { type Layer } from '../document/schema'
import { attributeTokens } from './inventory'
import { type DxfIssue, type DxfIssueKind } from './issue'
import { type DxfLinetype } from './linetypes'
import { type DxfTable, type DxfTableRecord } from './tables'
import { type DxfToken } from './tokenize'
import { decodeUnicodeEscapes } from './unicode-escape'

export type LayerIssueKind = DxfIssueKind
export type LayerIssue = DxfIssue

export interface DxfLayer {
    readonly record: DxfTableRecord
    readonly name?: string
    readonly value?: Omit<Layer, 'id'>
    readonly issues: readonly LayerIssue[]
}

type LayerProperties = Omit<Layer, 'id' | 'name'> & { readonly flags: number }
interface LayerContext {
    readonly names: ReadonlyMap<string, number>
    readonly linetypes: readonly DxfLinetype[]
}

const KNOWN_GROUPS = new Set([2, 5, 6, 62, 70, 100, 330, 370, 390])
const SUPPORTED_FLAGS = 1 | 4 | 64
const FIELD_MESSAGES: ReadonlyMap<number, string> = new Map([
    [2, 'Layer name is missing, repeated, invalid or nonunique.'],
    [6, 'Layer needs one reference to a qualified CONTINUOUS linetype.'],
    [62, 'Layer needs one signed ACI color with magnitude 1–255.'],
    [70, 'Layer flags are missing, repeated or unsupported.'],
    [370, 'Layer needs one supported explicit or DEFAULT lineweight.'],
])

function single(record: DxfTableRecord, code: number): DxfToken | undefined {
    const groups = Array.from(attributeTokens(record.tokens)).filter(
        (token) => token.code === code,
    )

    return groups.length === 1 ? groups[0] : undefined
}

function nameOf(record: DxfTableRecord): string | undefined {
    const value = single(record, 2)?.value

    return typeof value === 'string' ? decodeUnicodeEscapes(value) : undefined
}

function unsupported(record: DxfTableRecord, code: number): LayerIssue {
    const groups = Array.from(attributeTokens(record.tokens)).filter(
        (token) => token.code === code,
    )

    return {
        kind: 'unsupported',
        code,
        line: groups.at(-1)?.line ?? record.line,
        message:
            FIELD_MESSAGES.get(code) ??
            `Unsupported or repeated LAYER group ${code}.`,
    }
}

function isFlags(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 32767
    )
}

function continuousReference(
    value: unknown,
    linetypes: readonly DxfLinetype[],
): boolean {
    if (typeof value !== 'string') {
        return false
    }

    const name = decodeUnicodeEscapes(value).toUpperCase()
    const matches = linetypes.filter(
        (item) => item.name?.toUpperCase() === name,
    )

    return matches.length === 1 && matches[0]?.value === 'continuous'
}

function properties(
    record: DxfTableRecord,
    linetypes: readonly DxfLinetype[],
): LayerProperties | LayerIssue {
    const signedColor = single(record, 62)?.value
    const color =
        typeof signedColor === 'number' ? Math.abs(signedColor) : undefined

    if (!isAciColor(color)) {
        return unsupported(record, 62)
    }

    const flags = single(record, 70)?.value

    if (!isFlags(flags)) {
        return unsupported(record, 70)
    }

    const rawWeight = single(record, 370)?.value
    const lineweight = rawWeight === -3 ? 'default' : rawWeight

    if (typeof rawWeight !== 'number' || !isLayerLineweight(lineweight)) {
        return unsupported(record, 370)
    }

    if (!continuousReference(single(record, 6)?.value, linetypes)) {
        return unsupported(record, 6)
    }

    const frozen = (flags & 1) !== 0

    return {
        flags,
        color,
        frozen,
        visible: Number(signedColor) > 0 && !frozen,
        locked: (flags & 4) !== 0,
        lineweight,
        linetype: 'continuous',
    }
}

function extraIssues(record: DxfTableRecord): LayerIssue[] {
    const tokens = Array.from(attributeTokens(record.tokens))
    const codes = new Set(tokens.map(({ code }) => code))

    return Array.from(codes).flatMap((code) => {
        const groups = tokens.filter((token) => token.code === code)
        const repeated = code !== 100 && groups.length > 1
        const known =
            KNOWN_GROUPS.has(code) || (code === 290 && groups[0]?.value === 1)

        return repeated || !known ? [unsupported(record, code)] : []
    })
}

function normalize(record: DxfTableRecord, context: LayerContext): DxfLayer {
    const name = nameOf(record)
    const source = { record, ...(name === undefined ? {} : { name }) }

    if (!isLayerName(name) || context.names.get(layerNameKey(name)) !== 1) {
        return { ...source, issues: [unsupported(record, 2)] }
    }

    const result = properties(record, context.linetypes)

    if ('kind' in result) {
        return { ...source, issues: [result] }
    }

    const { flags, ...value } = result
    const issues = extraIssues(record)

    if (flags !== (flags & SUPPORTED_FLAGS)) {
        issues.push(unsupported(record, 70))
    }

    if (value.frozen) {
        issues.push({
            kind: 'converted',
            code: 70,
            line: single(record, 70)!.line,
            message: 'Frozen layer imported hidden.',
        })
    }

    return { ...source, value: { name, ...value }, issues }
}

// A base value can accompany unsupported issues for preview; CAD-051 decides editable admission.
export function readDxfLayers(
    table: DxfTable,
    linetypes: readonly DxfLinetype[],
): readonly DxfLayer[] {
    const names = new Map<string, number>()

    for (const record of table.entries) {
        const name = nameOf(record)

        if (name !== undefined) {
            const key = layerNameKey(name)

            names.set(key, (names.get(key) ?? 0) + 1)
        }
    }

    return table.entries.map((record) => {
        if (table.name !== 'LAYER' || record.type !== 'LAYER') {
            const issue = {
                ...unsupported(record, 0),
                message: 'Expected a LAYER table entry.',
            }

            return { record, issues: [issue] }
        }

        return normalize(record, { names, linetypes })
    })
}
