import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { tokenizeDxf, type DxfToken } from './tokenize'

function dxf(lines: readonly string[], ending = '\n'): string {
    return lines.join(ending) + ending
}

function tokensOf(lines: readonly string[]): readonly DxfToken[] {
    const result = tokenizeDxf(dxf([...lines, '  0', 'EOF']))

    if (result.kind !== 'tokens') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.tokens.slice(0, -1)
}

function valueOf(code: number, text: string): DxfToken['value'] | undefined {
    const result = tokenizeDxf(dxf([String(code), text, '  0', 'EOF']))

    return result.kind === 'tokens' ? result.tokens[0]?.value : undefined
}

describe('DXF group-code tokenizer', () => {
    it('reads typed code/value pairs with their line numbers up to EOF', () => {
        expect(
            tokenizeDxf(
                dxf([
                    '999',
                    'comment',
                    '  0',
                    'LINE',
                    '  5',
                    '1A',
                    '  8',
                    'Layer 1',
                    ' 10',
                    '1.5',
                    ' 62',
                    '3',
                    '  0',
                    'EOF',
                ]),
            ),
        ).toEqual({
            kind: 'tokens',
            tokens: [
                { code: 999, value: 'comment', line: 1 },
                { code: 0, value: 'LINE', line: 3 },
                { code: 5, value: '1A', line: 5 },
                { code: 8, value: 'Layer 1', line: 7 },
                { code: 10, value: 1.5, line: 9 },
                { code: 62, value: 3, line: 11 },
                { code: 0, value: 'EOF', line: 13 },
            ],
        })
    })

    it('reads LF, CRLF and mixed line endings identically', () => {
        const lines = ['  0', 'SECTION', '  2', 'HEADER', ' 40', '2.5']
        const expected = tokenizeDxf(dxf([...lines, '  0', 'EOF']))
        const mixed = 'SECTION\r\n  2\nHEADER\r\n 40\n2.5\r\n  0\nEOF'

        expect(expected.kind).toBe('tokens')
        expect(tokenizeDxf(dxf([...lines, '  0', 'EOF'], '\r\n'))).toEqual(
            expected,
        )
        expect(tokenizeDxf(`  0\r\n${mixed}`)).toEqual(expected)
    })

    it('tolerates spaces around group codes and numeric values', () => {
        expect(
            tokensOf(['10  ', '  1.5  ', '\t70\t', ' 4 ', '+20', '-2']),
        ).toEqual([
            { code: 10, value: 1.5, line: 1 },
            { code: 70, value: 4, line: 3 },
            { code: 20, value: -2, line: 5 },
        ])
    })

    it('keeps string values exact', () => {
        for (const text of ['  Layer  ', '', ' ', '\t', 'LINE ', '\\U+00E9']) {
            expect(valueOf(2, text)).toBe(text)
        }

        expect(valueOf(5, '01A')).toBe('01A')
        expect(valueOf(330, ' 1F')).toBe(' 1F')
    })

    it('does not treat a padded EOF value as the end of the file', () => {
        expect(tokenizeDxf(dxf(['  0', 'EOF ']))).toEqual({
            kind: 'error',
            line: 3,
            message: 'The file ends without 0/EOF.',
        })
    })

    it('accepts decimal and exponent notation for doubles', () => {
        const cases: readonly (readonly [string, number])[] = [
            ['1e-09', 1e-9],
            ['1E+3', 1000],
            ['2.5e2', 250],
            ['.5', 0.5],
            ['5.', 5],
            ['+0.25', 0.25],
            ['0.12345678901234567', 0.12345678901234566],
            ['1e-400', 0],
        ]

        for (const [text, value] of cases) {
            expect(valueOf(10, text)).toBe(value)
        }

        expect(Object.is(valueOf(40, '-0.0'), -0)).toBe(true)
    })

    it('rejects numbers with trailing text or invalid syntax', () => {
        for (const text of [
            '25junk',
            'abc',
            '',
            ' ',
            '1,5',
            '1.2.3',
            '1e',
            '1e+',
            'e5',
            '.',
            '-',
            '0x10',
            'NaN',
            'Infinity',
            '1_000',
        ]) {
            expect(tokenizeDxf(dxf(['  0', 'LINE', ' 10', text]))).toEqual({
                kind: 'error',
                line: 4,
                message: `Group code 10 needs a finite number, found ${JSON.stringify(text)}.`,
            })
        }
    })

    it('rejects doubles that overflow', () => {
        expect(tokenizeDxf(dxf([' 40', '1e400']))).toEqual({
            kind: 'error',
            line: 2,
            message: 'Group code 40 needs a finite number, found "1e400".',
        })
    })

    it('requires integers for integer group codes', () => {
        for (const text of ['1.5', '1.0', '1e3', '7junk', '9007199254740993']) {
            expect(tokenizeDxf(dxf([' 70', text]))).toEqual({
                kind: 'error',
                line: 2,
                message: `Group code 70 needs an integer, found ${JSON.stringify(text)}.`,
            })
        }

        expect(valueOf(160, '9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
        expect(valueOf(370, '-3')).toBe(-3)
    })

    it('types values by the group code ranges of the DXF reference', () => {
        const integers = [
            60, 79, 90, 99, 160, 179, 270, 299, 370, 389, 400, 409, 420, 429,
            440, 459, 1060, 1071,
        ]
        const doubles = [10, 59, 110, 149, 210, 239, 460, 469, 1010, 1059]
        const strings = [
            -1, 0, 9, 80, 89, 100, 105, 109, 150, 159, 180, 209, 240, 269, 300,
            369, 390, 399, 410, 419, 430, 439, 470, 999, 1000, 1009, 1072,
        ]

        for (const code of integers) {
            expect([valueOf(code, '7'), valueOf(code, '7.5')]).toEqual([
                7,
                undefined,
            ])
        }

        for (const code of doubles) {
            expect([valueOf(code, '7'), valueOf(code, '7.5')]).toEqual([7, 7.5])
        }

        for (const code of strings) {
            expect([valueOf(code, '7'), valueOf(code, '7.5')]).toEqual([
                '7',
                '7.5',
            ])
        }
    })

    it('reports invalid group codes on their own line', () => {
        for (const text of [
            'abc',
            '',
            '1.0',
            '0x9',
            '1e1',
            '99999999999999999999',
        ]) {
            expect(
                tokenizeDxf(dxf(['  0', 'SECTION', text, 'HEADER'])),
            ).toEqual({
                kind: 'error',
                line: 3,
                message: `Invalid group code ${JSON.stringify(text)}.`,
            })
        }
    })

    it('reports a group code without a value', () => {
        expect(tokenizeDxf('  0\nSECTION\n  2')).toEqual({
            kind: 'error',
            line: 3,
            message: 'Group code 2 has no value.',
        })
    })

    it('reports a file that ends without EOF', () => {
        for (const [text, line] of [
            ['', 1],
            ['  0\nSECTION\n', 3],
            ['  0\nSECTION', 3],
            ['  0\nSECTION\n  0\nENDSEC\n', 5],
        ] as const) {
            expect(tokenizeDxf(text)).toEqual({
                kind: 'error',
                line,
                message: 'The file ends without 0/EOF.',
            })
        }
    })

    it('ignores anything after EOF', () => {
        expect(
            tokenizeDxf(dxf(['  0', 'EOF', 'junk', '  0', 'SECTION'])),
        ).toEqual({
            kind: 'tokens',
            tokens: [{ code: 0, value: 'EOF', line: 1 }],
        })
        expect(tokenizeDxf('  0\nEOF')).toEqual({
            kind: 'tokens',
            tokens: [{ code: 0, value: 'EOF', line: 1 }],
        })
    })

    it('shortens long text quoted in errors', () => {
        const long = 'x'.repeat(10_000)

        expect(tokenizeDxf(`${long}\nvalue\n`)).toEqual({
            kind: 'error',
            line: 1,
            message: `Invalid group code "${'x'.repeat(40)}…".`,
        })
    })

    it('returns a result for random malformed input without throwing', () => {
        const fragments = [
            '  0',
            'EOF',
            'SECTION',
            ' 10',
            ' 70',
            '1.5',
            '-',
            'e',
            '.',
            '9',
            ' ',
            '',
            'junk',
            '\r',
            '\n',
            '\r\n',
        ]
        const random = seededRandom(44)

        for (let sample = 0; sample < 2_000; sample += 1) {
            const length = Math.floor(random.between(0, 40))
            const text = Array.from(
                { length },
                () =>
                    fragments[Math.floor(random.between(0, fragments.length))],
            ).join('')
            const result = tokenizeDxf(text)

            if (result.kind === 'tokens') {
                expect(result.tokens.at(-1)).toMatchObject({
                    code: 0,
                    value: 'EOF',
                })
            } else {
                expect(result.line).toBeGreaterThanOrEqual(1)
                expect(result.line).toBeLessThanOrEqual(
                    text.split('\n').length + 1,
                )
            }
        }
    })
})
