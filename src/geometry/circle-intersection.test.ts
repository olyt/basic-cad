import { describe, expect, it } from 'vitest'
import { createCircle, MAX_COORDINATE } from './curve'
import { circleIntersections, intersectCircles } from './circle-intersection'

const origin = { x: 0, y: 0 }
const circle = createCircle(origin, 5)

describe('circle pair intersections', () => {
    it.each([
        {
            x: 8,
            radius: 5,
            expected: {
                kind: 'points',
                points: [
                    { x: 4, y: -3 },
                    { x: 4, y: 3 },
                ],
            },
        },
        {
            x: 10,
            radius: 5,
            expected: { kind: 'points', points: [{ x: 5, y: 0 }] },
        },
        {
            x: 3,
            radius: 2,
            expected: { kind: 'points', points: [{ x: 5, y: 0 }] },
        },
        { x: 11, radius: 5, expected: { kind: 'none' } },
        { x: 1, radius: 1, expected: { kind: 'none' } },
        { x: 0, radius: 2, expected: { kind: 'concentric' } },
        { x: 0, radius: 5, expected: { kind: 'coincident' } },
    ])('classifies radius $radius at x=$x', ({ x, radius, expected }) => {
        expect(
            intersectCircles(circle, createCircle({ x, y: 0 }, radius)),
        ).toEqual(expected)
    })

    it('preserves oblique tangency and operand reversal', () => {
        const other = createCircle({ x: 6, y: 8 }, 5)
        const tangent = { kind: 'points', points: [{ x: 3, y: 4 }] }

        expect(intersectCircles(circle, other)).toEqual(tangent)
        expect(intersectCircles(other, circle)).toEqual(tangent)

        const secant = createCircle({ x: 4, y: 0 }, 3)

        expect(intersectCircles(secant, circle)).toEqual({
            kind: 'points',
            points: [
                { x: 4, y: 3 },
                { x: 4, y: -3 },
            ],
        })
        expect(circleIntersections(circle, secant)).toEqual({
            kind: 'points',
            hits: [
                {
                    point: { x: 4, y: -3 },
                    firstDirection: { x: 0.8, y: -0.6 },
                    secondDirection: { x: 0, y: -1 },
                },
                {
                    point: { x: 4, y: 3 },
                    firstDirection: { x: 0.8, y: 0.6 },
                    secondDirection: { x: 0, y: 1 },
                },
            ],
        })
    })

    it('distinguishes exact external tangency from a subnormal separation', () => {
        const unit = createCircle(origin, 1)

        expect(intersectCircles(unit, createCircle({ x: 2, y: 0 }, 1))).toEqual(
            { kind: 'points', points: [{ x: 1, y: 0 }] },
        )
        expect(
            intersectCircles(
                unit,
                createCircle({ x: 2, y: Number.MIN_VALUE }, 1),
            ),
        ).toEqual({ kind: 'none' })

        const internal = intersectCircles(
            createCircle(origin, 3),
            createCircle({ x: 2, y: Number.MIN_VALUE }, 1),
        )

        expect(internal.kind).toBe('points')

        if (internal.kind === 'points') {
            expect(internal.points).toHaveLength(2)
        }
    })

    it('keeps distinct centers when squared floating distance underflows', () => {
        expect(
            intersectCircles(
                createCircle(origin, 1),
                createCircle({ x: Number.MIN_VALUE, y: 0 }, 1),
            ),
        ).toEqual({
            kind: 'points',
            points: [
                { x: 0, y: -1 },
                { x: 0, y: 1 },
            ],
        })
    })

    it.each([Number.MIN_VALUE, 1e-200, 1, MAX_COORDINATE])(
        'preserves two roots at radius %s',
        (radius) => {
            const result = intersectCircles(
                createCircle(origin, radius),
                createCircle({ x: radius, y: 0 }, radius),
            )

            expect(result.kind).toBe('points')

            if (result.kind !== 'points') {
                return
            }

            expect(result.points).toHaveLength(2)

            for (const [index, sign] of [-1, 1].entries()) {
                const point = result.points[index]!
                const expectedY = sign * radius * (Math.sqrt(3) / 2)

                expect(point.x).toBe(radius / 2)
                expect(Math.abs(point.y - expectedY)).toBeLessThanOrEqual(
                    Math.max(radius * 1e-14, Number.MIN_VALUE),
                )
            }
        },
    )

    it('retains local directions when both crossings round to a tiny circle center', () => {
        const center = { x: 6e11, y: 8e11 }
        const tiny = createCircle(center, Number.MIN_VALUE)
        const large = createCircle(origin, 1e12)

        expect(circleIntersections(tiny, large)).toEqual({
            kind: 'points',
            hits: [
                {
                    point: center,
                    firstDirection: { x: -0.8, y: 0.6 },
                    secondDirection: { x: 0.6, y: 0.8 },
                },
                {
                    point: center,
                    firstDirection: { x: 0.8, y: -0.6 },
                    secondDirection: { x: 0.6, y: 0.8 },
                },
            ],
        })
    })

    it('permits finite derived coordinates beyond the stored cap', () => {
        const result = intersectCircles(
            createCircle({ x: MAX_COORDINATE, y: 0 }, MAX_COORDINATE),
            createCircle(
                { x: MAX_COORDINATE, y: MAX_COORDINATE },
                MAX_COORDINATE,
            ),
        )

        expect(result.kind).toBe('points')

        if (result.kind === 'points') {
            expect(result.points[0]!.x).toBeGreaterThan(MAX_COORDINATE)
            expect(result.points[0]!.y).toBe(MAX_COORDINATE / 2)
            expect(Number.isFinite(result.points[0]!.x)).toBe(true)
        }
    })

    it('revalidates either raw circle and leaves its inputs unchanged', () => {
        const other = createCircle({ x: 8, y: 0 }, 5)
        const snapshot = structuredClone({ circle, other })

        intersectCircles(circle, other)
        expect({ circle, other }).toEqual(snapshot)

        for (const radius of [0, -1, NaN, Infinity, MAX_COORDINATE + 1]) {
            expect(() =>
                intersectCircles({ ...circle, radius }, other),
            ).toThrow(RangeError)
            expect(() =>
                intersectCircles(other, { ...circle, radius }),
            ).toThrow(RangeError)
        }

        for (const x of [NaN, Infinity, MAX_COORDINATE + 1]) {
            const invalid = { ...circle, center: { x, y: 0 } }

            expect(() => intersectCircles(invalid, other)).toThrow(RangeError)
            expect(() => intersectCircles(other, invalid)).toThrow(RangeError)
        }
    })
})
