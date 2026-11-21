import { describe, expect, it } from 'vitest'
import { createAciColor } from '../document/properties'
import { createArc, createCircle, createLine } from '../geometry/curve'
import { seededRandom, type TestRandom } from '../test-support/random'
import { indexDxfReferences } from './entity-properties'
import { records, type DxfRecord } from './inventory'
import { type DxfLayer } from './layers'
import { readDxfPrimitive } from './primitives'
import { tokenizeDxf, type DxfToken } from './tokenize'

type Group = readonly [code: number, value: string]

const layer: DxfLayer = {
    record: { type: 'LAYER', line: 1, tokens: [] },
    name: 'Plan',
    issues: [],
    value: {
        name: 'Plan',
        color: createAciColor(7),
        visible: true,
        frozen: false,
        locked: false,
        lineweight: 'default',
        linetype: 'continuous',
    },
}
const references = indexDxfReferences({ layers: [layer], linetypes: [] })
// Six lines of record header, so body group k starts on file line 5 + 2k.
const header = '5\nA1\n8\nPlan\n'
const line = '10\n1\n20\n2\n30\n0\n11\n4\n21\n6\n31\n0\n'
const circle = '10\n1\n20\n2\n30\n0\n40\n3\n'
const flipped = '210\n0\n220\n0\n230\n-1\n'
const fuzzTemplate = new Map([
    [10, 1],
    [20, 2],
    [30, 0],
    [11, 4],
    [21, 6],
    [31, 0],
    [40, 3],
    [50, 0],
    [51, 90],
    [210, 0],
    [220, 0],
    [230, 1],
])
const fuzzValues = [
    0,
    -0,
    1,
    -1,
    90,
    360,
    -360,
    1e15,
    -1e15,
    1e15 + 0.125,
    5e-324,
    1e-300,
    1e308,
    -1e308,
    359.99999999999994,
    Number.MAX_VALUE,
]

function arc(start: number | string, end: number | string): string {
    return `${circle}50\n${start}\n51\n${end}\n`
}

function codeIndex(lines: readonly string[], code: number): number {
    return lines.findIndex((text, at) => at % 2 === 0 && text === String(code))
}

function withGroup(body: string, [code, value]: Group): string {
    const lines = body.split('\n')

    lines[codeIndex(lines, code) + 1] = value

    return lines.join('\n')
}

function without(body: string, code: number): string {
    const lines = body.split('\n')

    lines.splice(codeIndex(lines, code), 2)

    return lines.join('\n')
}

function read(type: string, body: string) {
    const result = tokenizeDxf(`0\n${type}\n${header}${body}0\nEOF\n`)

    if (result.kind !== 'tokens') {
        throw new Error(result.message)
    }

    return readDxfPrimitive(records(result.tokens).next().value!, references)
}

function codes(type: string, body: string) {
    return read(type, body).issues.map(({ code }) => code)
}

function pick<T>(random: TestRandom, items: readonly T[]): T {
    return items[Math.floor(random.between(0, items.length))] as T
}

// Mostly valid groups, so many entities pass and the rest fail one or two checks.
function randomRecord(random: TestRandom): DxfRecord {
    const tokens: DxfToken[] = [{ code: 8, value: 'Plan', line: 2 }]

    for (const [code, valid] of fuzzTemplate) {
        const count = pick(random, [0, 1, 1, 1, 1, 1, 1, 2])

        for (let index = 0; index < count; index += 1) {
            const value =
                random.between(0, 1) < 0.8 ? valid : pick(random, fuzzValues)

            tokens.push({ code, value, line: 2 * tokens.length + 2 })
        }
    }

    return { type: pick(random, ['LINE', 'CIRCLE', 'ARC']), line: 1, tokens }
}

