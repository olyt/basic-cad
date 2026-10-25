import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createArc, createCircle, createLine, type Curve } from './curve'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'

const origin = { x: 0, y: 0 }
const line = createLine(origin, { x: 3, y: 4 })

describe('curve lengths and validation', () => {
    it('measures primitives, mixed polylines and subnormal lines', () => {
        const arc = createArc({
            center: origin,
            radius: 1,
            startAngle: 0,
            sweep: Math.PI,
        })
        const segments = [arc, createLine({ x: -1, y: 0 }, { x: 1, y: 0 })]

        expect(curveLength(line)).toBe(5)
        expect(curveLength(createCircle(origin, 2))).toBe(2 * FULL_TURN)
        expect(curveLength(arc)).toBe(Math.PI)
        expect(
            curveLength(createLine(origin, { x: Number.MIN_VALUE, y: 0 })),
        ).toBe(Number.MIN_VALUE)

        for (const closed of [false, true]) {
            expect(
                curveLength(
                    createPolyline({ segments, closed }, { distance: 0 }),
                ),
            ).toBe(Math.PI + 2)
        }
    })

    it('rejects an underflowed positive arc length', () => {
        const arc = createArc({
            center: origin,
            radius: Number.MIN_VALUE,
            startAngle: 0,
            sweep: Number.MIN_VALUE,
        })

        expect(() => curveLength(arc)).toThrow(RangeError)
    })

    it.each([
        { type: 'line', start: origin, end: origin },
        { type: 'circle', center: origin, radius: 0 },
        { type: 'arc', center: origin, radius: 1, startAngle: 0, sweep: 0 },
        { type: 'polyline', segments: [], closed: false },
        { type: 'polyline', segments: [line], closed: true },
        { type: 'polyline', segments: [line], closed: 'yes' },
        {
            type: 'polyline',
            segments: [line, { type: 'line', start: origin, end: origin }],
            closed: false,
        },
        { type: 'spline' },
    ])('rejects invalid raw curve %o', (input) => {
        const curve = input as Curve
        const location =
            curve.type === 'polyline'
                ? { parameter: 0.5, segmentIndex: 0 }
                : { parameter: 0.5 }

        expect(() => evaluateCurve(curve, location)).toThrow(RangeError)
        expect(() => curveLength(curve)).toThrow(RangeError)
    })
})
