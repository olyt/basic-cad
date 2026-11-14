import { describe, expect, it } from 'vitest'
import { readDxfTables } from './tables'
import { tokenizeDxf } from './tokenize'

function read(text: string) {
    const result = tokenizeDxf(`${text}0\nEOF\n`)

    if (result.kind !== 'tokens') {
        throw new Error(result.message)
    }

    return readDxfTables(result.tokens)
}

function tables(body: string) {
    return read(`0\nSECTION\n2\nTABLES\n${body}0\nENDSEC\n`)
}

describe('DXF table records', () => {
    it('keeps source order, header groups and exact record values, ignoring comments', () => {
        const result = tables(
            '0\nTABLE\n2\nLAYER\n70\n99\n0\nLAYER\n999\ncomment\n2\n  Plan  \n5\nAB\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n0\nENDTAB\n',
        )
        const items = result.kind === 'tables' ? result.tables : []

        expect(
            items.map(({ name, line, entries }) => [
                name,
                line,
                entries.length,
            ]),
        ).toEqual([
            ['LAYER', 5, 1],
            ['LTYPE', 21, 0],
        ])
        expect(items.flatMap(({ tokens }) => tokens)).toEqual([
            { code: 2, value: 'LAYER', line: 7 },
            { code: 70, value: 99, line: 9 },
            { code: 2, value: 'LTYPE', line: 23 },
        ])
        expect(items[0]?.entries).toEqual([
            {
                type: 'LAYER',
                line: 11,
                tokens: [
                    { code: 2, value: '  Plan  ', line: 15 },
                    { code: 5, value: 'AB', line: 17 },
                ],
            },
        ])
    })

    it('does not read table-like groups outside TABLES and allows an omitted section', () => {
        expect(
            read('0\nSECTION\n2\nHEADER\n9\n$CLAYER\n8\nLTYPE\n0\nENDSEC\n'),
        ).toEqual({ kind: 'tables', tables: [] })
        expect(tables('')).toEqual({ kind: 'tables', tables: [] })
    })

    it.each([
        '0\nTABLE\n2\nLTYPE\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n0\nENDTAB\n',
        '0\nTABLE\n2\nLTYPE\n2\nLTYPE\n0\nENDTAB\n',
        '0\nTABLE\n2\nLTYPE\n0\nLAYER\n2\nWrong\n0\nENDTAB\n',
        '0\nTABLE\n2\nLTYPE\n',
        '0\nENDSEC\n0\nSECTION\n2\nTABLES\n',
    ])('reports duplicates or malformed table structure: %s', (body) => {
        expect(tables(body)).toEqual({
            kind: 'error',
            line: expect.any(Number),
            message: expect.any(String),
        })
    })
})
