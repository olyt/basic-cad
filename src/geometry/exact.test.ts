import { describe, expect, it } from 'vitest'
import { integerCoordinate, roundedCoordinate, roundSurd } from './exact'

const one = 1n << 1074n

describe('exact binary coordinates', () => {
    it('encodes finite doubles without losing signs or subnormal bits', () => {
        expect(integerCoordinate(0)).toBe(0n)
        expect(integerCoordinate(-0)).toBe(0n)
        expect(integerCoordinate(Number.MIN_VALUE)).toBe(1n)
        expect(integerCoordinate(-Number.MIN_VALUE)).toBe(-1n)
        expect(integerCoordinate(1)).toBe(one)
        expect(integerCoordinate(-0.5)).toBe(-(one >> 1n))

        for (const value of [1e-200, 1 / 3, 1e15, Number.MAX_VALUE]) {
            expect(roundedCoordinate(integerCoordinate(value), 1n)).toBe(value)
            expect(roundedCoordinate(integerCoordinate(-value), 1n)).toBe(
                -value,
            )
        }
    })

    it('rounds exact rational coordinates once, with ties to even', () => {
        expect(roundedCoordinate(one, 3n)).toBe(1 / 3)
        expect(roundedCoordinate(-one, 3n)).toBe(-1 / 3)
        expect(roundedCoordinate(1n, 2n)).toBe(0)
        expect(roundedCoordinate(-1n, 2n)).toBe(0)
        expect(roundedCoordinate(3n, 2n)).toBe(2 * Number.MIN_VALUE)
        expect(roundedCoordinate(-3n, 2n)).toBe(-2 * Number.MIN_VALUE)
        expect(roundedCoordinate(one + (1n << 1021n), 1n)).toBe(1)
        expect(roundedCoordinate(one + (3n << 1021n), 1n)).toBe(
            1 + 2 * Number.EPSILON,
        )

        const subnormalBoundary = (1n << 53n) - 1n

        expect(roundedCoordinate(subnormalBoundary, 2n)).toBe(2 ** -1022)
    })

    it('rejects nonfinite inputs, invalid divisors and overflowing results', () => {
        for (const value of [NaN, Infinity, -Infinity]) {
            expect(() => integerCoordinate(value)).toThrow(RangeError)
        }

        for (const denominator of [0n, -1n]) {
            expect(() => roundedCoordinate(1n, denominator)).toThrow(RangeError)
        }

        expect(() => roundedCoordinate(1n << 2098n, 1n)).toThrow(RangeError)
    })
})

describe('quadratic surd coordinates', () => {
    it('rounds signed irrational square roots at normal and subnormal scales', () => {
        for (const sign of [-1n, 1n]) {
            expect(
                roundSurd({
                    base: 0n,
                    coefficient: sign * one,
                    radicand: 2n,
                    denominator: 1n,
                }),
            ).toBe(Number(sign) * Math.SQRT2)
            expect(
                roundSurd({
                    base: 0n,
                    coefficient: sign,
                    radicand: 2n,
                    denominator: 1n,
                }),
            ).toBe(Number(sign) * Number.MIN_VALUE)
            expect(
                roundSurd({
                    base: 0n,
                    coefficient: sign * 2n,
                    radicand: 2n,
                    denominator: 1n,
                }),
            ).toBe(Number(sign) * 3 * Number.MIN_VALUE)
        }
    })

    it('handles exact square roots and halfway ties without endless refinement', () => {
        expect(
            roundSurd({
                base: 0n,
                coefficient: 1n,
                radicand: 1n,
                denominator: 2n,
            }),
        ).toBe(0)
        expect(
            roundSurd({
                base: 0n,
                coefficient: 1n,
                radicand: 9n,
                denominator: 2n,
            }),
        ).toBe(2 * Number.MIN_VALUE)
        expect(
            roundSurd({
                base: one,
                coefficient: 1n << 1021n,
                radicand: 1n,
                denominator: 1n,
            }),
        ).toBe(1)
        expect(
            roundSurd({
                base: one,
                coefficient: 0n,
                radicand: 2n,
                denominator: 1n,
            }),
        ).toBe(1)
        expect(
            roundSurd({
                base: one,
                coefficient: one,
                radicand: 0n,
                denominator: 1n,
            }),
        ).toBe(1)
    })

    it('retains a tiny irrational difference after extreme cancellation', () => {
        const root = 1n << 1024n
        const radicand = root * root + 1n

        expect(
            roundSurd({
                base: -root * one,
                coefficient: one,
                radicand,
                denominator: 1n,
            }),
        ).toBe(2 ** -1025)
        expect(
            roundSurd({
                base: root * one,
                coefficient: -one,
                radicand,
                denominator: 1n,
            }),
        ).toBe(-(2 ** -1025))
        expect(
            roundSurd({
                base: -root,
                coefficient: 1n,
                radicand,
                denominator: 1n,
            }),
        ).toBe(0)
    })

    it('distinguishes the finite and overflowing sides of the upper rounding boundary', () => {
        const boundary = (1n << 2098n) - (1n << 2044n)

        expect(
            roundSurd({
                base: boundary,
                coefficient: -1n,
                radicand: 2n,
                denominator: 1n,
            }),
        ).toBe(Number.MAX_VALUE)
        expect(() =>
            roundSurd({
                base: boundary,
                coefficient: 1n,
                radicand: 2n,
                denominator: 1n,
            }),
        ).toThrow(RangeError)
    })

    it('rejects negative radicands and nonpositive denominators', () => {
        expect(() =>
            roundSurd({
                base: 0n,
                coefficient: 0n,
                radicand: -1n,
                denominator: 1n,
            }),
        ).toThrow(RangeError)

        for (const denominator of [0n, -1n]) {
            expect(() =>
                roundSurd({
                    base: 0n,
                    coefficient: 1n,
                    radicand: 2n,
                    denominator,
                }),
            ).toThrow(RangeError)
        }
    })
})
