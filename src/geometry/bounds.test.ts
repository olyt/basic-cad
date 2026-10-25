import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { curveBounds, type BoundingBox } from './bounds'
import {
    MAX_COORDINATE,
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Curve,
} from './curve'
import { createPolyline } from './polyline'
import type { Vector2 } from './vector'
import { seededRandom } from '../test-support/random'

const origin = { x: 0, y: 0 }
const quarter = Math.PI / 2
const root = Math.SQRT2

function expectBounds(actual: BoundingBox, expected: BoundingBox): void {
    for (const corner of ['min', 'max'] as const) {
        expect(actual[corner].x).toBeCloseTo(expected[corner].x, 14)
        expect(actual[corner].y).toBeCloseTo(expected[corner].y, 14)
    }
}

describe('analytic curve bounds', () => {
    it('bounds lines independently of endpoint order and input mutation', () => {
        const start = { x: 3, y: -4 }
        const end = { x: -2, y: 5 }
        const bounds = curveBounds({ type: 'line', start, end })
        const expected = { min: { x: -2, y: -4 }, max: { x: 3, y: 5 } }

        expect(bounds).toEqual(expected)
        expect(curveBounds(createLine(end, start))).toEqual(expected)

        start.x = 100
        end.y = 100

        expect(bounds).toEqual(expected)
    })

    it('allows finite derived circle bounds beyond the stored coordinate cap', () => {
        const center = { x: MAX_COORDINATE, y: -MAX_COORDINATE }

        expect(curveBounds(createCircle(center, MAX_COORDINATE))).toEqual({
            min: { x: 0, y: -2 * MAX_COORDINATE },
            max: { x: 2 * MAX_COORDINATE, y: 0 },
        })
    })

    it.each([
        [0, { min: { x: root, y: -root }, max: { x: 2, y: root } }],
        [1, { min: { x: -root, y: root }, max: { x: root, y: 2 } }],
        [2, { min: { x: -2, y: -root }, max: { x: -root, y: root } }],
        [3, { min: { x: -root, y: -2 }, max: { x: root, y: -root } }],
    ] as const)(
        'includes crossed cardinal %s in both directions',
        (index, expected) => {
            for (const sign of [1, -1]) {
                const arc = createArc(
                    origin,
                    2,
                    index * quarter - (sign * quarter) / 2,
                    sign * quarter,
                )

                expectBounds(curveBounds(arc), expected)
            }
        },
    )

    it.each([
        [0, { min: origin, max: { x: MAX_COORDINATE, y: MAX_COORDINATE } }],
        [
            1,
            {
                min: { x: -MAX_COORDINATE, y: 0 },
                max: { x: 0, y: MAX_COORDINATE },
            },
        ],
        [2, { min: { x: -MAX_COORDINATE, y: -MAX_COORDINATE }, max: origin }],
        [
            3,
            {
                min: { x: 0, y: -MAX_COORDINATE },
                max: { x: MAX_COORDINATE, y: 0 },
            },
        ],
    ] as const)(
        'keeps cardinal-aligned quarter %s exact at large radius',
        (index, expected) => {
            for (const sign of [1, -1]) {
                const start = (index + (sign < 0 ? 1 : 0)) * quarter

                expect(
                    curveBounds(
                        createArc(
                            origin,
                            MAX_COORDINATE,
                            start,
                            sign * quarter,
                        ),
                    ),
                ).toEqual(expected)
            }
        },
    )

    it.each([1, -1])(
        'bounds a major arc with direction %s without the excluded extremum',
        (sign) => {
            const start = sign > 0 ? quarter / 2 : (7 * quarter) / 2

            expectBounds(
                curveBounds(createArc(origin, 2, start, sign * 3 * quarter)),
                {
                    min: { x: -2, y: -2 },
                    max: { x: root, y: 2 },
                },
            )
        },
    )

    it.each([1, -1])('bounds near-full arcs with direction %s', (sign) => {
        expect(
            curveBounds(createArc(origin, 1, 0, sign * (FULL_TURN - 2 ** -50))),
        ).toEqual({
            min: { x: -1, y: -1 },
            max: { x: 1, y: 1 },
        })
    })

    it('preserves tiny sweeps at a cardinal start, including subnormal angles', () => {
        const tiny = curveBounds(createArc(origin, 1, quarter, 1e-20))
        const subnormal = curveBounds(
            createArc(origin, MAX_COORDINATE, 0, Number.MIN_VALUE),
        )

        expect(tiny).toEqual({ min: { x: -1e-20, y: 1 }, max: { x: 0, y: 1 } })
        expect(subnormal.max.y).toBe(MAX_COORDINATE * Number.MIN_VALUE)
        expect(subnormal.min.y).toBe(0)
    })

    it('unions all mixed polyline segments for open and closed geometry', () => {
        const arc = createArc({ x: 3, y: -4 }, 2, 0, Math.PI)
        const end = { x: 1, y: -4 }
        const open = createPolyline(
            [arc, createLine(end, { x: -3, y: -7 })],
            false,
            { distance: 0 },
        )
        const closed = createPolyline(
            [arc, createLine(end, { x: 5, y: -4 })],
            true,
            { distance: 0 },
        )

        expect(curveBounds(open)).toEqual({
            min: { x: -3, y: -7 },
            max: { x: 5, y: -2 },
        })
        expect(curveBounds(closed)).toEqual({
            min: { x: 1, y: -4 },
            max: { x: 5, y: -2 },
        })
    })

    it('rejects empty polylines and invalid primitive geometry', () => {
        expect(() =>
            curveBounds({ type: 'polyline', segments: [], closed: false }),
        ).toThrow(RangeError)
        expect(() =>
            curveBounds({ type: 'circle', center: origin, radius: NaN }),
        ).toThrow(RangeError)
        expect(() =>
            curveBounds({ type: 'spline' } as unknown as Curve),
        ).toThrow('Unsupported curve type: spline.')
    })
})

