// Exactly four hex digits; UTF-16 strings join adjacent surrogate escapes into one character.
const UNICODE_ESCAPE = /\\U\+([0-9A-Fa-f]{4})/g

export function decodeUnicodeEscapes(value: string): string {
    return value.replace(UNICODE_ESCAPE, (_escape, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
    )
}
