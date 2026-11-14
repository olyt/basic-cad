import { describe, expect, it } from 'vitest'
import { readDxfLinetypes } from './linetypes'
import { readDxfTables } from './tables'
import { tokenizeDxf } from './tokenize'

function read(body: string) {
    const tokens = tokenizeDxf(
        `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n${body}0\nENDTAB\n0\nENDSEC\n0\nEOF\n`,
    )

    if (tokens.kind !== 'tokens') {
        throw new Error(tokens.message)
    }

    const tables = readDxfTables(tokens.tokens)

    if (tables.kind !== 'tables') {
        throw new Error(tables.message)
    }

    return readDxfLinetypes(tables.tables[0]!)
}

function record(name: string): string {
    return `0\nLTYPE\n2\n${name}\n70\n0\n72\n65\n73\n0\n40\n0\n`
}

describe('DXF linetype definitions', () => {
    it.each([
        ['bYlAyEr', 'by-layer'],
        ['BYBLOCK', 'by-block'],
        ['Continuous', 'continuous'],
    ])('recognizes zero-pattern %s', (name, value) => {
        const [item] = read(
            record(name).replace('70\n0', '70\n64') +
                '5\nAB\n3\nSolid\n100\nAcDbLinetypeTableRecord\n330\n2\n',
        )

        expect(item).toMatchObject({ name, value })
        expect(item?.record.line).toBe(9)
        expect(item?.reason).toBeUndefined()
    })

    it.each([
        record('DASHED'),
        record(' CONTINUOUS '),
        record('CONTINUOUS') + '49\n1\n',
        record('CONTINUOUS') + '102\n{APP\n',
        record('CONTINUOUS').replace('73\n0', '73\n1'),
        record('CONTINUOUS').replace('40\n0', '40\n1'),
        record('CONTINUOUS').replace('72\n65', '72\n0'),
        record('CONTINUOUS').replace('70\n0', '70\n4'),
        record('CONTINUOUS').replace('40\n0\n', ''),
        record('CONTINUOUS').replace('2\nCONTINUOUS\n', ''),
        record('CONTINUOUS') + '73\n0\n',
        record('CONTINUOUS') + '5\nAB\n5\nAC\n',
    ])('retains unsupported or incomplete definitions: %s', (body) => {
        const [item] = read(body)

        expect(item?.value).toBeUndefined()
        expect(item?.reason).toEqual(expect.any(String))
        expect(item?.record.tokens.length).toBeGreaterThan(0)
    })

    it('decodes isolated names and invalidates all colliding definitions', () => {
        const items = read(record('\\U+0043ONTINUOUS') + record(' continuous '))

        expect(items.map(({ name }) => name)).toEqual([
            'CONTINUOUS',
            ' continuous ',
        ])
        expect(items.map(({ value }) => value)).toEqual([undefined, undefined])
        expect(items.map(({ reason }) => typeof reason)).toEqual([
            'string',
            'string',
        ])
    })
})
