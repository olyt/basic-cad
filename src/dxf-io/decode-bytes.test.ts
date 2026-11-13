import { describe, expect, it } from 'vitest'
import {
    decodeDxfBytes,
    type TextCodec,
    type TextEncoding,
} from './decode-bytes'

// Each character becomes one byte, so tests can place exact non-ASCII bytes.
function bytesOf(lines: readonly string[], ending = '\n'): Uint8Array {
    return Uint8Array.from(lines.join(ending) + ending, (character) =>
        character.charCodeAt(0),
    )
}

function header(variables: readonly string[]): string[] {
    return ['  0', 'SECTION', '  2', 'HEADER', ...variables, '  0', 'ENDSEC']
}

function recordingCodec() {
    const calls: { bytes: Uint8Array; encoding: TextEncoding }[] = []
    const codec: TextCodec = (bytes, encoding) => {
        calls.push({ bytes, encoding })

        return `decoded as ${encoding}`
    }

    return { calls, codec }
}

function requestedEncoding(bytes: Uint8Array) {
    const { calls, codec } = recordingCodec()

    expect(decodeDxfBytes(bytes, codec)).toEqual({
        kind: 'text',
        text: `decoded as ${calls[0]?.encoding}`,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.bytes).toBe(bytes)

    return calls[0]?.encoding
}

function rejectionOf(bytes: Uint8Array) {
    const { calls, codec } = recordingCodec()
    const result = decodeDxfBytes(bytes, codec)

    expect(calls).toEqual([])

    return result
}

const r2000 = header(['  9', '$ACADVER', '  1', 'AC1015'])

describe('DXF byte decoding', () => {
    it('decodes R2000 text by its ANSI_1252 codepage', () => {
        const bytes = bytesOf([
            ...header([
                '  9',
                '$ACADVER',
                '  1',
                'AC1015',
                '  9',
                '$DWGCODEPAGE',
                '  3',
                'ANSI_1252',
            ]),
            '  2',
            'Layeré',
        ])

        expect(requestedEncoding(bytes)).toBe('windows-1252')
    })

    it('decodes R2007 and later as UTF-8 whatever the codepage says', () => {
        for (const version of ['AC1021', 'AC1024', 'AC1027', 'AC1032']) {
            const bytes = bytesOf([
                ...header([
                    '  9',
                    '$ACADVER',
                    '  1',
                    version,
                    '  9',
                    '$DWGCODEPAGE',
                    '  3',
                    'ANSI_1251',
                ]),
                '  2',
                '\u00d0\u009f',
            ])

            expect(requestedEncoding(bytes)).toBe('utf-8')
        }
    })

    it('uses the codepage for every version before R2007', () => {
        for (const version of ['AC1009', 'AC1014', 'AC1015', 'AC1018']) {
            const bytes = bytesOf([
                ...header([
                    '  9',
                    '$ACADVER',
                    '  1',
                    version,
                    '  9',
                    '$DWGCODEPAGE',
                    '  3',
                    'ANSI_1252',
                ]),
                '  2',
                'é',
            ])

            expect(requestedEncoding(bytes)).toBe('windows-1252')
        }
    })

    it('reads header lines with CRLF endings, padding and comments', () => {
        const bytes = bytesOf(
            [
                '999',
                'written by café tools',
                ...header([
                    '9',
                    ' $ACADVER ',
                    '1  ',
                    'AC1021 ',
                    '  9',
                    '$DWGCODEPAGE',
                    '  3',
                    'ansi_1252',
                ]),
            ],
            '\r\n',
        )

        expect(requestedEncoding(bytes)).toBe('utf-8')
    })

    it('matches the codepage case-insensitively', () => {
        const bytes = bytesOf([
            ...header(['  9', '$DWGCODEPAGE', '  3', 'ansi_1252']),
            '  2',
            'é',
        ])

        expect(requestedEncoding(bytes)).toBe('windows-1252')
    })

    it('accepts ASCII-only files with an unknown or missing codepage', () => {
        const unknown = header([
            '  9',
            '$ACADVER',
            '  1',
            'AC1015',
            '  9',
            '$DWGCODEPAGE',
            '  3',
            'ANSI_1251',
        ])

        expect(requestedEncoding(bytesOf(unknown))).toBe('windows-1252')
        expect(requestedEncoding(bytesOf(r2000))).toBe('windows-1252')
        expect(requestedEncoding(bytesOf(['  0', 'EOF']))).toBe('windows-1252')
        expect(requestedEncoding(new Uint8Array())).toBe('windows-1252')
    })

    it('rejects non-ASCII text in an unsupported codepage', () => {
        for (const name of ['\u0080', 'Ïëàí']) {
            const bytes = bytesOf([
                ...header(['  9', '$DWGCODEPAGE', '  3', 'ANSI_1251']),
                '  2',
                name,
            ])

            expect(rejectionOf(bytes)).toEqual({
                kind: 'rejected',
                message: 'Codepage "ANSI_1251" is not supported.',
            })
        }
    })

    it('rejects non-ASCII text without a codepage', () => {
        for (const lines of [r2000, ['  0', 'SECTION']]) {
            expect(rejectionOf(bytesOf([...lines, 'é']))).toEqual({
                kind: 'rejected',
                message:
                    'The file has non-ASCII text but no $DWGCODEPAGE, so its encoding is unknown.',
            })
        }
    })

    it('rejects an unrecognized version', () => {
        for (const version of ['R2000', 'AC10150', 'XAC1021', 'AC10x5', '']) {
            const bytes = bytesOf(header(['  9', '$ACADVER', '  1', version]))

            expect(rejectionOf(bytes)).toEqual({
                kind: 'rejected',
                message: `Unrecognized DXF version "${version}".`,
            })
        }
    })

    it('rejects binary DXF before reading any header', () => {
        const bytes = bytesOf(['AutoCAD Binary DXF\r', '\u001a\u0000ÿ'])

        expect(rejectionOf(bytes)).toEqual({
            kind: 'rejected',
            message:
                'Binary DXF is not supported; save the drawing as ASCII DXF.',
        })
    })

    it('reports bytes the codec cannot decode', () => {
        const bytes = bytesOf(header(['  9', '$ACADVER', '  1', 'AC1021']))
        const codec: TextCodec = () => {
            throw new TypeError('The encoded data was not valid.')
        }

        expect(decodeDxfBytes(bytes, codec)).toEqual({
            kind: 'rejected',
            message: 'The file is not valid UTF-8 text.',
        })
    })

    it('reads variables only from the first section', () => {
        const bytes = bytesOf([
            ...header([
                '  9',
                '$ACADVER',
                '  1',
                'AC1015',
                '  9',
                '$DWGCODEPAGE',
                '  3',
                'ANSI_1252',
            ]),
            '  0',
            'SECTION',
            '  9',
            '$ACADVER',
            '  1',
            'AC1032',
            'é',
        ])

        expect(requestedEncoding(bytes)).toBe('windows-1252')
    })

    it('stops at the first record of a file without a header', () => {
        const bytes = bytesOf([
            '  0',
            'SECTION',
            '  2',
            'ENTITIES',
            '  0',
            'LINE',
            '  9',
            '$ACADVER',
            '  1',
            'AC1021',
        ])

        expect(requestedEncoding(bytes)).toBe('windows-1252')
    })

    it('reads past lines too long to hold a header value', () => {
        const bytes = bytesOf([
            '999',
            'x'.repeat(1_000_000),
            ...header(['  9', '$ACADVER', '  1', 'AC1021']),
        ])

        expect(requestedEncoding(bytes)).toBe('utf-8')
    })

    it('keeps the first value of a repeated variable', () => {
        const bytes = bytesOf(
            header([
                '  9',
                '$ACADVER',
                '  1',
                'AC1015',
                '  9',
                '$ACADVER',
                '  1',
                'AC1032',
            ]),
        )

        expect(requestedEncoding(bytes)).toBe('windows-1252')
    })

    it('leaves malformed structure for the tokenizer to report', () => {
        for (const lines of [
            ['  9', '$ACADVER', '  1'],
            ['junk', '$ACADVER', '  1', 'AC1021'],
            ['0x9', '$ACADVER', '  1', 'AC1021'],
            ['  9', '$ACADVER', '  0', 'ENDSEC', '  1', 'AC1021'],
        ]) {
            expect(requestedEncoding(bytesOf(lines))).toBe('windows-1252')
        }
    })
})
