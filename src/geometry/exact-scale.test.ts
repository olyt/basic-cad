import { describe, expect, it } from 'vitest'
import {
    integerCoordinate,
    integerCoordinates,
    roundRational,
    roundSurd,
} from './exact'

describe('shared binary input units', () => {
    it('removes common powers of two while ignoring zero coordinates', () => {
        expect(integerCoordinates([0, -0])).toEqual({
            exponent: 0,
            values: [0n, 0n],
        })
        expect(integerCoordinates([6, 10, -14, 0])).toEqual({
            exponent: 1,
            values: [3n, 5n, -7n, 0n],
        })
        expect(integerCoordinates([1.5, 2.25, -0])).toEqual({
            exponent: -2,
            values: [6n, 9n, 0n],
        })
        expect(integerCoordinates([2 ** 40, 2 ** 42, 0])).toEqual({
            exponent: 40,
            values: [1n, 4n, 0n],
        })
    })

    it('retains subnormal precision when large and tiny values coexist', () => {
        expect(integerCoordinates([Number.MIN_VALUE, 1, 0])).toEqual({
            exponent: -1074,
            values: [1n, integerCoordinate(1), 0n],
        })

        const scaled = integerCoordinates([10000.1, 10020.2, 100.3])

        expect(scaled.exponent).toBe(-46)

        for (const value of scaled.values) {
            expect(value.toString(2).length).toBeLessThan(61)
        }
    })

    it.each([NaN, Infinity, -Infinity])(
        'rejects nonfinite coordinate %s',
        (value) => {
            expect(() => integerCoordinates([0, value])).toThrow(RangeError)
        },
    )
})

describe('rounding at explicit binary scales', () => {
    it('resolves fractional coordinates finer than the input unit', () => {
        expect(roundRational({ numerator: 1n, denominator: 2n }, 0)).toBe(0.5)
        expect(roundRational({ numerator: 1n, denominator: 3n }, 0)).toBe(1 / 3)
        expect(roundRational({ numerator: -5n, denominator: 2n }, -1)).toBe(
            -1.25,
        )
        expect(
            roundSurd(
                { base: 0n, coefficient: 1n, radicand: 2n, denominator: 1n },
                0,
            ),
        ).toBe(Math.SQRT2)
        expect(
            roundSurd(
                { base: 0n, coefficient: 1n, radicand: 9n, denominator: 2n },
                0,
            ),
        ).toBe(1.5)
    })

    it('rounds normal and subnormal halfway values to even', () => {
        const denominator = 1n << 53n

        expect(
            roundRational({ numerator: denominator + 1n, denominator }),
        ).toBe(1)
        expect(
            roundRational({ numerator: denominator + 3n, denominator }),
        ).toBe(1 + 2 * Number.EPSILON)
        expect(roundRational({ numerator: 1n, denominator: 2n }, -1074)).toBe(0)
        expect(roundRational({ numerator: -1n, denominator: 2n }, -1074)).toBe(
            0,
        )
        expect(roundRational({ numerator: 3n, denominator: 2n }, -1074)).toBe(
            2 * Number.MIN_VALUE,
        )
        expect(roundRational({ numerator: -3n, denominator: 2n }, -1074)).toBe(
            -2 * Number.MIN_VALUE,
        )
    })

    it('combines the ratio and scale before deciding overflow or underflow', () => {
        expect(
            roundRational({ numerator: 1n, denominator: 1n << 100n }, 1100),
        ).toBe(2 ** 1000)
        expect(
            roundRational({ numerator: 1n << 100n, denominator: 1n }, -1100),
        ).toBe(2 ** -1000)

        const boundary = (1n << 54n) - 1n

        expect(
            roundRational(
                { numerator: boundary * 2n - 1n, denominator: 1n },
                969,
            ),
        ).toBe(Number.MAX_VALUE)
        expect(() =>
            roundRational({ numerator: boundary, denominator: 1n }, 970),
        ).toThrow(RangeError)
    })

    it('retains a tiny irrational difference after cancellation at unit scale', () => {
        const root = 1n << 1024n

        expect(
            roundSurd(
                {
                    base: -root,
                    coefficient: 1n,
                    radicand: root * root + 1n,
                    denominator: 1n,
                },
                0,
            ),
        ).toBe(2 ** -1025)
    })

    it.each([NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects binary exponent %s',
        (exponent) => {
            expect(() =>
                roundRational({ numerator: 1n, denominator: 1n }, exponent),
            ).toThrow(RangeError)
            expect(() =>
                roundSurd(
                    {
                        base: 0n,
                        coefficient: 1n,
                        radicand: 2n,
                        denominator: 1n,
                    },
                    exponent,
                ),
            ).toThrow(RangeError)
        },
    )
})
