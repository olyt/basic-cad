import { describe, expect, it } from 'vitest'
import { LINEWEIGHT_VALUES } from '../document/properties'
import { readDxfLayers, type DxfLayer, type LayerIssueKind } from './layers'
import { readDxfLinetypes } from './linetypes'
import { readDxfTables } from './tables'
import { tokenizeDxf } from './tokenize'

const continuous = '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n72\n65\n73\n0\n40\n0\n'

function record(name = 'Plan'): string {
    return `0\nLAYER\n2\n${name}\n62\n7\n70\n0\n6\nCONTINUOUS\n370\n-3\n`
}

function read(body = record(), definitions = continuous) {
    const tokens = tokenizeDxf(
        `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n${definitions}0\nENDTAB\n0\nTABLE\n2\nLAYER\n${body}0\nENDTAB\n0\nENDSEC\n0\nEOF\n`,
    )

    if (tokens.kind !== 'tokens') {
        throw new Error(tokens.message)
    }

    const tables = readDxfTables(tokens.tokens)

    if (tables.kind !== 'tables') {
        throw new Error(tables.message)
    }

    return readDxfLayers(tables.tables[1]!, readDxfLinetypes(tables.tables[0]!))
}

function issueCodes(item: DxfLayer | undefined, kind: LayerIssueKind) {
    return item?.issues
        .filter((issue) => issue.kind === kind)
        .map(({ code }) => code)
}

describe('DXF layer normalization', () => {
    it.each([7, -7, 255, -255])('maps signed ACI %s', (color) => {
        expect(
            read(record().replace('62\n7', `62\n${color}`))[0]?.value,
        ).toMatchObject({
            color: Math.abs(color),
            visible: color > 0,
            lineweight: 'default',
        })
    })

    it.each([
        [0, [true, false, false]],
        [1, [false, true, false]],
        [2, [true, false, false]],
        [4, [true, false, true]],
        [5, [false, true, true]],
        [16, [true, false, false]],
        [32, [true, false, false]],
        [64, [true, false, false]],
    ] as const)('maps flags %s', (flags, expected) => {
        const [item] = read(record().replace('70\n0', `70\n${flags}`))

        expect([
            item?.value?.visible,
            item?.value?.frozen,
            item?.value?.locked,
        ]).toEqual(expected)
        expect(issueCodes(item, 'converted')).toEqual(expected[1] ? [70] : [])
        expect(issueCodes(item, 'unsupported')).toEqual(
            [2, 16, 32].includes(flags) ? [70] : [],
        )

        for (const issue of item!.issues) {
            expect(issue.line).toBe(33)
        }
    })

    it('reads all explicit lineweights', () => {
        for (const weight of LINEWEIGHT_VALUES) {
            expect(
                read(record().replace('370\n-3', `370\n${weight}`))[0]?.value
                    ?.lineweight,
            ).toBe(weight)
        }
    })

    it.each([
        [' Plan ', ' Plan '],
        ['План😀', 'План😀'],
        ['\\U+0041\\U+D83D\\U+DE00', 'A😀'],
    ])('keeps exact decoded layer names: %s', (source, name) => {
        const [item] = read(record(source))

        expect(item?.value?.name).toBe(name)
        expect(item?.record.tokens).toContainEqual(
            expect.objectContaining({ code: 2, value: source }),
        )
    })

    it.each([
        ['Plan', 'plan'],
        ['Plan', ' Plan '],
        ['K', 'K'],
        ['ß', 'SS'],
    ])('invalidates every colliding name: %s / %s', (left, right) => {
        const items = read(record(left) + record(right))

        expect(items.map(({ name }) => name)).toEqual([left, right])
        expect(items.map(({ value }) => value)).toEqual([undefined, undefined])
        expect(items.map((item) => issueCodes(item, 'unsupported'))).toEqual([
            [2],
            [2],
        ])
    })

    it.each([
        [
            2,
            [
                '',
                ' ',
                'Bad*',
                'A'.repeat(256),
                '\u0000',
                '\\U+000A',
                '\\U+D800',
            ],
        ],
        [6, ['BYLAYER', 'DASHED', ' CONTINUOUS ']],
        [62, [0, 256, -256]],
        [70, [-1, 32768]],
        [370, [-1, -2, 17]],
    ] as const)('rejects group %s', (code, invalid) => {
        const field = record().match(new RegExp(`\n${code}\n[^\n]*\n`))![0]
        const bodies = [
            record().replace(field, '\n'),
            record() + field.slice(1),
            ...invalid.map((value) =>
                record().replace(field, `\n${code}\n${value}\n`),
            ),
        ]

        expect(read(bodies[0])[0]?.issues[0]?.line).toBe(27)

        for (const body of bodies) {
            const [item] = read(body)

            expect(item?.value, body).toBeUndefined()
            expect(issueCodes(item, 'unsupported')).toEqual([code])
        }
    })

    it.each([
        '',
        continuous + continuous,
        continuous.replace('73\n0', '73\n1'),
    ])('requires one supported continuous definition: %s', (definitions) => {
        const [item] = read(record(), definitions)

        expect(item?.value).toBeUndefined()
        expect(issueCodes(item, 'unsupported')).toEqual([6])
    })

    it.each([
        '290\n0\n',
        '420\n16711680\n',
        '102\n{APP\n62\n1\n102\n}\n',
        '5\nA\n5\nB\n',
        '330\nA\n330\nB\n',
        '390\nA\n390\nB\n',
    ])('retains unsupported groups: %s', (extra) => {
        const [item] = read(record() + extra)

        expect(item?.value?.name).toBe('Plan')
        expect(item?.value?.color).toBe(7)
        expect(issueCodes(item, 'unsupported')).toHaveLength(1)
        expect(String(item?.record.tokens.at(-1)?.value)).toBe(
            extra.trimEnd().split('\n').at(-1),
        )
    })

    it('accepts plotting and repeated subclass markers without creating issues', () => {
        expect(
            read(
                record() +
                    '290\n1\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n',
            )[0]?.issues,
        ).toEqual([])
    })

    it.each([
        ['290\n0\n', 'Layer is set not to plot; the plot setting is not kept.'],
        ['290\n1\n290\n1\n', 'Unsupported or repeated LAYER group 290.'],
        ['290\n2\n', 'Unsupported or repeated LAYER group 290.'],
    ])('explains the unsupported plot flag %j', (extra, message) => {
        expect(read(record() + extra)[0]?.issues).toEqual([
            expect.objectContaining({
                kind: 'unsupported',
                code: 290,
                message,
            }),
        ])
    })

    it('does not read missing primary color from application metadata', () => {
        const body =
            record().replace('62\n7\n', '') + '102\n{APP\n62\n1\n102\n}\n'
        const [item] = read(body)

        expect(item?.value).toBeUndefined()
        expect(item?.issues).toContainEqual(
            expect.objectContaining({ code: 62, line: item?.record.line }),
        )
    })

    it('rejects non-layer tables and retains their records', () => {
        const source = read()[0]!.record
        const [item] = readDxfLayers(
            {
                type: 'TABLE',
                name: 'OTHER',
                line: 1,
                tokens: [],
                entries: [source],
            },
            [],
        )

        expect(item?.record).toBe(source)
        expect(item?.value).toBeUndefined()
        expect(issueCodes(item, 'unsupported')).toEqual([0])
    })
})
