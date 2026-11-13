import { describe, expect, it } from 'vitest'
import { decodeDxfBytes } from '../dxf-io/decode-bytes'
import { decodeText } from './text-codec'

const utf8 = new TextEncoder()

function r2007(name: string): string {
    return [
        '  0',
        'SECTION',
        '  2',
        'HEADER',
        '  9',
        '$ACADVER',
        '  1',
        'AC1021',
        '  0',
        'ENDSEC',
        '  2',
        name,
        '',
    ].join('\n')
}

describe('browser text codec', () => {
    it('maps every Windows-1252 byte to its character', () => {
        expect(
            decodeText(Uint8Array.of(0x80, 0x9f, 0xa0, 0xe9), 'windows-1252'),
        ).toBe('€Ÿ\u00a0é')
    })

    it('decodes UTF-8 strictly', () => {
        expect(decodeText(utf8.encode('План😀'), 'utf-8')).toBe('План😀')
        expect(() => decodeText(Uint8Array.of(0xc3, 0x28), 'utf-8')).toThrow(
            TypeError,
        )
    })

    it('decodes an R2007 file and rejects invalid UTF-8', () => {
        const invalid = utf8.encode(r2007('Plan'))

        invalid[invalid.length - 3] = 0xff

        expect(
            decodeDxfBytes(utf8.encode(r2007('План😀')), decodeText),
        ).toEqual({ kind: 'text', text: r2007('План😀') })
        expect(decodeDxfBytes(invalid, decodeText)).toEqual({
            kind: 'rejected',
            message: 'The file is not valid UTF-8 text.',
        })
    })

    it('drops a UTF-8 byte-order mark before an R2007 header', () => {
        const bytes = Uint8Array.of(
            0xef,
            0xbb,
            0xbf,
            ...utf8.encode(r2007('Plan')),
        )

        expect(decodeDxfBytes(bytes, decodeText)).toEqual({
            kind: 'text',
            text: r2007('Plan'),
        })
    })
})
