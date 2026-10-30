import { describe, expect, it } from 'vitest'
import { createLine, MAX_COORDINATE, type Line } from './curve'
import {
    intersectLines,
    type LineDomain,
    type LineIntersection,
    type LineOperand,
} from './line-intersection'
import { type Vector2 } from './vector'

function segment(start: Vector2, end: Vector2): LineOperand {
    return { line: createLine(start, end), domain: 'segment' }
}

function infinite(operand: LineOperand): LineOperand {
    return { ...operand, domain: 'infinite' }
}

function reverse(operand: LineOperand): LineOperand {
    return {
        ...operand,
        line: createLine(operand.line.end, operand.line.start),
    }
}

function expectPoint(result: LineIntersection, point: Vector2): void {
    expect(result).toEqual({ kind: 'point', point })
}

describe('line intersections', () => {
    it('finds crossings independently of operand order and direction', () => {
        const first = segment({ x: -3, y: 1 }, { x: 9, y: 5 })
        const second = segment({ x: 3, y: -5 }, { x: 3, y: 8 })

        for (const a of [first, reverse(first)]) {
            for (const b of [second, reverse(second)]) {
                expectPoint(intersectLines(a, b), { x: 3, y: 3 })
                expect(intersectLines(b, a)).toEqual(intersectLines(a, b))
            }
        }
    })

    it('includes both segment endpoints without changing the inputs', () => {
        const horizontal = segment({ x: 0, y: 0 }, { x: 2, y: 0 })
        const snapshot = structuredClone(horizontal)

        for (const x of [0, 2]) {
            const vertical = segment({ x, y: -1 }, { x, y: 0 })

            expectPoint(intersectLines(horizontal, vertical), { x, y: 0 })
        }

        expect(horizontal).toEqual(snapshot)
    })

    it('applies each operand domain separately, including negative extensions', () => {
        const first = segment({ x: 0, y: 0 }, { x: 1, y: 0 })
        const second = segment({ x: -2, y: 1 }, { x: -2, y: 2 })

        expect(intersectLines(first, second)).toEqual({ kind: 'none' })
        expect(intersectLines(infinite(first), second)).toEqual({
            kind: 'none',
        })
        expect(intersectLines(first, infinite(second))).toEqual({
            kind: 'none',
        })
        expectPoint(intersectLines(infinite(first), infinite(second)), {
            x: -2,
            y: 0,
        })

        const crossing = segment({ x: -2, y: -1 }, { x: -2, y: 1 })

        expectPoint(intersectLines(infinite(first), crossing), { x: -2, y: 0 })
        expect(intersectLines(crossing, infinite(first))).toEqual(
            intersectLines(infinite(first), crossing),
        )
    })

    it('distinguishes parallel and coincident supporting lines', () => {
        const first = segment({ x: 0, y: 0 }, { x: 2, y: 2 })
        const parallel = segment({ x: 0, y: 1 }, { x: 2, y: 3 })

        expect(intersectLines(first, parallel)).toEqual({ kind: 'parallel' })

        for (const start of [0, 1, 2, 4]) {
            const collinear = segment(
                { x: start, y: start },
                { x: start + 1, y: start + 1 },
            )

            expect(intersectLines(first, collinear)).toEqual({
                kind: 'coincident',
            })
            expect(intersectLines(infinite(first), reverse(collinear))).toEqual(
                { kind: 'coincident' },
            )
        }
    })

    it.each([Number.MIN_VALUE, 1e-200, 1, 1e15])(
        'intersects tiny and large geometry at scale %s',
        (scale) => {
            const first = segment({ x: 0, y: 0 }, { x: scale, y: scale })
            const second = segment({ x: 0, y: scale }, { x: scale, y: 0 })

            expectPoint(intersectLines(first, second), {
                x: scale / 2,
                y: scale / 2,
            })
        },
    )

    it('retains subnormal intersections and handles unbounded parameters', () => {
        const m = Number.MIN_VALUE
        const first = segment({ x: 0, y: 0 }, { x: 2 * m, y: 2 * m })
        const second = segment({ x: 0, y: 2 * m }, { x: 2 * m, y: 0 })

        expectPoint(intersectLines(first, second), { x: m, y: m })
        expect(
            intersectLines(
                infinite(first),
                infinite(segment({ x: 0, y: 1 }, { x: 1, y: 1 })),
            ),
        ).toEqual({ kind: 'point', point: { x: 1, y: 1 } })
    })

    it('distinguishes a crossing whose floating determinant cancels to zero', () => {
        const e = Number.EPSILON
        const first = segment({ x: 0, y: 0 }, { x: 1, y: 1 + e })
        const second = segment({ x: 0, y: (-e * e) / 2 }, { x: 1 - e, y: 1 })

        expectPoint(intersectLines(first, second), { x: (1 - e) / 3, y: 1 / 3 })
        expect(intersectLines(second, first)).toEqual(
            intersectLines(first, second),
        )
    })

    it('checks segment membership before rounding a point onto an endpoint', () => {
        const first = segment({ x: 0, y: 0 }, { x: 1, y: 0 })
        const second = segment(
            { x: 1, y: -Number.MIN_VALUE },
            { x: 1 + Number.EPSILON, y: 1 },
        )

        expect(intersectLines(first, second)).toEqual({ kind: 'none' })
        expect(intersectLines(second, first)).toEqual({ kind: 'none' })
        expectPoint(intersectLines(infinite(first), second), { x: 1, y: 0 })
    })

    it('rounds normal and subnormal midpoint ties to even', () => {
        for (const [start, step] of [
            [1, Number.EPSILON],
            [0, Number.MIN_VALUE],
            [-1, -Number.EPSILON],
            [0, -Number.MIN_VALUE],
        ] as const) {
            for (const [count, rounded] of [
                [1, 0],
                [3, 2],
            ] as const) {
                const first = segment(
                    { x: start, y: 0 },
                    { x: start + count * step, y: 2 },
                )
                const second = segment({ x: -2, y: 1 }, { x: 2, y: 1 })

                expectPoint(intersectLines(first, second), {
                    x: start + rounded * step,
                    y: 1,
                })
            }
        }
    })

    it('preserves translated short geometry and permits finite derived coordinates above the input cap', () => {
        const base = MAX_COORDINATE
        const first = segment(
            { x: base - 1, y: base - 1 },
            { x: base, y: base },
        )
        const second = segment(
            { x: base - 1, y: base },
            { x: base, y: base - 1 },
        )

        expectPoint(intersectLines(first, second), {
            x: base - 0.5,
            y: base - 0.5,
        })

        const distant = infinite(
            segment({ x: 0, y: 1 }, { x: 1, y: 1 + Number.EPSILON }),
        )

        expect(
            intersectLines(
                distant,
                infinite(segment({ x: 0, y: 0 }, { x: 1, y: 0 })),
            ),
        ).toEqual({ kind: 'point', point: { x: -1 / Number.EPSILON, y: 0 } })
    })

    it('rejects overflow instead of returning an infinite intersection', () => {
        const huge = infinite(
            segment({ x: 0, y: 0 }, { x: 1, y: Number.MIN_VALUE }),
        )
        const upper = infinite(segment({ x: 0, y: 1 }, { x: 1, y: 1 }))

        expect(() => intersectLines(huge, upper)).toThrow(RangeError)
    })

    it('revalidates raw lines and domains in either operand', () => {
        const valid = segment({ x: 0, y: 0 }, { x: 1, y: 1 })
        const invalidLines = [
            { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
            { type: 'line', start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } },
            { type: 'line', start: { x: 0, y: 0 }, end: { x: Infinity, y: 1 } },
            {
                type: 'line',
                start: { x: 0, y: 0 },
                end: { x: MAX_COORDINATE + 1, y: 1 },
            },
        ]

        for (const line of invalidLines) {
            const invalid = { line: line as Line, domain: 'segment' as const }

            expect(() => intersectLines(invalid, valid)).toThrow(RangeError)
            expect(() => intersectLines(valid, invalid)).toThrow(RangeError)
        }

        expect(() =>
            intersectLines({ ...valid, domain: 'ray' as LineDomain }, valid),
        ).toThrow(RangeError)
        expect(() =>
            intersectLines(valid, {
                ...valid,
                domain: undefined as unknown as LineDomain,
            }),
        ).toThrow(RangeError)
    })
})
