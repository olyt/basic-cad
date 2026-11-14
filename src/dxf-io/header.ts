import { DRAWING_UNITS, type DrawingUnits } from '../document/units'
import { type DxfToken } from './tokenize'
import { decodeUnicodeEscapes } from './unicode-escape'

export type HeaderOutcome = 'header' | 'error'
export type MeasurementSystem = 0 | 1

export interface DxfHeader {
    readonly sourceVersion?: string
    readonly currentLayer?: string
    readonly codepage?: string
    readonly unitCode?: number
    // Absent for missing or unsupported unit codes; never inferred from measurement.
    readonly units?: DrawingUnits
    readonly measurement?: MeasurementSystem
}

export type ReadDxfHeader =
    | {
          readonly kind: Extract<HeaderOutcome, 'header'>
          readonly header: DxfHeader
      }
    | {
          readonly kind: Extract<HeaderOutcome, 'error'>
          readonly line: number
          readonly message: string
      }

type HeaderError = Extract<ReadDxfHeader, { kind: 'error' }>

const HEADER_FIELDS = [
    ['$ACADVER', 1],
    ['$CLAYER', 8],
    ['$DWGCODEPAGE', 3],
    ['$INSUNITS', 70],
    ['$MEASUREMENT', 70],
] as const

type HeaderField = (typeof HEADER_FIELDS)[number]

function headerError(line: number, message: string): HeaderError {
    return { kind: 'error', line, message }
}

function opensHeader(tokens: readonly DxfToken[], index: number): boolean {
    const start = tokens[index]
    const name = tokens[index + 1]
    const section = start?.code === 0 && start.value === 'SECTION'

    return section && name?.code === 2 && name.value === 'HEADER'
}

function headerTokens(
    tokens: readonly DxfToken[],
): readonly DxfToken[] | HeaderError {
    const groups = tokens.filter(({ code }) => code !== 999)
    let header: readonly DxfToken[] | undefined

    for (let index = 0; index < groups.length; index += 1) {
        if (!opensHeader(groups, index)) {
            continue
        }

        const start = groups[index]!

        if (header !== undefined) {
            return headerError(start.line, 'Duplicate HEADER section.')
        }

        const end = groups.findIndex(
            (token, position) => position > index && token.code === 0,
        )

        if (groups[end]?.value !== 'ENDSEC') {
            return headerError(start.line, 'HEADER section has no 0/ENDSEC.')
        }

        header = groups.slice(index + 2, end)
        index = end
    }

    return header ?? []
}

function readUnits(token: DxfToken): DxfHeader | HeaderError {
    const code = token.value
    const valid =
        typeof code === 'number' && Number.isSafeInteger(code) && code >= 0

    if (!valid) {
        return headerError(
            token.line + 1,
            '$INSUNITS needs a nonnegative integer.',
        )
    }

    const units = DRAWING_UNITS[code]

    return units === undefined ? { unitCode: code } : { unitCode: code, units }
}

function normalizeField(
    name: HeaderField[0],
    token: DxfToken,
): DxfHeader | HeaderError {
    const value = token.value
    const invalid = () => headerError(token.line + 1, `Invalid ${name} value.`)

    switch (name) {
        case '$INSUNITS':
            return readUnits(token)
        case '$MEASUREMENT':
            return value === 0 || value === 1
                ? { measurement: value }
                : invalid()
        case '$ACADVER':
            return typeof value === 'string' && /^AC\d{4}$/.test(value)
                ? { sourceVersion: value }
                : invalid()
        case '$CLAYER':
            return typeof value === 'string'
                ? { currentLayer: decodeUnicodeEscapes(value) }
                : invalid()
        case '$DWGCODEPAGE':
            return typeof value === 'string' ? { codepage: value } : invalid()
    }
}

function readField(
    tokens: readonly DxfToken[],
    [name, code]: HeaderField,
): DxfHeader | HeaderError {
    const positions = tokens.flatMap((token, index) =>
        token.code === 9 && token.value === name ? [index] : [],
    )
    const [index, duplicate] = positions

    if (duplicate !== undefined) {
        return headerError(
            tokens[duplicate]!.line,
            `Duplicate ${name} variable.`,
        )
    }

    if (index === undefined) {
        return {}
    }

    const variable = tokens[index]!
    const value = tokens[index + 1]
    const extra = tokens[index + 2]

    if (value?.code !== code) {
        return headerError(
            variable.line,
            `${name} needs one group ${code} value.`,
        )
    }

    if (extra !== undefined && extra.code !== 9) {
        return headerError(extra.line, `${name} has extra value groups.`)
    }

    return normalizeField(name, value)
}

// Consumes tokenized input; full section/record structure is checked by inventoryDxf.
export function readDxfHeader(tokens: readonly DxfToken[]): ReadDxfHeader {
    const groups = headerTokens(tokens)

    if ('kind' in groups) {
        return groups
    }

    const header: DxfHeader = {}

    for (const field of HEADER_FIELDS) {
        const result = readField(groups, field)

        if ('kind' in result) {
            return result
        }

        Object.assign(header, result)
    }

    return { kind: 'header', header }
}
