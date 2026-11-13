import { describe, expect, it } from 'vitest'
import { isLayerName } from '../document/properties'
import { decodeUnicodeEscapes } from './unicode-escape'

describe('DXF Unicode escapes', () => {
    it('decodes four-digit escapes in either hex case', () => {
        expect(decodeUnicodeEscapes('\\U+5899\\U+5c42')).toBe('墙层')
        expect(decodeUnicodeEscapes('\\U+041F\\U+043b\\U+0430\\U+043d é')).toBe(
            'План é',
        )
        expect(decodeUnicodeEscapes('Layer\\U+00E9-2')).toBe('Layeré-2')
    })

    it('reads exactly four hex digits', () => {
        expect(decodeUnicodeEscapes('\\U+00E9F')).toBe('éF')
        expect(decodeUnicodeEscapes('\\U+0041BC')).toBe('ABC')
        // Pinned ezdxf writes this eight-digit form; the first four digits are a control character.
        expect(decodeUnicodeEscapes('\\U+0001f600')).toBe('\u0001f600')
    })

    it('joins surrogate-pair escapes into one character', () => {
        const decoded = decodeUnicodeEscapes('План\\U+D83D\\U+DE00')

        expect(decoded).toBe('План😀')
        expect([...decoded]).toHaveLength(5)
        expect(isLayerName(decoded)).toBe(true)
    })

    it('keeps unpaired surrogates for admission to reject', () => {
        for (const value of ['\\U+D83D', '\\U+DE00\\U+D83D', '\\U+D83Dx']) {
            const decoded = decodeUnicodeEscapes(value)

            expect(decoded).toMatch(/\p{Cs}/u)
            expect(isLayerName(decoded)).toBe(false)
        }
    })

    it('leaves text that is not a complete escape unchanged', () => {
        for (const value of [
            '\\U+00E',
            '\\U+',
            '\\u+00E9',
            'U+00E9',
            '\\U00E9',
            '\\U+00G9',
            '\\\\U',
        ]) {
            expect(decodeUnicodeEscapes(value)).toBe(value)
        }
    })

    it('decodes an escape that follows a literal backslash', () => {
        expect(decodeUnicodeEscapes('\\\\U+00E9')).toBe('\\é')
    })
})
