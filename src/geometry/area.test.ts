import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { polylineSignedArea } from './area'
import { createArc, createLine, MAX_COORDINATE } from './curve'
import type { Polyline, PolylineSegment } from './curve'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'
import type { Vector2 } from './vector'

const origin = { x: 0, y: 0 }
const exact = { distance: 0 }

function closedPolyline(segments: readonly PolylineSegment[]): Polyline {
    return createPolyline({ segments, closed: true }, { distance: 0 })
}

function polygon(vertices: readonly Vector2[]): Polyline {
    let previous = vertices.at(-1)
    const segments = []

    if (!previous) {
        throw new RangeError('Test polygon needs vertices.')
    }

    for (const point of vertices) {
        segments.push(createLine(previous, point))
        previous = point
    }

    return closedPolyline(segments)
}

function arcAndChord(sweep: number, radius = 2): Polyline {
    const arc = createArc({ center: origin, radius, startAngle: 0, sweep })
    const { start, end } = segmentEndpoints(arc)

    return closedPolyline([arc, createLine(end, start)])
}

describe('signed polyline area', () => {
    it.each([0, MAX_COORDINATE - 100])(
        'measures a rectangle at offset %s',
        (offset) => {
            const vertices = [
                { x: offset, y: offset },
                { x: offset + 100, y: offset },
                { x: offset + 100, y: offset + 60 },
                { x: offset, y: offset + 60 },
            ]
            const counterclockwise = polygon(vertices)
            const clockwise = polygon(vertices.toReversed())

            expect(polylineSignedArea(counterclockwise, exact)).toBe(6000)
            expect(polylineSignedArea(clockwise, exact)).toBe(-6000)
            expect(curveLength(counterclockwise)).toBe(320)
            expect(curveLength(clockwise)).toBe(320)
        },
    )

    it.each([
        { sweep: Math.PI / 2, expected: Math.PI - 2 },
        { sweep: Math.PI, expected: 2 * Math.PI },
        { sweep: 1.5 * Math.PI, expected: 3 * Math.PI + 2 },
        { sweep: FULL_TURN - 2 ** -50, expected: 4 * Math.PI },
    ])('includes arc correction for $sweep', ({ sweep, expected }) => {
        for (const sign of [1, -1]) {
            const polyline = arcAndChord(sign * sweep)

            expect(polylineSignedArea(polyline, exact)).toBeCloseTo(
                sign * expected,
                13,
            )
        }
    })

    it.each([1, -1])('retains scaled tiny area, sign %s', (sign) => {
        const polyline = arcAndChord(sign * 1e-110, MAX_COORDINATE)
        const expected = sign * 8.333333333333333e-302

        expect(polylineSignedArea(polyline, exact) / expected).toBeCloseTo(
            1,
            14,
        )
    })

    it.each([1, -1])('retains subnormal area, sign %s', (sign) => {
        const polyline = arcAndChord(sign * (FULL_TURN - 2 ** -50), 1e-162)

        expect(polylineSignedArea(polyline, exact)).toBe(
            sign * Number.MIN_VALUE,
        )
    })

    it('accepts zero algebraic area for crossing and retraced paths', () => {
        const crossing = polygon([
            origin,
            { x: 2, y: 2 },
            { x: 0, y: 2 },
            { x: 2, y: 0 },
        ])
        const retraced = closedPolyline([
            createLine(origin, { x: 2, y: 0 }),
            createLine({ x: 2, y: 0 }, origin),
        ])

        expect(polylineSignedArea(crossing, exact)).toBe(0)
        expect(polylineSignedArea(retraced, exact)).toBe(0)
    })

    it('rejects a true nonzero arc correction that underflows', () => {
        const polyline = arcAndChord(Math.PI, 1e-162)

        expect(() => polylineSignedArea(polyline, exact)).toThrow(RangeError)
    })

    it('rejects unresolved partial arcs whose computed endpoints coincide', () => {
        const center = { x: MAX_COORDINATE - 2, y: MAX_COORDINATE - 2 }
        const arc = createArc({
            center,
            radius: 1,
            startAngle: 0,
            sweep: 1e-20,
        })
        const { start, end } = segmentEndpoints(arc)
        const polyline = closedPolyline([
            arc,
            createLine(start, center),
            createLine(center, start),
        ])

        expect(end).toEqual(start)
        expect(() => polylineSignedArea(polyline, exact)).toThrow(RangeError)
    })

    it.each(['adjacent', 'closing'])(
        'uses inclusive explicit tolerance for a %s gap',
        (gap) => {
            const segments = [
                createLine(origin, { x: 1, y: 0 }),
                createLine(
                    { x: gap === 'adjacent' ? 1.125 : 1, y: 0 },
                    { x: 1, y: 1 },
                ),
                createLine(
                    { x: 1, y: 1 },
                    { x: 0, y: gap === 'closing' ? 0.125 : 0 },
                ),
            ]
            const polyline = createPolyline(
                { segments, closed: true },
                { distance: 0.25 },
            )
            const expected = gap === 'adjacent' ? 0.5625 : 0.5

            expect(() => polylineSignedArea(polyline, exact)).toThrow(
                RangeError,
            )
            expect(() =>
                polylineSignedArea(polyline, { distance: 0.0625 }),
            ).toThrow(RangeError)
            expect(polylineSignedArea(polyline, { distance: 0.125 })).toBe(
                expected,
            )
            expect(polylineSignedArea(polyline, { distance: 0.25 })).toBe(
                expected,
            )
        },
    )

    it('retains a unit lobe between cancelling huge loops', () => {
        const large = MAX_COORDINATE
        const counterclockwise = polygon([
            { x: large, y: 0 },
            { x: large, y: large },
            { x: 0, y: large },
            origin,
        ])
        const unit = polygon([
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            origin,
        ])
        const clockwise = polygon([
            { x: 0, y: large },
            { x: large, y: large },
            { x: large, y: 0 },
            origin,
        ])
        const path = closedPolyline([
            ...counterclockwise.segments,
            ...unit.segments,
            ...clockwise.segments,
        ])

        expect(polylineSignedArea(path, exact)).toBe(1)
    })

    it('retains the area of a nearly collinear triangle at large coordinates', () => {
        const x = MAX_COORDINATE
        const h = 0.125
        const triangle = polygon([
            { x, y: x - h },
            { x: x - h, y: x - 2 * h },
            origin,
        ])

        expect(polylineSignedArea(triangle, exact)).toBe(-(h * h) / 2)
    })

    it('accepts a collinear triangle with underflowing coordinate products', () => {
        const triangle = polygon([
            origin,
            { x: 1e-200, y: 1e-200 },
            { x: 2e-200, y: 2e-200 },
        ])

        expect(polylineSignedArea(triangle, exact)).toBe(0)
    })

    it('retains subnormal area lost by rounded local translation', () => {
        const triangle = polygon([
            { x: Number.MIN_VALUE, y: 0 },
            { x: MAX_COORDINATE, y: MAX_COORDINATE },
            { x: MAX_COORDINATE / 2, y: MAX_COORDINATE / 2 },
        ])
        const expected = (Number.MIN_VALUE * MAX_COORDINATE) / 4

        expect(polylineSignedArea(triangle, exact) / expected).toBeCloseTo(
            1,
            14,
        )
    })

    it('rejects open paths without adding a closing edge', () => {
        const polyline = createPolyline(
            { segments: [createLine(origin, { x: 1, y: 0 })], closed: false },
            { distance: 0 },
        )

        expect(() => polylineSignedArea(polyline, exact)).toThrow(RangeError)
    })

    it.each([
        { type: 'line', start: origin, end: origin },
        { type: 'arc', center: origin, radius: 1, startAngle: 0, sweep: 0 },
        { type: 'circle', center: origin, radius: 1 },
    ])('rejects invalid raw segment %o', (segment) => {
        const input = {
            type: 'polyline',
            segments: [segment, createLine({ x: 1, y: 0 }, origin)],
            closed: true,
        }

        expect(() => polylineSignedArea(input as Polyline, exact)).toThrow(
            RangeError,
        )
    })
})
