export type TextEncoding = 'utf-8' | 'windows-1252'
export type DecodeOutcome = 'text' | 'rejected'

// Throws when the bytes are not valid text in the requested encoding.
export type TextCodec = (bytes: Uint8Array, encoding: TextEncoding) => string

export type DecodedDxf =
    | { readonly kind: Extract<DecodeOutcome, 'text'>; readonly text: string }
    | {
          readonly kind: Extract<DecodeOutcome, 'rejected'>
          readonly message: string
      }

type Rejection = Extract<DecodedDxf, { kind: 'rejected' }>

const LF = 0x0a
// Longer lines cannot hold a group code or a header value read here.
const MAX_LINE_LENGTH = 256
const BINARY_SENTINEL = 'AutoCAD Binary DXF'
// AC1021 (R2007) is the first version that stores text as UTF-8.
const FIRST_UTF8_VERSION = 1021
const CODEPAGE_ENCODINGS: ReadonlyMap<string, TextEncoding> = new Map([
    ['ANSI_1252', 'windows-1252'],
])
const ENCODING_NAMES: Readonly<Record<TextEncoding, string>> = {
    'utf-8': 'UTF-8',
    'windows-1252': 'Windows-1252',
}

function rejection(message: string): Rejection {
    return { kind: 'rejected', message }
}

// Group codes and the header values read here are ASCII in every supported encoding.
function byteString(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes)
}

function* lines(bytes: Uint8Array): Generator<string> {
    let start = 0

    while (start < bytes.length) {
        const newline = bytes.indexOf(LF, start)
        const end = newline === -1 ? bytes.length : newline

        yield byteString(
            bytes.subarray(start, Math.min(end, start + MAX_LINE_LENGTH)),
        )
        start = end + 1
    }
}

function groupCode(line: string): number | undefined {
    const trimmed = line.trim()

    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : undefined
}

function* groupPairs(
    bytes: Uint8Array,
): Generator<readonly [number | undefined, string]> {
    const source = lines(bytes)

    for (const code of source) {
        const value = source.next()

        if (value.done) {
            return
        }

        yield [groupCode(code), value.value.trim()]
    }
}

function readHeaderVariables(bytes: Uint8Array): ReadonlyMap<string, string> {
    const variables = new Map<string, string>()
    let name: string | undefined

    for (const [code, value] of groupPairs(bytes)) {
        // Inside HEADER, group code 0 only opens the section or ends it.
        if (code === 0 && value !== 'SECTION') {
            break
        }

        if (name !== undefined && !variables.has(name)) {
            variables.set(name, value)
        }

        name = code === 9 ? value : undefined
    }

    return variables
}

function codepageEncoding(
    bytes: Uint8Array,
    codepage: string | undefined,
): TextEncoding | Rejection {
    const encoding = CODEPAGE_ENCODINGS.get(codepage?.toUpperCase() ?? '')

    if (encoding !== undefined) {
        return encoding
    }

    // ASCII bytes decode identically under every codepage.
    if (bytes.every((byte) => byte < 0x80)) {
        return 'windows-1252'
    }

    return rejection(
        codepage === undefined
            ? 'The file has non-ASCII text but no $DWGCODEPAGE, so its encoding is unknown.'
            : `Codepage "${codepage}" is not supported.`,
    )
}

function selectEncoding(bytes: Uint8Array): TextEncoding | Rejection {
    const variables = readHeaderVariables(bytes)
    const version = variables.get('$ACADVER')

    if (version !== undefined) {
        const match = /^AC(\d{4})$/.exec(version)

        if (match === null) {
            return rejection(`Unrecognized DXF version "${version}".`)
        }

        if (Number(match[1]) >= FIRST_UTF8_VERSION) {
            return 'utf-8'
        }
    }

    return codepageEncoding(bytes, variables.get('$DWGCODEPAGE'))
}

export function decodeDxfBytes(
    bytes: Uint8Array,
    codec: TextCodec,
): DecodedDxf {
    const prefix = byteString(bytes.subarray(0, BINARY_SENTINEL.length))

    if (prefix === BINARY_SENTINEL) {
        return rejection(
            'Binary DXF is not supported; save the drawing as ASCII DXF.',
        )
    }

    const encoding = selectEncoding(bytes)

    if (typeof encoding !== 'string') {
        return encoding
    }

    try {
        return { kind: 'text', text: codec(bytes, encoding) }
    } catch {
        return rejection(
            `The file is not valid ${ENCODING_NAMES[encoding]} text.`,
        )
    }
}
