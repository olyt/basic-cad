import { describe, expect, it } from 'vitest'
import { createCircle, createLine, MAX_COORDINATE, type Circle } from './curve'
import {
    intersectLineCircle,
    lineCircleIntersections,
} from './line-circle-intersection'
import { type LineDomain, type LineOperand } from './line-intersection'

function horizontal(y: number, domain: LineDomain = 'segment'): LineOperand {
    return { line: createLine({ x: -10, y }, { x: 10, y }), domain }
}

const circle = createCircle({ x: 0, y: 0 }, 5)

describe('line-circle intersections', () => {
    it.each([
        {
            y: 3,
            points: [
                { x: -4, y: 3 },
                { x: 4, y: 3 },
            ],
        },
        { y: 5, points: [{ x: 0, y: 5 }] },
        { y: 6, points: [] },
    ])(
        'returns secant, tangent and missing results at y=$y',
        ({ y, points }) => {
            expect(intersectLineCircle(horizontal(y), circle)).toEqual(points)
        },
    )

    it('orders hits along the line and retains oblique rational intersections', () => {
        const operand: LineOperand = {
            line: createLine({ x: -4, y: -9 }, { x: 8, y: 7 }),
            domain: 'segment',
        }
        const translated = createCircle({ x: 2, y: -1 }, 5)
        const points = [
            { x: -1, y: -5 },
            { x: 5, y: 3 },
        ]

        expect(intersectLineCircle(operand, translated)).toEqual(points)
        expect(
            intersectLineCircle(
                {
                    ...operand,
                    line: createLine(operand.line.end, operand.line.start),
                },
                translated,
            ),
        ).toEqual(points.toReversed())
    })

    it.each([
        { start: -5, end: 5, points: [-5, 5] },
        { start: 0, end: 5, points: [5] },
        { start: 5, end: 10, points: [5] },
        { start: 1, end: 2, points: [] },
        { start: 6, end: 7, points: [] },
    ])(
        'checks exact inclusive segment bounds from $start to $end',
        ({ start, end, points }) => {
            const line = createLine({ x: start, y: 0 }, { x: end, y: 0 })

            expect(
                intersectLineCircle({ line, domain: 'segment' }, circle),
            ).toEqual(points.map((x) => ({ x, y: 0 })))
            expect(
                intersectLineCircle({ line, domain: 'infinite' }, circle),
            ).toEqual([
                { x: -5, y: 0 },
                { x: 5, y: 0 },
            ])
        },
    )

    it('distinguishes near-tangent secants and misses without a tolerance', () => {
        expect(
            intersectLineCircle(horizontal(5 + Number.EPSILON * 4), circle),
        ).toEqual([])

        const y = 5 - Number.EPSILON * 4
        const points = intersectLineCircle(horizontal(y), circle)

        expect(points).toHaveLength(2)
        expect(points[0]!.x).toBeLessThan(0)
        expect(points[1]!.x).toBeGreaterThan(0)

        for (const point of points) {
            expect(Math.hypot(point.x, point.y)).toBeCloseTo(5, 14)
        }
    })

    it('retains two roots when an almost horizontal secant looks tangent', () => {
        const line = createLine({ x: 0, y: 0 }, { x: 1, y: Number.MIN_VALUE })
        const unit = createCircle({ x: 0, y: 1 }, 1)

        expect(intersectLineCircle({ line, domain: 'segment' }, unit)).toEqual([
            { x: 0, y: 0 },
            { x: 2 * Number.MIN_VALUE, y: 0 },
        ])
    })

    it('checks roots before a missed segment endpoint rounds onto the circle', () => {
        const y = Number.MIN_VALUE
        const line = createLine({ x: 1, y }, { x: 2, y })
        const unit = createCircle({ x: 0, y: 0 }, 1)

        expect(intersectLineCircle({ line, domain: 'segment' }, unit)).toEqual(
            [],
        )
        expect(intersectLineCircle({ line, domain: 'infinite' }, unit)).toEqual(
            [
                { x: -1, y },
                { x: 1, y },
            ],
        )
    })

    it.each([Number.MIN_VALUE, 1e-200, 1, MAX_COORDINATE])(
        'preserves axis intersections at radius %s',
        (radius) => {
            const operand = {
                line: createLine({ x: -radius, y: 0 }, { x: radius, y: 0 }),
                domain: 'segment' as const,
            }
            const input = createCircle({ x: 0, y: 0 }, radius)

            expect(intersectLineCircle(operand, input)).toEqual([
                { x: -radius, y: 0 },
                { x: radius, y: 0 },
            ])
        },
    )

    it('avoids root cancellation when the segment is huge and circle is subnormal', () => {
        const operand = {
            line: createLine({ x: -1e15, y: 0 }, { x: 1e15, y: 0 }),
            domain: 'segment' as const,
        }
        const m = Number.MIN_VALUE

        expect(
            intersectLineCircle(operand, createCircle({ x: 0, y: 0 }, m)),
        ).toEqual([
            { x: -m, y: 0 },
            { x: m, y: 0 },
        ])
    })

    it('retains local directions when distinct roots round to the translated center', () => {
        const center = { x: 1e12, y: 1e12 }
        const operand = {
            line: createLine(
                { x: center.x - 1, y: center.y },
                { x: center.x + 1, y: center.y },
            ),
            domain: 'infinite' as const,
        }
        const input = createCircle(center, 1e-100)

        expect(lineCircleIntersections(operand, input)).toEqual([
            { point: center, direction: { x: -1, y: 0 } },
            { point: center, direction: { x: 1, y: 0 } },
        ])
    })

    it('allows finite derived intersections above the stored coordinate cap', () => {
        const operand = {
            line: createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
            domain: 'infinite' as const,
        }
        const input = createCircle({ x: MAX_COORDINATE, y: 0 }, MAX_COORDINATE)

        expect(intersectLineCircle(operand, input)).toEqual([
            { x: 0, y: 0 },
            { x: 2 * MAX_COORDINATE, y: 0 },
        ])
    })

    it('revalidates raw geometry and line domains without mutating inputs', () => {
        const operand = horizontal(3)
        const snapshot = structuredClone({ operand, circle })

        intersectLineCircle(operand, circle)
        expect({ operand, circle }).toEqual(snapshot)

        for (const radius of [0, -1, NaN, Infinity, MAX_COORDINATE + 1]) {
            expect(() =>
                intersectLineCircle(operand, { ...circle, radius }),
            ).toThrow(RangeError)
        }

        expect(() =>
            intersectLineCircle(operand, {
                ...circle,
                center: { x: Infinity, y: 0 },
            }),
        ).toThrow(RangeError)
        expect(() =>
            intersectLineCircle(
                {
                    ...operand,
                    line: { ...operand.line, end: operand.line.start },
                },
                circle,
            ),
        ).toThrow(RangeError)
        expect(() =>
            intersectLineCircle(
                { ...operand, domain: 'ray' as LineDomain },
                circle,
            ),
        ).toThrow(RangeError)
        expect(() =>
            intersectLineCircle(operand, {
                ...circle,
                radius: undefined,
            } as unknown as Circle),
        ).toThrow(RangeError)
    })
})
