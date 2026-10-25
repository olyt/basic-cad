import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createArc, createCircle, createLine, MAX_COORDINATE } from './curve'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'
import type { Vector2 } from './vector'

const origin = { x: 0, y: 0 }
const line = createLine(origin, { x: 3, y: 4 })

function expectPoint(actual: Vector2, expected: Vector2): void {
    expect(actual.x).toBeCloseTo(expected.x, 12)
    expect(actual.y).toBeCloseTo(expected.y, 12)
}

describe('curve evaluation', () => {
    it.each([0, 0.25, 0.5, 1])(
        'evaluates a line at %s with a unit tangent',
        (parameter) => {
            const result = evaluateCurve(line, { parameter })

            expectPoint(result.point, { x: 3 * parameter, y: 4 * parameter })
            expectPoint(result.tangent, { x: 0.6, y: 0.8 })
        },
    )

    it('preserves exact endpoints despite cancellation and copies the result', () => {
        const input = createLine(
            { x: MAX_COORDINATE, y: 0 },
            { x: 0.1, y: 1e-300 },
        )
        const result = evaluateCurve(input, { parameter: 1 })

        expect(result.point).toEqual(input.end)
        expect(result.point).not.toBe(input.end)
        expect(evaluateCurve(input, { parameter: 0 }).point).toEqual(
            input.start,
        )
        expectPoint(
            evaluateCurve(createLine(input.end, input.start), { parameter: 0 })
                .tangent,
            { x: 1, y: 0 },
        )
    })

    it.each([0, 0.25, 0.5, 0.75, 1, -0.25, Number.MAX_VALUE])(
        'evaluates periodic circle turns %s',
        (parameter) => {
            const result = evaluateCurve(createCircle(origin, 2), { parameter })
            const angle = (parameter % 1) * FULL_TURN

            expectPoint(result.point, {
                x: 2 * Math.cos(angle),
                y: 2 * Math.sin(angle),
            })
            expectPoint(result.tangent, {
                x: -Math.sin(angle),
                y: Math.cos(angle),
            })
        },
    )

    it('retains signed tiny circle turns and analytic tangents at a translated center', () => {
        const result = evaluateCurve(createCircle(origin, 2), {
            parameter: -1e-20,
        })

        expect(result.point.y / (-2e-20 * FULL_TURN)).toBeCloseTo(1, 14)
        expect(result.tangent.x / (1e-20 * FULL_TURN)).toBeCloseTo(1, 14)
        expectPoint(
            evaluateCurve(
                createCircle({ x: MAX_COORDINATE, y: MAX_COORDINATE }, 0.01),
                { parameter: 0.25 },
            ).tangent,
            { x: -1, y: 0 },
        )
    })

    it.each([1, -1])('evaluates a major arc with direction %s', (sign) => {
        const arc = createArc({
            center: origin,
            radius: 2,
            startAngle: 0,
            sweep: sign * 1.5 * Math.PI,
        })
        const midpoint = evaluateCurve(arc, { parameter: 0.5 })

        expectPoint(midpoint.point, { x: -Math.SQRT2, y: sign * Math.SQRT2 })
        expectPoint(midpoint.tangent, {
            x: -Math.SQRT1_2,
            y: -sign * Math.SQRT1_2,
        })
        expect(evaluateCurve(arc, { parameter: 0 }).point).toEqual(
            segmentEndpoints(arc).start,
        )
        expect(evaluateCurve(arc, { parameter: 1 }).point).toEqual(
            segmentEndpoints(arc).end,
        )
    })

    it('preserves a scaled subnormal displacement and tiny cardinal tangent components', () => {
        const subnormal = createArc({
            center: origin,
            radius: MAX_COORDINATE,
            startAngle: 0,
            sweep: Number.MIN_VALUE,
        })
        const tiny = createArc({
            center: { x: 0, y: -1 },
            radius: 1,
            startAngle: Math.PI / 2,
            sweep: 1e-20,
        })
        const result = evaluateCurve(tiny, { parameter: 0.5 })

        expect(evaluateCurve(subnormal, { parameter: 0.5 }).point.y).toBe(
            MAX_COORDINATE * Number.MIN_VALUE * 0.5,
        )
        expect(result.point.x / -5e-21).toBeCloseTo(1, 14)
        expect(result.point.y / -1.25e-41).toBeCloseTo(1, 14)
        expect(result.tangent.y / -5e-21).toBeCloseTo(1, 14)
    })

    it('selects polyline segments explicitly without bridging admitted gaps', () => {
        const polyline = createPolyline(
            {
                segments: [
                    createLine(origin, { x: 1, y: 0 }),
                    createLine({ x: 1.01, y: 0 }, { x: 2.01, y: 0 }),
                ],
                closed: false,
            },
            { distance: 0.02 },
        )

        expect(
            evaluateCurve(polyline, { segmentIndex: 0, parameter: 1 }).point.x,
        ).toBe(1)
        expect(
            evaluateCurve(polyline, { segmentIndex: 1, parameter: 0 }).point.x,
        ).toBe(1.01)
        expect(curveLength(polyline)).toBeCloseTo(2, 14)

        for (const segmentIndex of [undefined, -1, 0.5, 2, NaN, Infinity]) {
            expect(() =>
                evaluateCurve(polyline, { parameter: 0.5, segmentIndex }),
            ).toThrow(RangeError)
        }
    })

    it.each([-Number.MIN_VALUE, 1 + Number.EPSILON, NaN, Infinity, -Infinity])(
        'rejects invalid segment parameter %s',
        (parameter) => {
            expect(() => evaluateCurve(line, { parameter })).toThrow(RangeError)
        },
    )

    it('rejects primitive segment indices and non-finite circle turns', () => {
        expect(() =>
            evaluateCurve(line, { parameter: 0.5, segmentIndex: 0 }),
        ).toThrow(RangeError)
        expect(() =>
            evaluateCurve(createCircle(origin, 1), { parameter: Infinity }),
        ).toThrow(RangeError)
    })
})
