import { describe, expect, it } from 'vitest'
import { createAciColor } from '../document/properties'
import { segmentEndpoints } from '../geometry/segment'
import { type Vector2 } from '../geometry/vector'
import { seededRandom, type TestRandom } from '../test-support/random'
import { indexDxfReferences } from './entity-properties'
import { records, type DxfRecord } from './inventory'
import { type DxfLayer } from './layers'
import { readDxfPolyline } from './polylines'
import { tokenizeDxf, type DxfToken } from './tokenize'

type Vertex = readonly [
    x: number | string,
    y: number | string,
    bulge?: number | string,
]

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
const modelTolerance = { distance: 1e-7 }
const properties = {
    layerName: 'Plan',
    color: 'by-layer',
    lineweight: 'by-layer',
    linetype: 'by-layer',
}
const flipped = '210\n0\n220\n0\n230\n-1\n'
// Six lines of record header, so body group k starts on file line 7 + 2k.
const header = '5\nA1\n8\nPlan\n'
// Groups 90, 10, 20, 10, 20, 10, 20 on lines 7–19.
const lines = polyline([
    [0, 0],
    [10, 0],
    [10, 10],
])
// Groups 90, 10, 20, 42, 10, 20, 10, 20 on lines 7–21.
const bulged = polyline([
    [0, 0, -1],
    [10, 0],
    [10, 10],
])

function vertices(points: readonly Vertex[]): string {
    return points
        .map(([x, y, bulge]) => {
            const arc = bulge === undefined ? '' : `42\n${bulge}\n`

            return `10\n${x}\n20\n${y}\n${arc}`
        })
        .join('')
}

function polyline(points: readonly Vertex[], flags = ''): string {
    return `90\n${points.length}\n${flags}${vertices(points)}`
}

function read(
    body: string,
    options: { type?: string; distance?: number } = {},
) {
    const { type = 'LWPOLYLINE', distance = modelTolerance.distance } = options
    const result = tokenizeDxf(`0\n${type}\n${header}${body}0\nEOF\n`)

    if (result.kind !== 'tokens') {
        throw new Error(result.message)
    }

    return readDxfPolyline(records(result.tokens).next().value!, {
        references,
        modelTolerance: { distance },
    })
}

function codes(body: string) {
    return read(body).issues.map(({ code }) => code)
}

function located(body: string) {
    return read(body).issues.map(({ code, line, vertex }) => ({
        code,
        line,
        vertex,
    }))
}

function arcNear(arc: {
    center: Vector2
    radius: number
    startAngle: number
    sweep: number
}) {
    return {
        type: 'arc',
        center: {
            x: expect.closeTo(arc.center.x, 12),
            y: expect.closeTo(arc.center.y, 12),
        },
        radius: expect.closeTo(arc.radius, 12),
        startAngle: expect.closeTo(arc.startAngle, 12),
        sweep: expect.closeTo(arc.sweep, 12),
    }
}

function pick<T>(random: TestRandom, items: readonly T[]): T {
    return items[Math.floor(random.between(0, items.length))] as T
}

function chance(random: TestRandom, probability: number): boolean {
    return random.between(0, 1) < probability
}

// Mostly valid vertices, so many polylines pass and the rest fail one or two checks.
function randomPolyline(random: TestRandom) {
    const count = pick(random, [0, 1, 2, 3, 3, 4, 5, 6])
    const closed = chance(random, 0.5)
    const points = Array.from({ length: count }, () => ({
        x: chance(random, 0.95)
            ? Math.floor(random.between(0, 9))
            : pick(random, [1e15, -1e15 - 0.25, 5e-324]),
        y: Math.floor(random.between(0, 9)),
        bulge: chance(random, 0.6)
            ? 0
            : pick(random, [1, -1, 0.5, -3, 1e-9, 1e-300, 1e300, Number.NaN]),
    }))
    const tokens: DxfToken[] = [{ code: 8, value: 'Plan', line: 2 }]
    const push = (code: number, value: number) =>
        tokens.push({ code, value, line: 2 * tokens.length + 2 })

    push(90, chance(random, 0.95) ? count : count + 1)
    push(70, chance(random, 0.95) ? Number(closed) : 128)

    for (const { x, y, bulge } of points) {
        push(10, x)
        push(20, y)

        if (chance(random, 0.03)) {
            push(chance(random, 0.5) ? 20 : 40, 1)
        }

        push(42, bulge)
    }

    const record: DxfRecord = { type: 'LWPOLYLINE', line: 1, tokens }

    return { record, points, closed }
}

