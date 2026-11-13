import { parseGroupCode } from './decode-bytes'

export type GroupValueType = 'string' | 'integer' | 'double'
export type TokenizeOutcome = 'tokens' | 'error'

type NumericType = Exclude<GroupValueType, 'string'>

export interface DxfToken {
    readonly code: number
    readonly value: string | number
    // One-based line of the group code; its value is on the next line.
    readonly line: number
}

export type TokenizedDxf =
    | {
          readonly kind: Extract<TokenizeOutcome, 'tokens'>
          readonly tokens: readonly DxfToken[]
      }
    | {
          readonly kind: Extract<TokenizeOutcome, 'error'>
          readonly line: number
          readonly message: string
      }

type TokenError = Extract<TokenizedDxf, { kind: 'error' }>

interface LinePair {
    readonly codeText: string
    readonly valueText: string | undefined
    readonly line: number
}

// Inclusive group code ranges from the DXF reference; all other codes hold strings.
const NUMERIC_RANGES: readonly (readonly [number, number, NumericType])[] = [
    [10, 59, 'double'],
    [60, 79, 'integer'],
    [90, 99, 'integer'],
    [110, 149, 'double'],
    [160, 179, 'integer'],
    [210, 239, 'double'],
    [270, 299, 'integer'],
    [370, 389, 'integer'],
    [400, 409, 'integer'],
    [420, 429, 'integer'],
    [440, 459, 'integer'],
    [460, 469, 'double'],
    [1010, 1059, 'double'],
    [1060, 1071, 'integer'],
]
const NUMBER_SYNTAX: Readonly<Record<NumericType, RegExp>> = {
    integer: /^[+-]?\d+$/,
    double: /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,
}
const NUMBER_NAMES: Readonly<Record<NumericType, string>> = {
    integer: 'an integer',
    double: 'a finite number',
}
const QUOTED_LENGTH = 40
const CR = 13

function tokenError(line: number, message: string): TokenError {
    return { kind: 'error', line, message }
}

function quoted(text: string): string {
    return JSON.stringify(
        text.length > QUOTED_LENGTH ? `${text.slice(0, QUOTED_LENGTH)}…` : text,
    )
}

function valueType(code: number): GroupValueType {
    const range = NUMERIC_RANGES.find(
        ([first, last]) => code >= first && code <= last,
    )

    return range?.[2] ?? 'string'
}

function readNumber(text: string, type: NumericType): number | undefined {
    const trimmed = text.trim()
    const value = Number(trimmed)
    const representable =
        type === 'integer'
            ? Number.isSafeInteger(value)
            : Number.isFinite(value)

    return NUMBER_SYNTAX[type].test(trimmed) && representable
        ? value
        : undefined
}

function* textLines(text: string): Generator<string> {
    let start = 0

    while (start < text.length) {
        const newline = text.indexOf('\n', start)
        const end = newline === -1 ? text.length : newline

        yield text.slice(start, text.charCodeAt(end - 1) === CR ? end - 1 : end)
        start = end + 1
    }
}

function* linePairs(text: string): Generator<LinePair> {
    const lines = textLines(text)
    let line = 1

    for (const codeText of lines) {
        const value = lines.next()

        yield {
            codeText,
            valueText: value.done ? undefined : value.value,
            line,
        }
        line += 2
    }
}

function readToken({
    codeText,
    valueText,
    line,
}: LinePair): DxfToken | TokenError {
    const code = parseGroupCode(codeText)

    if (code === undefined) {
        return tokenError(line, `Invalid group code ${quoted(codeText)}.`)
    }

    if (valueText === undefined) {
        return tokenError(line, `Group code ${code} has no value.`)
    }

    const type = valueType(code)

    if (type === 'string') {
        return { code, value: valueText, line }
    }

    const value = readNumber(valueText, type)

    return value === undefined
        ? tokenError(
              line + 1,
              `Group code ${code} needs ${NUMBER_NAMES[type]}, found ${quoted(valueText)}.`,
          )
        : { code, value, line }
}

// Reads group code/value line pairs up to 0/EOF; anything after EOF is ignored.
export function tokenizeDxf(text: string): TokenizedDxf {
    const tokens: DxfToken[] = []
    let nextLine = 1

    for (const pair of linePairs(text)) {
        const token = readToken(pair)

        if ('kind' in token) {
            return token
        }

        tokens.push(token)

        if (token.code === 0 && token.value === 'EOF') {
            return { kind: 'tokens', tokens }
        }

        nextLine = pair.line + 2
    }

    return tokenError(nextLine, 'The file ends without 0/EOF.')
}
