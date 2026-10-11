import { describe, expect, it } from 'vitest'
import {
    FULL_TURN,
    type AngleDirection,
    isAngleInsideArc,
    normalizeAngle,
    signedSweep,
} from './angle'

const quarterTurn = Math.PI / 2
const exact = 0

describe('angle normalization', () => {
    it('wraps radians into a single counterclockwise turn', () => {
        expect(FULL_TURN).toBe(2 * Math.PI)
        expect(normalizeAngle(5 * quarterTurn)).toBeCloseTo(quarterTurn, 14)
        expect(normalizeAngle(-quarterTurn)).toBe(3 * quarterTurn)
        expect(normalizeAngle(-5 * quarterTurn)).toBeCloseTo(
            3 * quarterTurn,
            14,
        )
    })

    it('canonicalizes complete turns and negative zero', () => {
        for (const angle of [0, -0, FULL_TURN, -FULL_TURN, 4 * FULL_TURN]) {
            expect(normalizeAngle(angle)).toBe(0)
        }

        expect(normalizeAngle(Number.MIN_VALUE)).toBe(Number.MIN_VALUE)
        expect(normalizeAngle(-Number.MIN_VALUE)).toBe(0)
    })

    it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
        'keeps very large finite angle %s within range',
        (angle) => {
            const normalized = normalizeAngle(angle)

            expect(normalized).toBeGreaterThanOrEqual(0)
            expect(normalized).toBeLessThan(FULL_TURN)
            expect(normalizeAngle(normalized)).toBe(normalized)
        },
    )
})

describe('directed signed sweeps', () => {
    it('uses positive counterclockwise and negative clockwise sweeps', () => {
        expect(signedSweep(0, quarterTurn, 'counterclockwise')).toBe(
            quarterTurn,
        )
        expect(signedSweep(0, quarterTurn, 'clockwise')).toBe(-3 * quarterTurn)
        expect(signedSweep(quarterTurn, 0, 'counterclockwise')).toBe(
            3 * quarterTurn,
        )
        expect(signedSweep(quarterTurn, 0, 'clockwise')).toBe(-quarterTurn)
    })

    it('crosses zero in either direction', () => {
        const start = 3.5 * quarterTurn
        const end = 0.5 * quarterTurn

        expect(signedSweep(start, end, 'counterclockwise')).toBeCloseTo(
            quarterTurn,
            14,
        )
        expect(signedSweep(end, start, 'clockwise')).toBeCloseTo(
            -quarterTurn,
            14,
        )
    })

    it.each<AngleDirection>(['clockwise', 'counterclockwise'])(
        'uses zero for identical endpoints in direction %s',
        (direction) => {
            expect(signedSweep(quarterTurn, quarterTurn, direction)).toBe(0)
            expect(signedSweep(0, FULL_TURN, direction)).toBe(0)

            const sweep = signedSweep(
                Number.MAX_VALUE,
                -Number.MAX_VALUE,
                direction,
            )

            expect(Number.isFinite(sweep)).toBe(true)
            expect(Math.abs(sweep)).toBeLessThan(FULL_TURN)
        },
    )

    it('keeps distinct endpoints a nearly full turn apart', () => {
        const beforeOne = 1 - Number.EPSILON / 2
        const afterOne = 1 + Number.EPSILON
        const counterclockwise = signedSweep(1, beforeOne, 'counterclockwise')
        const clockwise = signedSweep(1, afterOne, 'clockwise')

        // Within 1e-14 of a full turn, but never zero and never a full turn.
        expect(counterclockwise).toBeGreaterThan(FULL_TURN - 1e-14)
        expect(counterclockwise).toBeLessThan(FULL_TURN)
        expect(clockwise).toBeLessThan(-(FULL_TURN - 1e-14))
        expect(clockwise).toBeGreaterThan(-FULL_TURN)
    })

    it('rejects unsupported directions at runtime', () => {
        const sideways = 'sideways' as AngleDirection

        expect(() => signedSweep(0, 1, sideways)).toThrow(RangeError)
        expect(() => signedSweep(1, 1, sideways)).toThrow(RangeError)
    })
})

