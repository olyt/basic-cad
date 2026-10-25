import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { closestPoint } from './closest'
import { createArc, createCircle, createLine } from './curve'
import { evaluateCurve } from './evaluation'
import { createPolyline } from './polyline'

const origin = { x: 0, y: 0 }
const line = createLine(origin, { x: 10, y: 0 })
const circle = createCircle(origin, 2)

describe('closest points', () => {
    it.each([
        { query: { x: 5, y: 3 }, parameter: 0.5, distance: 3 },
        { query: { x: -5, y: 0 }, parameter: 0, distance: 5 },
        { query: { x: 15, y: 0 }, parameter: 1, distance: 5 },
    ])(
        'projects and clamps a line at $parameter',
        ({ query, parameter, distance }) => {
            const result = closestPoint(line, query)

            expect(result.point).toEqual({ x: 10 * parameter, y: 0 })
            expect(result.location).toEqual({ parameter })
            expect(result.distance).toBe(distance)
        },
    )

    it('handles tiny lines without squaring their length', () => {
        const tiny = createLine(origin, { x: 1e-300, y: 0 })
        const result = closestPoint(tiny, { x: 5e-301, y: 1e-300 })

        expect(result.point).toEqual({ x: 5e-301, y: 0 })
        expect(result.location.parameter).toBe(0.5)
        expect(result.distance).toBe(1e-300)
    })

    it('clamps an overflowing projection when the final distance is finite', () => {
        const diagonal = createLine(origin, { x: 1, y: 1 })
        const result = closestPoint(diagonal, { x: 1e308, y: 1e308 })

        expect(result.point).toEqual(diagonal.end)
        expect(result.location.parameter).toBe(1)
        expect(Number.isFinite(result.distance)).toBe(true)
    })

    it('projects radially onto circles and resolves center ties at the seam', () => {
        expect(closestPoint(circle, { x: -4, y: 0 })).toEqual({
            point: { x: -2, y: 0 },
            location: { parameter: 0.5 },
            distance: 2,
        })
        expect(closestPoint(circle, { x: -0, y: -0 })).toEqual({
            point: { x: 2, y: 0 },
            location: { parameter: 0 },
            distance: 2,
        })
    })

    it('keeps a small negative circle parameter near its seam', () => {
        const large = createCircle(origin, 1e15)
        const result = closestPoint(large, { x: 1e15, y: -0.01 })

        expect(result.location.parameter).toBeLessThan(0)
        expect(result.point.x).toBe(1e15)
        expect(result.point.y).toBeCloseTo(-0.01, 16)
        expect(result.distance).toBeLessThan(1e-17)
    })

    it.each([1, -1])(
        'projects signed arcs and clamps excluded radial directions: %s',
        (sign) => {
            const arc = createArc({
                center: origin,
                radius: 1,
                startAngle: 0,
                sweep: (sign * Math.PI) / 2,
            })
            const interior = closestPoint(arc, { x: 1, y: sign })

            expect(interior.location.parameter).toBeCloseTo(0.5, 14)
            expect(interior.point.x).toBeCloseTo(Math.SQRT1_2, 14)
            expect(interior.point.y).toBeCloseTo(sign * Math.SQRT1_2, 14)
            expect(interior.distance).toBeCloseTo(Math.SQRT2 - 1, 14)
            expect(closestPoint(arc, { x: -1, y: 0 }).location.parameter).toBe(
                1,
            )
            expect(
                closestPoint(arc, { x: 0, y: -2 * sign }).location.parameter,
            ).toBe(0)
            expect(closestPoint(arc, origin).location.parameter).toBe(0)
        },
    )

    it.each([1, -1])(
        'uses the complementary gap for major and near-full arcs: %s',
        (sign) => {
            const major = createArc({
                center: origin,
                radius: 1,
                startAngle: 0,
                sweep: (sign * 3 * Math.PI) / 2,
            })
            const nearFull = createArc({
                center: origin,
                radius: 1,
                startAngle: 0,
                sweep: sign * (FULL_TURN - 2 ** -50),
            })
            const gapQuery = { x: 1, y: -sign * 2 ** -51 }

            expect(closestPoint(major, { x: -2, y: 0 }).point).toEqual({
                x: -1,
                y: 0,
            })
            expect(
                closestPoint(major, { x: 1, y: -sign }).location.parameter,
            ).toBe(0)
            expect(closestPoint(nearFull, gapQuery).location.parameter).toBe(0)
            expect(closestPoint(nearFull, gapQuery).distance).toBe(2 ** -51)
        },
    )

    it('retains the selected segment at tolerated gaps and exact ties', () => {
        const segments = [
            createLine(origin, { x: 1, y: 0 }),
            createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 }),
        ]
        const polyline = createPolyline(
            { segments, closed: false },
            { distance: 0.125 },
        )
        const tied = closestPoint(polyline, { x: 1.0625, y: 0 })
        const following = closestPoint(polyline, { x: 1.125, y: 0 })

        expect(tied.location).toEqual({ segmentIndex: 0, parameter: 1 })
        expect(following.location).toEqual({ segmentIndex: 1, parameter: 0 })
        expect(evaluateCurve(polyline, tied.location).point).toEqual(tied.point)
        expect(evaluateCurve(polyline, following.location).point).toEqual(
            following.point,
        )
    })

    it('queries all segments of a mixed closed polyline', () => {
        const arc = createArc({
            center: origin,
            radius: 1,
            startAngle: 0,
            sweep: Math.PI,
        })
        const polyline = createPolyline(
            {
                segments: [arc, createLine({ x: -1, y: 0 }, { x: 1, y: 0 })],
                closed: true,
            },
            { distance: 0 },
        )
        const result = closestPoint(polyline, { x: 0, y: -1 })

        expect(result.point).toEqual(origin)
        expect(result.location).toEqual({ segmentIndex: 1, parameter: 0.5 })
        expect(result.distance).toBe(1)
    })

    it('rejects nonfinite queries, malformed geometry and unrepresentable distances', () => {
        expect(() => closestPoint(line, { x: NaN, y: 0 })).toThrow(RangeError)
        expect(() => closestPoint({ ...circle, radius: 0 }, origin)).toThrow(
            RangeError,
        )
        expect(() =>
            closestPoint(
                { type: 'polyline', segments: [], closed: false },
                origin,
            ),
        ).toThrow(RangeError)
        expect(() =>
            closestPoint(line, { x: Number.MAX_VALUE, y: Number.MAX_VALUE }),
        ).toThrow(RangeError)
    })
})
