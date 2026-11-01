import { describe, expect, it } from 'vitest'
import { createArc, createCircle, createLine, type Curve } from './curve'
import { evaluateCurve } from './evaluation'
import { prepareIntersectionPart } from './intersection-part'
import { intersectPrimitiveParts } from './primitive-intersection'

describe('prepared primitive pairs', () => {
    it('locates every line, circle and arc operand combination', () => {
        const line = createLine({ x: -2, y: 0 }, { x: 2, y: 0 })
        const circle = createCircle({ x: 0, y: 0 }, 1)
        const arc = createArc({
            center: circle.center,
            radius: 1,
            startAngle: 0,
            sweep: Math.PI,
        })
        const vertical = createLine({ x: 0, y: -2 }, { x: 0, y: 2 })
        const other = createCircle({ x: 1, y: 0 }, 1)
        const otherArc = createArc({
            center: other.center,
            radius: 1,
            startAngle: 0,
            sweep: -Math.PI,
        })

        for (const first of [line, circle, arc]) {
            for (const second of [vertical, other, otherArc]) {
                const result = intersectPrimitiveParts(
                    prepareIntersectionPart(first, 0),
                    prepareIntersectionPart(second, 0),
                )

                expect(result.coincident).toBe(false)

                for (const hit of result.hits) {
                    for (const [curve, location] of [
                        [first, hit.first],
                        [second, hit.second],
                    ] as const) {
                        const point = evaluateCurve(curve, {
                            parameter: location.parameter,
                        }).point

                        expect(
                            Math.hypot(
                                point.x - hit.point.x,
                                point.y - hit.point.y,
                            ),
                        ).toBeLessThan(1e-14)
                    }
                }
            }
        }
    })

    it('swaps the corresponding locations when a circular operand comes first', () => {
        const line = prepareIntersectionPart(
            createLine({ x: -2, y: 0 }, { x: 2, y: 0 }),
            0,
        )
        const circle = prepareIntersectionPart(
            createCircle({ x: 0, y: 0 }, 1),
            0,
        )
        const direct = intersectPrimitiveParts(line, circle)
        const reverse = intersectPrimitiveParts(circle, line)

        expect(reverse.hits).toEqual(
            direct.hits.map(({ point, first, second }) => ({
                point,
                first: second,
                second: first,
            })),
        )
        expect(
            direct.hits.map(({ first, second }) => [
                first.parameter,
                second.parameter,
            ]),
        ).toEqual([
            [0.25, 0.5],
            [0.75, 0],
        ])
    })

    it('uses conservative supporting-circle boxes for expanded arc queries', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0,
            sweep: Math.PI / 2,
        })
        const prepared = prepareIntersectionPart(arc, 1e-9)
        const line = prepareIntersectionPart(
            createLine({ x: 0, y: -1e-10 }, { x: 2, y: -1e-10 }),
            1e-9,
        )

        expect(prepared.bounds.min.y).toBe(-1)
        expect(intersectPrimitiveParts(line, prepared).hits).toHaveLength(1)
    })

    it('preserves supporting-curve coincidence without manufacturing point hits', () => {
        const part = prepareIntersectionPart(createCircle({ x: 0, y: 0 }, 1), 0)

        expect(intersectPrimitiveParts(part, part)).toEqual({
            hits: [],
            coincident: true,
        })
    })

    it('validates every primitive before caching bounds', () => {
        const input = {
            type: 'circle',
            center: { x: 0, y: 0 },
            radius: 0,
        } as const

        expect(() => prepareIntersectionPart(input, 0)).toThrow(RangeError)
        expect(() =>
            prepareIntersectionPart(
                createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
                NaN,
            ),
        ).toThrow(RangeError)
        expect(() =>
            prepareIntersectionPart(
                { type: 'spline' } as unknown as Exclude<
                    Curve,
                    { type: 'polyline' }
                >,
                0,
            ),
        ).toThrow(RangeError)
    })
})
