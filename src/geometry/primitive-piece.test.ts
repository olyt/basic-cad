import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import {
    createArc,
    createCircle,
    createLine,
    MAX_COORDINATE,
    type Arc,
    type Circle,
    type Line,
} from './curve'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import {
    primitivePiece as extractPrimitive,
    type ParameterInterval,
} from './primitive-piece'

const origin = { x: 0, y: 0 }
const line = createLine(origin, { x: 10, y: 20 })
const primitivePiece = (
    curve: Line | Arc | Circle,
    interval: ParameterInterval,
) => extractPrimitive(curve, { ...interval, modelTolerance: { distance: 0 } })

describe('primitive interval pieces', () => {
    it('extracts an independent line with correctly rounded endpoints', () => {
        const piece = primitivePiece(line, { start: 0.25, end: 0.75 })

        expect(piece).toEqual(createLine({ x: 2.5, y: 5 }, { x: 7.5, y: 15 }))
        expect(primitivePiece(line, { start: 0, end: 1 })).toEqual(line)
        expect(primitivePiece(line, { start: 0, end: 1 })).not.toBe(line)
    })

    it('rounds line interpolation once through cancellation and subnormals', () => {
        const translated = createLine(
            { x: -MAX_COORDINATE, y: 0 },
            { x: MAX_COORDINATE, y: 1 },
        )
        const tiny = createLine(origin, { x: 8 * Number.MIN_VALUE, y: 0 })

        expect(
            primitivePiece(translated, { start: 0.5, end: 1 }),
        ).toMatchObject({
            start: { x: 0, y: 0.5 },
        })
        expect(primitivePiece(tiny, { start: 0.25, end: 0.75 })).toEqual(
            createLine(
                { x: 2 * Number.MIN_VALUE, y: 0 },
                { x: 6 * Number.MIN_VALUE, y: 0 },
            ),
        )
    })

    it.each([-1, 1])(
        'preserves an arc support and direction %s across zero',
        (sign) => {
            const arc = createArc({
                center: origin,
                radius: 5,
                startAngle: 5.5,
                sweep: sign * 5,
            })
            const piece = primitivePiece(arc, { start: 0.25, end: 0.75 })

            expect(piece).toMatchObject({
                type: 'arc',
                center: origin,
                radius: 5,
                sweep: sign * 2.5,
            })

            for (const parameter of [0, 0.3, 1]) {
                const actual = evaluateCurve(piece, { parameter })
                const expected = evaluateCurve(arc, {
                    parameter: 0.25 + 0.5 * parameter,
                })

                expect(
                    Math.hypot(
                        actual.point.x - expected.point.x,
                        actual.point.y - expected.point.y,
                    ),
                ).toBeLessThan(1e-13)
            }
        },
    )

    it('supports signed periodic circle parameters and seam-crossing intervals', () => {
        const circle = createCircle(origin, 2)
        const interval = { start: 0.75, end: 0.25 }
        const piece = primitivePiece(circle, interval)

        expect(piece).toMatchObject({
            type: 'arc',
            startAngle: 1.5 * Math.PI,
            sweep: Math.PI,
        })
        expect(primitivePiece(circle, { start: -0.25, end: 2.25 })).toEqual(
            piece,
        )
        expect(primitivePiece(circle, { start: 0, end: -0.25 })).toMatchObject({
            sweep: 1.5 * Math.PI,
        })
        expect(primitivePiece(circle, { start: -0.25, end: 0 })).toMatchObject({
            sweep: Math.PI / 2,
        })
    })

    it('retains a representable tiny arc prefix', () => {
        const arc = createArc({
            center: origin,
            radius: MAX_COORDINATE,
            startAngle: Math.PI / 2,
            sweep: 1e-20,
        })
        const piece = primitivePiece(arc, { start: 0, end: 0.5 })

        expect(piece).toMatchObject({
            startAngle: arc.startAngle,
            sweep: 5e-21,
        })
        expect(curveLength(piece)).toBeCloseTo(5e-6, 18)
    })

    it('rejects a retained arc whose new start rotation cannot be stored', () => {
        const arc = createArc({
            center: origin,
            radius: MAX_COORDINATE,
            startAngle: Math.PI / 2,
            sweep: 1e-20,
        })

        expect(() => primitivePiece(arc, { start: 0.5, end: 1 })).toThrow(
            'cannot preserve',
        )
    })

    it('rejects underflowed sweeps, positive lengths and rounded full turns', () => {
        const underflow = createArc({
            center: origin,
            radius: MAX_COORDINATE,
            startAngle: 0,
            sweep: Number.MIN_VALUE,
        })
        const tiny = createCircle(origin, Number.MIN_VALUE)
        const circle = createCircle(origin, 1)

        expect(() => primitivePiece(underflow, { start: 0, end: 0.5 })).toThrow(
            RangeError,
        )
        expect(() => primitivePiece(tiny, { start: 0, end: 1e-100 })).toThrow(
            RangeError,
        )
        expect(() =>
            primitivePiece(circle, { start: 0, end: -Number.MIN_VALUE }),
        ).toThrow(RangeError)
        expect(() =>
            primitivePiece(circle, { start: -Number.MIN_VALUE, end: 0 }),
        ).toThrow(RangeError)
    })

    it('rejects collapsed line pieces instead of silently dropping them', () => {
        const translated = createLine(
            { x: MAX_COORDINATE - 1, y: 0 },
            { x: MAX_COORDINATE, y: 0 },
        )

        expect(() =>
            primitivePiece(translated, { start: 0, end: 1e-10 }),
        ).toThrow('distinct')
    })

    it.each([
        { start: 0.5, end: 0.5 },
        { start: 1, end: 0 },
        { start: -Number.MIN_VALUE, end: 0.5 },
        { start: 0, end: 1 + Number.EPSILON },
        { start: NaN, end: 1 },
        { start: 0, end: Infinity },
    ])('rejects invalid open interval %j', (interval) => {
        expect(() => primitivePiece(line, interval)).toThrow(RangeError)
    })

    it.each([0, 1, -1, 1e15])(
        'rejects a circle interval with equal periodic ends %s',
        (end) => {
            expect(() =>
                primitivePiece(createCircle(origin, 1), { start: 0, end }),
            ).toThrow('distinct')
        },
    )

    it('keeps a near-full retained circle interval as an arc', () => {
        const piece = primitivePiece(createCircle(origin, 1), {
            start: 0,
            end: 1 - Number.EPSILON,
        })

        expect(piece.type).toBe('arc')
        expect(curveLength(piece)).toBeLessThan(FULL_TURN)
    })
})