describe('DXF LWPOLYLINE reader', () => {
    it('assembles an open polyline with properties, provenance and a clockwise bulge', () => {
        expect(read(bulged)).toEqual({
            record: expect.objectContaining({ type: 'LWPOLYLINE', line: 1 }),
            handle: 'A1',
            value: {
                ...properties,
                geometry: {
                    type: 'polyline',
                    closed: false,
                    segments: [
                        arcNear({
                            center: { x: 5, y: 0 },
                            radius: 5,
                            startAngle: Math.PI,
                            sweep: -Math.PI,
                        }),
                        {
                            type: 'line',
                            start: { x: 10, y: 0 },
                            end: { x: 10, y: 10 },
                        },
                    ],
                },
            },
            issues: [],
        })
    })

    it('closes a polyline from flag 1, using the last vertex bulge for the closing segment', () => {
        const body = polyline(
            [
                [0, 0],
                [10, 0, 1],
                [10, 10],
                [0, 10, '1.0'],
            ],
            '70\n1\n',
        )

        expect(read(body).value?.geometry).toEqual({
            type: 'polyline',
            closed: true,
            segments: [
                { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                arcNear({
                    center: { x: 10, y: 5 },
                    radius: 5,
                    startAngle: 1.5 * Math.PI,
                    sweep: Math.PI,
                }),
                {
                    type: 'line',
                    start: { x: 10, y: 10 },
                    end: { x: 0, y: 10 },
                },
                arcNear({
                    center: { x: 0, y: 5 },
                    radius: 5,
                    startAngle: Math.PI / 2,
                    sweep: Math.PI,
                }),
            ],
        })
        expect(read(lines).value?.geometry.closed).toBe(false)
        expect(
            read(
                polyline(
                    [
                        [0, 0],
                        [10, 0],
                    ],
                    '70\n0\n',
                ),
            ).value?.geometry,
        ).toMatchObject({ closed: false, segments: [{ type: 'line' }] })
        expect(
            read(
                polyline(
                    [
                        [0, 0, 1],
                        [10, 0, 1],
                    ],
                    '70\n1\n',
                ),
            ).value?.geometry.segments,
        ).toHaveLength(2)
    })

    it.each([
        {
            body: lines.slice(5),
            code: 90,
            message: 'LWPOLYLINE needs exactly one numeric group 90.',
        },
        {
            body: `90\n3\n${lines}`,
            code: 90,
            message: 'LWPOLYLINE needs exactly one numeric group 90.',
        },
        {
            body: polyline([[0, 0]]),
            code: 90,
            message: 'LWPOLYLINE needs at least two vertices.',
        },
        {
            body: `90\n4\n${lines.slice(5)}`,
            code: 90,
            message: 'Group 90 declares 4 vertices, but the record has 3.',
        },
        {
            body: `90\n2\n${lines.slice(5)}`,
            code: 90,
            message: 'Group 90 declares 2 vertices, but the record has 3.',
        },
        {
            body: `70\n128\n${lines}`,
            code: 70,
            message: 'Polyline flags other than closed (1) are not supported.',
        },
        {
            body: `70\n129\n${lines}`,
            code: 70,
            message: 'Polyline flags other than closed (1) are not supported.',
        },
        {
            body: `70\n0\n70\n0\n${lines}`,
            code: 70,
            message: 'LWPOLYLINE needs at most one numeric group 70.',
        },
        {
            body: `43\n0.5\n${lines}`,
            code: 43,
            message: 'Nonzero polyline width is not supported.',
        },
        {
            body: `38\n2\n${lines}`,
            code: 38,
            message: 'Nonzero Z (group 38) is not supported.',
        },
    ])('reports header group $code: $message', ({ body, code, message }) => {
        const item = read(body)

        expect(item.handle).toBe('A1')
        expect(item.value).toBeUndefined()
        expect(item.issues).toEqual([
            expect.objectContaining({ kind: 'unsupported', code, message }),
        ])
        expect(item.issues[0]).not.toHaveProperty('vertex')
    })

    it('accepts zero width and elevation, and reports header issues at their own line', () => {
        expect(codes(`43\n0\n38\n-0.0\n${lines}`)).toEqual([])
        expect(located(`38\n0\n38\n0\n${lines}`)).toEqual([
            { code: 38, line: 9, vertex: undefined },
        ])
        expect(located(lines.slice(5))).toEqual([
            { code: 90, line: 1, vertex: undefined },
        ])
    })

    it('reports vertex coordinates outside ±1e15 drawing units with their vertex index', () => {
        const at = (point: Vertex, index: number) => {
            const points: Vertex[] = [
                [0, 0],
                [10, 0],
                [10, 10],
            ]

            points[index] = point

            return polyline(points)
        }

        expect(located(at(['-1000000000000000.2', 0], 1))).toEqual([
            { code: 10, line: 13, vertex: 1 },
        ])
        expect(located(at([10, '1000000000000000.2'], 2))).toEqual([
            { code: 20, line: 19, vertex: 2 },
        ])
        expect(codes(at([-1e15, 0], 1))).toEqual([])
        expect(codes(at([10, 1e15], 2))).toEqual([])
        expect(read(at([-2e15, 0], 1)).issues[0]?.message).toBe(
            'Coordinate group 10 is outside ±1e+15 drawing units.',
        )
    })

    it('reports nonzero vertex widths and accepts explicit zero widths', () => {
        const widths = (groups: string) =>
            `90\n2\n10\n0\n20\n0\n10\n1\n20\n0\n${groups}`

        expect(located(widths('40\n0.5\n'))).toEqual([
            { code: 40, line: 17, vertex: 1 },
        ])
        expect(located(widths('41\n-1\n'))).toEqual([
            { code: 41, line: 17, vertex: 1 },
        ])
        expect(codes(widths('40\n0\n41\n0\n42\n0\n'))).toEqual([])
    })

    it('requires each vertex to be 10 then 20, followed by at most one 40, 41 and 42', () => {
        expect(located(`20\n5\n${lines}`)).toEqual([
            { code: 20, line: 7, vertex: undefined },
        ])
        expect(read(`20\n5\n${lines}`).issues[0]).not.toHaveProperty('vertex')
        expect(located('90\n2\n10\n0\n42\n1\n20\n0\n10\n1\n20\n0\n')).toEqual([
            { code: 42, line: 11, vertex: 0 },
        ])
        expect(
            located('90\n2\n10\n0\n20\n0\n42\n1\n42\n1\n10\n1\n20\n0\n'),
        ).toEqual([{ code: 42, line: 15, vertex: 0 }])
        expect(located('90\n2\n10\n0\n20\n0\n20\n0\n10\n1\n20\n0\n')).toEqual([
            { code: 20, line: 13, vertex: 0 },
        ])
        expect(read('90\n2\n10\n0\n10\n1\n20\n0\n').issues).toEqual([
            {
                kind: 'unsupported',
                code: 20,
                line: 9,
                message: 'Vertex needs one group 20 after its group 10.',
                vertex: 0,
            },
        ])
    })

    it('rejects zero-length segments, including a closing segment back onto a repeated first vertex', () => {
        expect(
            located(
                polyline([
                    [0, 0],
                    [1, 2],
                    [1, 2],
                    [3, 3],
                ]),
            ),
        ).toEqual([{ code: 10, line: 13, vertex: 1 }])
        expect(
            located(
                polyline([
                    [0, 0],
                    [-0, 2],
                    [0, 2],
                ]),
            ),
        ).toEqual([{ code: 10, line: 13, vertex: 1 }])
        expect(
            located(
                polyline(
                    [
                        [0, 0],
                        [5, 0],
                        [5, 5],
                        [0, 0],
                    ],
                    '70\n1\n',
                ),
            ),
        ).toEqual([{ code: 10, line: 23, vertex: 3 }])
        expect(
            codes(
                polyline([
                    [0, 0],
                    [5, 0],
                    [5, 5],
                    [0, 0],
                ]),
            ),
        ).toEqual([])
        expect(
            read(
                polyline([
                    [0, 0],
                    [0, 0, 1],
                ]),
            ).issues[0]?.message,
        ).toBe('Segment starting at this vertex has zero length.')
    })

    it.each(['1e-300', '-1e-20', '1e300', '-1e20'])(
        'reports bulge %s, which no arc can preserve, with its vertex and line',
        (bulge) => {
            const item = read(
                polyline([
                    [0, 0, bulge],
                    [10, 0],
                    [10, 10],
                ]),
            )

            expect(item.handle).toBe('A1')
            expect(item.value).toBeUndefined()
            expect(item.issues).toEqual([
                {
                    kind: 'unsupported',
                    code: 42,
                    line: 13,
                    message:
                        'Bulge cannot become an arc without losing geometry.',
                    vertex: 0,
                },
            ])
        },
    )

    it('reports every failing segment, not just the first', () => {
        const body = polyline([
            [0, 0, '1e300'],
            [10, 0],
            [10, 10],
            [10, 10, '1e-300'],
            [20, 20],
        ])

        expect(located(body)).toEqual([
            { code: 42, line: 13, vertex: 0 },
            { code: 10, line: 19, vertex: 2 },
            { code: 42, line: 27, vertex: 3 },
        ])
    })

    it('rejects a bulge on the last vertex of an open polyline, which starts no segment', () => {
        const points: Vertex[] = [
            [0, 0],
            [10, 0],
            [10, 10, 0.5],
        ]

        expect(read(polyline(points)).issues).toEqual([
            {
                kind: 'unsupported',
                code: 42,
                line: 21,
                message:
                    'The last vertex of an open polyline cannot keep a bulge.',
                vertex: 2,
            },
        ])
        expect(codes(polyline(points, '70\n1\n'))).toEqual([])
        expect(
            codes(
                polyline([
                    [0, 0],
                    [10, 0],
                    [10, 10, '-0.0'],
                ]),
            ),
        ).toEqual([])
    })

    it('requires arc ends to meet their vertices within the supplied model tolerance', () => {
        const body = polyline([
            [0, 0, 0.3],
            [1, 0.7],
            [2, 2.7],
        ])

        expect(codes(body)).toEqual([])
        expect(read(body, { distance: 0 }).issues).toEqual(
            [0, 1].map((vertex) => ({
                kind: 'unsupported',
                code: 10,
                line: vertex === 0 ? 9 : 15,
                message:
                    'Segment ends do not meet this vertex within model tolerance.',
                vertex,
            })),
        )
        expect(read(lines, { distance: 0 }).issues).toEqual([])
    })

    it('checks the closing arc against the first vertex', () => {
        const body = polyline(
            [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10, 0.3],
            ],
            '70\n1\n',
        )

        expect(codes(body)).toEqual([])
        expect(
            read(body, { distance: 0 }).issues.map(({ vertex }) => vertex),
        ).toEqual([0, 3])
    })

    it('rejects an invalid model tolerance as a caller error', () => {
        expect(() => read(lines, { distance: Number.NaN })).toThrow(RangeError)
        expect(() => read(lines, { distance: -1 })).toThrow(RangeError)
        expect(() => read('', { distance: Number.NaN })).toThrow(RangeError)
    })

    it('leaves flipped and other extrusions unconverted, withholding the value', () => {
        expect(codes(`${lines}210\n0\n220\n0\n230\n1\n`)).toEqual([])
        expect(read(lines + flipped).value).toBeUndefined()
        expect(located(lines + flipped)).toEqual([
            { code: 230, line: 25, vertex: undefined },
        ])
        expect(codes(`${lines}210\n1\n220\n0\n230\n0\n`)).toEqual([210])
        expect(
            codes(
                polyline([
                    [0, 0],
                    [0, 0],
                ]) + flipped,
            ),
        ).toEqual([230])
        expect(
            codes(
                polyline([
                    [0, 0],
                    ['2e15', 0],
                ]) + flipped,
            ),
        ).toEqual([10, 230])
    })

    it('keeps application and XDATA payloads out of vertices and header groups', () => {
        const payload =
            '102\n{APP\n90\n9\n10\n99\n20\n99\n42\n5\n43\n1\n102\n}\n1001\nAPP\n1010\n7\n1020\n8\n1040\n9\n'

        expect(read(lines + payload).value?.geometry).toEqual(
            read(lines).value?.geometry,
        )
        expect(read(payload + bulged).value?.geometry).toEqual(
            read(bulged).value?.geometry,
        )
    })

    it('reports property and geometry issues together and rejects other entity types', () => {
        const body = `${polyline([
            [0, 0, '1e300'],
            [10, 0],
        ])}8\nOther\n`
        const item = read(body)

        expect(item.handle).toBe('A1')
        expect(item.value).toBeUndefined()
        expect(item.issues.map(({ code }) => code)).toEqual([8, 42])
        expect(read(`${lines}8\nOther\n`).value).toBeUndefined()
        expect(read(lines, { type: 'POLYLINE' }).issues).toEqual([
            {
                kind: 'unsupported',
                code: 0,
                line: 1,
                message: 'Expected an LWPOLYLINE entity.',
            },
        ])
    })

    it('reports every rejected random polyline, and admitted ones keep their source vertices', () => {
        const random = seededRandom(49)
        const items = Array.from({ length: 3_000 }, () => {
            const source = randomPolyline(random)

            return {
                ...source,
                item: readDxfPolyline(source.record, {
                    references,
                    modelTolerance,
                }),
            }
        })
        const admitted = items.filter(({ item }) => item.value !== undefined)
        const unreported = items.filter(
            ({ item }) => item.value === undefined && item.issues.length === 0,
        )

        expect(unreported).toEqual([])
        expect(admitted.length).toBeGreaterThan(300)

        for (const { item, points, closed } of admitted) {
            const { segments } = item.value!.geometry
            const near = (a: Vector2, b: Vector2) =>
                Math.hypot(a.x - b.x, a.y - b.y) <= modelTolerance.distance

            expect(item.issues).toEqual([])
            expect(segments).toHaveLength(
                closed ? points.length : points.length - 1,
            )
            expect(
                segments.every((segment, index) => {
                    const { start, end } = segmentEndpoints(segment)

                    return (
                        near(start, points[index]!) &&
                        near(end, points[(index + 1) % points.length]!)
                    )
                }),
            ).toBe(true)
        }
    })
})