describe('DXF LINE, CIRCLE and ARC reader', () => {
    it('assembles each primitive with its common properties and provenance', () => {
        const properties = {
            layerName: 'Plan',
            color: 'by-layer',
            lineweight: 'by-layer',
            linetype: 'by-layer',
        }

        expect(read('LINE', line)).toEqual({
            record: expect.objectContaining({ type: 'LINE', line: 1 }),
            handle: 'A1',
            value: {
                ...properties,
                geometry: createLine({ x: 1, y: 2 }, { x: 4, y: 6 }),
            },
            issues: [],
        })
        expect(read('CIRCLE', circle).value).toEqual({
            ...properties,
            geometry: createCircle({ x: 1, y: 2 }, 3),
        })
        expect(read('ARC', arc(0, 90)).value?.geometry).toEqual(
            createArc({
                center: { x: 1, y: 2 },
                radius: 3,
                startAngle: 0,
                sweep: Math.PI / 2,
            }),
        )
    })

    it.each([
        { start: 350, end: 10, from: 350, sweep: 20 },
        { start: 90, end: 0, from: 90, sweep: 270 },
        { start: -90, end: 0, from: 270, sweep: 90 },
        { start: 370, end: 380, from: 10, sweep: 10 },
        { start: 10, end: 9.5, from: 10, sweep: 359.5 },
        { start: -720.5, end: 0, from: 359.5, sweep: 0.5 },
        {
            start: 0,
            end: 359.99999999999994,
            from: 0,
            sweep: 359.99999999999994,
        },
        { start: -1e-20, end: 90, from: 0, sweep: 90 },
        { start: 1e20, end: 0, from: 280, sweep: 80 },
        { start: 1e16, end: 1, from: 280, sweep: 81 },
        { start: 90, end: 1e20, from: 90, sweep: 190 },
    ])(
        'reads ARC $start° → $end° counterclockwise as start $from°, sweep $sweep°',
        ({ start, end, from, sweep }) => {
            expect(read('ARC', arc(start, end)).value?.geometry).toMatchObject({
                type: 'arc',
                startAngle: expect.closeTo((from * Math.PI) / 180, 12),
                sweep: expect.closeTo((sweep * Math.PI) / 180, 12),
            })
        },
    )

    it.each([
        { start: 360, end: 1e-14, span: 1e-14 },
        { start: -(2 ** -49), end: -(2 ** -50), span: 2 ** -50 },
    ])(
        'preserves a tiny sweep from $start° to $end°',
        ({ start, end, span }) => {
            const item = read('ARC', arc(start, end))
            const expected = span * (Math.PI / 180)

            expect(item.issues).toEqual([])
            expect(item.value?.geometry).toMatchObject({
                type: 'arc',
                sweep: expect.closeTo(expected, 30),
            })
        },
    )

    it('keeps a near-full sweep that rounds to a partial turn in radians', () => {
        expect(read('ARC', arc(2 ** -45, 0)).value?.geometry).toMatchObject({
            type: 'arc',
            sweep: 2 * Math.PI - 2 ** -50,
        })
    })

    it.each([
        [10, 10],
        [0, 360],
        [-180, 180],
        [0, '359.99999999999999'],
        ['1.7e308', '-1.7e308'],
        ['1e-20', 0],
        [1e20, 280],
        [0, Number.MIN_VALUE],
    ])(
        'rejects ARC %s° → %s° instead of inventing a zero or full turn',
        (start, end) => {
            const item = read('ARC', arc(start, end))

            expect(item.value).toBeUndefined()
            expect(item.handle).toBe('A1')
            expect(item.issues).toEqual([
                expect.objectContaining({
                    kind: 'unsupported',
                    code: 51,
                    line: 17,
                }),
            ])
        },
    )

    it('reports coordinates and radii outside ±1e15 drawing units with the handle', () => {
        for (const [code, at] of [
            [10, 7],
            [20, 9],
            [11, 13],
            [21, 15],
        ] as const) {
            const item = read(
                'LINE',
                withGroup(line, [code, '-1000000000000000.2']),
            )

            expect(codes('LINE', withGroup(line, [code, '-1e15']))).toEqual([])
            expect(item.handle).toBe('A1')
            expect(item.value).toBeUndefined()
            expect(item.issues).toEqual([
                expect.objectContaining({
                    kind: 'unsupported',
                    code,
                    line: at,
                }),
            ])
        }

        expect(codes('CIRCLE', withGroup(circle, [40, '1e15']))).toEqual([])

        for (const radius of ['0', '-3', '1000000000000000.2']) {
            expect(codes('CIRCLE', withGroup(circle, [40, radius]))).toEqual([
                40,
            ])
        }
    })

    it.each([
        { type: 'LINE', body: line, required: [10, 20, 11, 21] },
        { type: 'CIRCLE', body: circle, required: [10, 20, 40] },
        { type: 'ARC', body: arc(0, 90), required: [10, 20, 40, 50, 51] },
    ])(
        'requires exactly one of each $type geometry group',
        ({ type, body, required }) => {
            for (const code of required) {
                expect(codes(type, without(body, code)), `no ${code}`).toEqual([
                    code,
                ])
                expect(
                    codes(type, `${body}${code}\n1\n`),
                    `two ${code}`,
                ).toEqual([code])
            }
        },
    )

    it('defaults Z to zero, allows at most one Z group and never flattens nonzero Z', () => {
        expect(codes('LINE', without(without(line, 30), 31))).toEqual([])
        expect(codes('LINE', withGroup(line, [31, '-0.0']))).toEqual([])
        expect(codes('LINE', withGroup(line, [31, '-1']))).toEqual([31])
        expect(codes('CIRCLE', withGroup(circle, [30, '0.5']))).toEqual([30])
        expect(read('ARC', `${arc(0, 90)}30\n0\n`).issues).toEqual([
            {
                kind: 'unsupported',
                code: 30,
                line: 19,
                message: 'ARC needs at most one numeric group 30.',
            },
        ])
        expect(read('ARC', without(arc(0, 90), 10)).issues).toEqual([
            {
                kind: 'unsupported',
                code: 10,
                line: 1,
                message: 'ARC needs exactly one numeric group 10.',
            },
        ])
    })

    it('leaves flipped and other extrusions unconverted, keeping only WCS LINE geometry', () => {
        expect(codes('CIRCLE', `${circle}210\n0\n220\n0\n230\n1\n`)).toEqual([])

        const flippedLine = read('LINE', line + flipped)

        expect(flippedLine.value?.geometry).toEqual(
            read('LINE', line).value?.geometry,
        )
        expect(flippedLine.issues).toEqual([
            expect.objectContaining({
                kind: 'unsupported',
                code: 230,
                line: 23,
            }),
        ])

        for (const [type, body] of [
            ['CIRCLE', circle],
            ['ARC', arc(0, 90)],
        ] as const) {
            expect(read(type, body + flipped).value).toBeUndefined()
            expect(codes(type, body + flipped)).toEqual([230])
        }

        expect(codes('CIRCLE', `${circle}210\n1\n220\n0\n230\n0\n`)).toEqual([
            210,
        ])
        expect(codes('CIRCLE', `${circle}230\n1\n230\n1\n`)).toEqual([230])
    })

    it('rejects a zero-length LINE without reaching the curve constructor', () => {
        const body = withGroup(withGroup(line, [11, '1']), [21, '2.0'])

        expect(read('LINE', body).value).toBeUndefined()
        expect(codes('LINE', body)).toEqual([11])
        expect(codes('LINE', withGroup(line, [11, '1']))).toEqual([])
        expect(codes('LINE', withGroup(line, [21, '2']))).toEqual([])
    })

    it('keeps application and XDATA payloads out of geometry groups', () => {
        const payload =
            '102\n{APP\n40\n9\n230\n-1\n102\n}\n1001\nAPP\n1010\n7\n1040\n9\n'

        expect(read('CIRCLE', circle + payload).value?.geometry).toEqual(
            read('CIRCLE', circle).value?.geometry,
        )
        expect(codes('CIRCLE', without(circle, 40) + payload)).toEqual([40])
    })

    it('reports property and geometry issues together and rejects other entity types', () => {
        const item = read('ARC', `${arc(5, 5)}8\nOther\n`)

        expect(item.handle).toBe('A1')
        expect(item.value).toBeUndefined()
        expect(item.issues.map(({ code }) => code)).toEqual([8, 51])
        expect(read('LINE', `${line}8\nOther\n`)).toMatchObject({
            handle: 'A1',
            issues: [expect.objectContaining({ code: 8 })],
        })
        expect(read('LINE', `${line}8\nOther\n`).value).toBeUndefined()
        expect(read('POINT', '10\n0\n20\n0\n').issues).toEqual([
            expect.objectContaining({ code: 0, line: 1 }),
        ])
    })

    it('reports every rejected random entity without a curve constructor throwing', () => {
        const random = seededRandom(48)
        const items = Array.from({ length: 3_000 }, () =>
            readDxfPrimitive(randomRecord(random), references),
        )
        const unreported = items.filter(
            ({ value, issues }) => value === undefined && issues.length === 0,
        )

        expect(unreported).toEqual([])
        expect(
            items.filter(({ value }) => value !== undefined).length,
        ).toBeGreaterThan(100)
    })
})