describe('angle inclusion in arcs', () => {
    it.each([1, -1])(
        'includes wrapped arc endpoints in direction %s',
        (sign) => {
            const start = sign > 0 ? 3.5 * quarterTurn : 0.5 * quarterTurn
            const end = sign > 0 ? 0.5 * quarterTurn : 3.5 * quarterTurn
            const sweep = sign * quarterTurn

            expect(isAngleInsideArc(start, start, sweep, exact)).toBe(true)
            expect(isAngleInsideArc(end, start, sweep, exact)).toBe(true)
            expect(isAngleInsideArc(0, start, sweep, exact)).toBe(true)
            expect(isAngleInsideArc(quarterTurn, start, sweep, exact)).toBe(
                false,
            )
            expect(isAngleInsideArc(3 * quarterTurn, start, sweep, exact)).toBe(
                false,
            )
        },
    )

    it('includes major arcs without including their complementary gap', () => {
        for (const angle of [Math.PI, 3 * quarterTurn]) {
            expect(
                isAngleInsideArc(angle, quarterTurn, 3 * quarterTurn, exact),
            ).toBe(true)
            expect(isAngleInsideArc(angle, 0, -3 * quarterTurn, exact)).toBe(
                true,
            )
        }

        expect(
            isAngleInsideArc(
                quarterTurn / 2,
                quarterTurn,
                3 * quarterTurn,
                exact,
            ),
        ).toBe(false)
        expect(
            isAngleInsideArc(quarterTurn / 2, 0, -3 * quarterTurn, exact),
        ).toBe(false)
    })

    it('includes a computed endpoint despite subtraction roundoff', () => {
        expect(isAngleInsideArc(0.1 + 0.2, 0.1, 0.2, exact)).toBe(true)
        expect(isAngleInsideArc(0.3 - 0.2, 0.3, -0.2, exact)).toBe(true)
        expect(isAngleInsideArc(0.300001, 0.1, 0.2, exact)).toBe(false)
    })

    it.each([
        [-22.41, 0.391],
        [-22.04, 1.304],
        [-15.01, -5.349],
    ])(
        'includes the computed end of an arc from unnormalized start %s within a tolerance',
        (start, sweep) => {
            expect(isAngleInsideArc(start + sweep, start, sweep, 1e-12)).toBe(
                true,
            )
        },
    )

    it('requires an explicit tolerance', () => {
        // @ts-expect-error Callers must choose a tolerance, even if it is zero.
        expect(() => isAngleInsideArc(0, 0, quarterTurn)).toThrow(RangeError)
    })

    it('excludes distinct angles immediately outside the start', () => {
        expect(isAngleInsideArc(Number.MIN_VALUE, 0, -quarterTurn, exact)).toBe(
            false,
        )
        expect(isAngleInsideArc(0, Number.MIN_VALUE, quarterTurn, exact)).toBe(
            false,
        )
    })

    it('distinguishes a zero sweep from a full circle', () => {
        expect(isAngleInsideArc(FULL_TURN, 0, 0, exact)).toBe(true)
        expect(isAngleInsideArc(Number.MIN_VALUE, 0, -0, exact)).toBe(false)
        expect(isAngleInsideArc(0, Number.MIN_VALUE, 0, exact)).toBe(false)

        for (const sweep of [FULL_TURN, -FULL_TURN]) {
            for (const angle of [0, quarterTurn, Math.PI, Number.MAX_VALUE]) {
                expect(
                    isAngleInsideArc(angle, -Number.MAX_VALUE, sweep, exact),
                ).toBe(true)
            }
        }
    })

    it('uses an inclusive explicit radians tolerance at either endpoint', () => {
        expect(isAngleInsideArc(0.375, 0.5, 0.5, 0.125)).toBe(true)
        expect(isAngleInsideArc(1.125, 0.5, 0.5, 0.125)).toBe(true)
        expect(isAngleInsideArc(0.374, 0.5, 0.5, 0.125)).toBe(false)
        expect(isAngleInsideArc(1.126, 0.5, 0.5, 0.125)).toBe(false)
        expect(isAngleInsideArc(-0.0625, 0, quarterTurn, 0.125)).toBe(true)
        expect(isAngleInsideArc(0.0625, 0, -quarterTurn, 0.125)).toBe(true)
        expect(isAngleInsideArc(-0.1875, 0, quarterTurn, 0.125)).toBe(false)
        expect(isAngleInsideArc(-0.0625, 0, quarterTurn, exact)).toBe(false)
        expect(isAngleInsideArc(-0.0625, 0, 0, 0.125)).toBe(true)
    })

    it.each([
        [0, 1e-17, 0],
        [1e-17, 0, -1],
        [0, 1e-17, 1],
        [1e-17, 0, 0],
        [2e-17, 0, 1e-17],
        [0, 2e-17, -1e-17],
    ])(
        'respects a tiny boundary gap for angle %s, start %s and sweep %s',
        (angle, start, sweep) => {
            expect(isAngleInsideArc(angle, start, sweep, 1e-18)).toBe(false)
            expect(isAngleInsideArc(angle, start, sweep, 1e-17)).toBe(true)
            expect(isAngleInsideArc(angle, start, sweep, 2e-17)).toBe(true)
        },
    )

    it.each([-1, NaN, Infinity, -Infinity])(
        'rejects invalid tolerance %s',
        (tolerance) => {
            for (const sweep of [0, quarterTurn, FULL_TURN]) {
                expect(() => isAngleInsideArc(0, 0, sweep, tolerance)).toThrow(
                    RangeError,
                )
            }
        },
    )

    it.each([FULL_TURN + 0.001, -FULL_TURN - 0.001])(
        'rejects oversized sweep %s',
        (sweep) => {
            expect(() => isAngleInsideArc(0, 0, sweep, exact)).toThrow(
                RangeError,
            )
        },
    )
})

describe('finite angle validation', () => {
    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite input %s',
        (angle) => {
            expect(() => normalizeAngle(angle)).toThrow(RangeError)
            expect(() => signedSweep(angle, 0, 'clockwise')).toThrow(RangeError)
            expect(() => signedSweep(0, angle, 'counterclockwise')).toThrow(
                RangeError,
            )
            expect(() => isAngleInsideArc(angle, 0, FULL_TURN, exact)).toThrow(
                RangeError,
            )
            expect(() => isAngleInsideArc(0, angle, FULL_TURN, exact)).toThrow(
                RangeError,
            )
            expect(() => isAngleInsideArc(0, 0, angle, exact)).toThrow(
                RangeError,
            )
        },
    )
})
