import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createLine } from './curve'
import { prepareTransform, type CurveTransform } from './transform-point'

const origin = { x: 0, y: 0 }

describe('prepared point transforms', () => {
    it('moves points and copies its reference input', () => {
        const offset = { x: 3, y: -2 }
        const transform = prepareTransform({ type: 'move', offset })

        offset.x = 100
        expect(transform.point({ x: 1, y: 5 })).toEqual({ x: 4, y: 3 })
    })

    it.each([
        [Math.PI / 2, { x: 2, y: 4 }],
        [-Math.PI / 2, { x: 2, y: 2 }],
        [Math.PI, { x: 1, y: 3 }],
        [FULL_TURN, { x: 3, y: 3 }],
    ] as const)('rotates exactly at cardinal angle %s', (angle, expected) => {
        const transform = prepareTransform({
            type: 'rotate',
            center: { x: 2, y: 3 },
            angle,
        })

        expect(transform.point({ x: 3, y: 3 })).toEqual(expected)
    })

    it('keeps the scaled effect of a subnormal rotation about a distant pivot', () => {
        const transform = prepareTransform({
            type: 'rotate',
            center: { x: 1e15, y: 0 },
            angle: Number.MIN_VALUE,
        })

        expect(transform.point(origin)).toEqual({
            x: 0,
            y: -1e15 * Number.MIN_VALUE,
        })
    })

    it('keeps an exact residual just below a cardinal angle', () => {
        const transform = prepareTransform({
            type: 'rotate',
            center: origin,
            angle: Math.PI / 2 - 2 ** -52,
        })

        expect(transform.point({ x: 1e15, y: 0 })).toEqual({
            x: 1e15 * 2 ** -52,
            y: 1e15,
        })
    })

    it('preserves second-order displacement when cosine alone would round to one', () => {
        const transform = prepareTransform({
            type: 'rotate',
            center: { x: 1e15, y: 0 },
            angle: 1e-8,
        })
        const point = transform.point(origin)

        expect(point.x).toBeCloseTo(0.05, 16)
        expect(point.y).toBe(-1e7)
    })

    it('reduces a near-full rotation before evaluating its small residual', () => {
        const transform = prepareTransform({
            type: 'rotate',
            center: { x: 1e15, y: 0 },
            angle: FULL_TURN - 2 ** -50,
        })
        const point = transform.point(origin)

        expect(point.y).toBe(1e15 * 2 ** -50)
        expect(point.x).toBeGreaterThan(0)
    })

    it('avoids intermediate loss in a tiny scale about a distant pivot', () => {
        const transform = prepareTransform({
            type: 'scale',
            center: { x: 1e15, y: 0 },
            factor: 1e-20,
        })

        expect(transform.point({ x: -1e15, y: 2 })).toEqual({
            x: 1e15,
            y: 2e-20,
        })
        expect(
            prepareTransform({
                type: 'scale',
                center: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE },
                factor: 1,
            }).point({ x: Number.MIN_VALUE, y: -3 }),
        ).toEqual({ x: Number.MIN_VALUE, y: -3 })
    })

    it('uses exact rational reflection and preserves points on the axis', () => {
        const axis = createLine(origin, { x: 3, y: 4 })
        const transform = prepareTransform({ type: 'mirror', axis })

        expect(transform.point({ x: 1, y: 2 })).toEqual({
            x: 41 / 25,
            y: 38 / 25,
        })
        expect(transform.point({ x: 6, y: 8 })).toEqual({ x: 6, y: 8 })
        expect(
            prepareTransform({
                type: 'mirror',
                axis: createLine(axis.end, axis.start),
            }).point({ x: 1, y: 2 }),
        ).toEqual(transform.point({ x: 1, y: 2 }))
    })

    it('reflects across a diagonal axis even at subnormal scale', () => {
        const axis = createLine(origin, {
            x: Number.MIN_VALUE,
            y: Number.MIN_VALUE,
        })

        expect(
            prepareTransform({ type: 'mirror', axis }).point({ x: 2, y: 3 }),
        ).toEqual({ x: 3, y: 2 })
    })

    it('preserves small offsets from a translated diagonal axis', () => {
        const axis = createLine(
            { x: 1e14, y: 1e14 },
            { x: 1e14 + 1, y: 1e14 + 1 },
        )

        expect(
            prepareTransform({ type: 'mirror', axis }).point({
                x: 1e14 + 0.125,
                y: 1e14 + 0.25,
            }),
        ).toEqual({ x: 1e14 + 0.25, y: 1e14 + 0.125 })
    })

    it.each([0, -1, NaN, Infinity])('rejects scale factor %s', (factor) => {
        expect(() =>
            prepareTransform({ type: 'scale', center: origin, factor }),
        ).toThrow(RangeError)
    })

    it('rejects invalid angles, reference coordinates and zero-length axes', () => {
        expect(() =>
            prepareTransform({
                type: 'rotate',
                center: origin,
                angle: Infinity,
            }),
        ).toThrow(RangeError)
        expect(() =>
            prepareTransform({
                type: 'rotate',
                center: { x: NaN, y: 0 },
                angle: 1,
            }),
        ).toThrow(RangeError)
        expect(() =>
            prepareTransform({ type: 'move', offset: { x: NaN, y: 0 } }),
        ).toThrow(RangeError)
        expect(() =>
            prepareTransform({
                type: 'scale',
                center: { x: Infinity, y: 0 },
                factor: 1,
            }),
        ).toThrow(RangeError)
        expect(() =>
            prepareTransform({
                type: 'mirror',
                axis: { type: 'line', start: origin, end: origin },
            }),
        ).toThrow(RangeError)
        expect(() =>
            prepareTransform({ type: 'skew' } as unknown as CurveTransform),
        ).toThrow('Unsupported')
    })
})