describe('arc bound properties (fixed seed)', () => {
    function sampleArc(arc: Arc, steps: number): Vector2[] {
        return Array.from({ length: steps + 1 }, (_, step) => {
            const angle = arc.startAngle + (arc.sweep * step) / steps

            return {
                x: arc.center.x + arc.radius * Math.cos(angle),
                y: arc.center.y + arc.radius * Math.sin(angle),
            }
        })
    }

    it('contains every point of random arcs and touches each side', () => {
        const random = seededRandom(3)
        const failures = Array.from({ length: 1000 }, () => {
            const arc = createArc(
                {
                    x: random.between(-5e4, 5e4),
                    y: random.between(-5e4, 5e4),
                },
                random.magnitude(-2, 4),
                random.between(-10, 10),
                random.sign() * random.between(1e-9, FULL_TURN - 1e-9),
            )
            const box = curveBounds(arc)
            const points = sampleArc(arc, 1000)
            const xs = points.map((point) => point.x)
            const ys = points.map((point) => point.y)
            const rounding =
                1e-9 *
                (arc.radius + Math.abs(arc.center.x) + Math.abs(arc.center.y))
            const outside = Math.max(
                box.min.x - Math.min(...xs),
                box.min.y - Math.min(...ys),
                Math.max(...xs) - box.max.x,
                Math.max(...ys) - box.max.y,
            )
            // 1000 samples land within 5e-6 radius of a true extreme.
            const slack = Math.max(
                Math.min(...xs) - box.min.x,
                Math.min(...ys) - box.min.y,
                box.max.x - Math.max(...xs),
                box.max.y - Math.max(...ys),
            )

            return { arc, box, outside, slack, rounding }
        }).filter(
            ({ arc, outside, slack, rounding }) =>
                outside > rounding || slack > 1e-5 * arc.radius,
        )

        expect(failures).toEqual([])
    })
})
