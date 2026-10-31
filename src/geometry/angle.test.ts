import { describe, expect, it } from 'vitest'
import {
    FULL_TURN,
    type AngleDirection,
    isAngleInsideArc,
    isDeltaInsideSweep,
    normalizeAngle,
    signedSweep,
} from './angle'
import { seededRandom } from '../test-support/random'

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
        expect(
            signedSweep(
                { startAngle: 0, endAngle: quarterTurn },
                'counterclockwise',
            ),
        ).toBe(quarterTurn)
        expect(
            signedSweep({ startAngle: 0, endAngle: quarterTurn }, 'clockwise'),
        ).toBe(-3 * quarterTurn)
        expect(
            signedSweep(
                { startAngle: quarterTurn, endAngle: 0 },
                'counterclockwise',
            ),
        ).toBe(3 * quarterTurn)
        expect(
            signedSweep({ startAngle: quarterTurn, endAngle: 0 }, 'clockwise'),
        ).toBe(-quarterTurn)
    })

    it('crosses zero in either direction', () => {
        const start = 3.5 * quarterTurn
        const end = 0.5 * quarterTurn

        expect(
            signedSweep(
                { startAngle: start, endAngle: end },
                'counterclockwise',
            ),
        ).toBeCloseTo(quarterTurn, 14)
        expect(
            signedSweep({ startAngle: end, endAngle: start }, 'clockwise'),
        ).toBeCloseTo(-quarterTurn, 14)
    })

    it.each<AngleDirection>(['clockwise', 'counterclockwise'])(
        'uses zero for identical endpoints in direction %s',
        (direction) => {
            expect(
                signedSweep(
                    { startAngle: quarterTurn, endAngle: quarterTurn },
                    direction,
                ),
            ).toBe(0)
            expect(
                signedSweep({ startAngle: 0, endAngle: FULL_TURN }, direction),
            ).toBe(0)

            const sweep = signedSweep(
                { startAngle: Number.MAX_VALUE, endAngle: -Number.MAX_VALUE },
                direction,
            )

            expect(Number.isFinite(sweep)).toBe(true)
            expect(Math.abs(sweep)).toBeLessThan(FULL_TURN)
        },
    )

    it('keeps distinct endpoints a nearly full turn apart', () => {
        const beforeOne = 1 - Number.EPSILON / 2
        const afterOne = 1 + Number.EPSILON
        const counterclockwise = signedSweep(
            { startAngle: 1, endAngle: beforeOne },
            'counterclockwise',
        )
        const clockwise = signedSweep(
            { startAngle: 1, endAngle: afterOne },
            'clockwise',
        )

        expect(counterclockwise).toBeGreaterThan(FULL_TURN - 1e-14)
        expect(counterclockwise).toBeLessThan(FULL_TURN)
        expect(clockwise).toBeLessThan(-(FULL_TURN - 1e-14))
        expect(clockwise).toBeGreaterThan(-FULL_TURN)
    })

    it('rejects unsupported directions at runtime', () => {
        const sideways = 'sideways' as AngleDirection

        expect(() =>
            signedSweep({ startAngle: 0, endAngle: 1 }, sideways),
        ).toThrow(RangeError)
        expect(() =>
            signedSweep({ startAngle: 1, endAngle: 1 }, sideways),
        ).toThrow(RangeError)
    })
})

describe('signed delta inclusion in sweeps', () => {
    it('includes partial-sweep endpoints, including either sign of the opposite ray', () => {
        expect(isDeltaInsideSweep(0, 0)).toBe(true)
        expect(isDeltaInsideSweep(-0, 0)).toBe(true)
        expect(isDeltaInsideSweep(Number.MIN_VALUE, 0)).toBe(false)
        expect(isDeltaInsideSweep(-Number.MIN_VALUE, 0)).toBe(false)
        expect(isDeltaInsideSweep(Number.MIN_VALUE, Number.MIN_VALUE)).toBe(
            true,
        )
        expect(isDeltaInsideSweep(-Number.MIN_VALUE, Number.MIN_VALUE)).toBe(
            false,
        )
        expect(isDeltaInsideSweep(quarterTurn, quarterTurn)).toBe(true)
        expect(isDeltaInsideSweep(-quarterTurn, quarterTurn)).toBe(false)

        for (const delta of [-Math.PI, Math.PI]) {
            expect(isDeltaInsideSweep(delta, Math.PI)).toBe(true)
            expect(isDeltaInsideSweep(delta, Math.PI - 2 ** -51)).toBe(false)
        }
    })

    it('preserves the excluded gap and its inclusive endpoint in major sweeps', () => {
        expect(isDeltaInsideSweep(-quarterTurn, 3 * quarterTurn)).toBe(true)
        expect(
            isDeltaInsideSweep(-quarterTurn + Number.EPSILON, 3 * quarterTurn),
        ).toBe(false)

        const gap = 2 ** -50
        const magnitude = FULL_TURN - gap

        expect(isDeltaInsideSweep(-gap, magnitude)).toBe(true)
        expect(isDeltaInsideSweep(-2 * gap, magnitude)).toBe(true)
        expect(isDeltaInsideSweep(-gap / 2, magnitude)).toBe(false)
        expect(isDeltaInsideSweep(-Number.MIN_VALUE, magnitude)).toBe(false)
        expect(isDeltaInsideSweep(0, magnitude)).toBe(true)
    })

    it('includes every supported delta in a full turn', () => {
        for (const delta of [
            -Math.PI,
            -quarterTurn,
            -Number.MIN_VALUE,
            -0,
            0,
            Number.MIN_VALUE,
            quarterTurn,
            Math.PI,
        ]) {
            expect(isDeltaInsideSweep(delta, FULL_TURN)).toBe(true)
        }
    })

    it.each([
        NaN,
        Infinity,
        -Infinity,
        Math.PI + 2 ** -51,
        -Math.PI - 2 ** -51,
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
    ])('rejects unsupported delta %s before classifying any sweep', (delta) => {
        for (const magnitude of [0, Math.PI, FULL_TURN]) {
            expect(() => isDeltaInsideSweep(delta, magnitude)).toThrow(
                RangeError,
            )
        }
    })

    it.each([
        NaN,
        Infinity,
        -Infinity,
        -Number.MIN_VALUE,
        -1,
        FULL_TURN + 2 ** -50,
        Number.MAX_VALUE,
    ])(
        'rejects unsupported magnitude %s before classifying any delta',
        (magnitude) => {
            for (const delta of [-Math.PI, 0, Math.PI]) {
                expect(() => isDeltaInsideSweep(delta, magnitude)).toThrow(
                    RangeError,
                )
            }
        },
    )
})

describe('angle inclusion in arcs', () => {
    it.each([1, -1])(
        'includes wrapped arc endpoints in direction %s',
        (sign) => {
            const start = sign > 0 ? 3.5 * quarterTurn : 0.5 * quarterTurn
            const end = sign > 0 ? 0.5 * quarterTurn : 3.5 * quarterTurn
            const sweep = sign * quarterTurn

            expect(
                isAngleInsideArc({
                    angle: start,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: end,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: 0,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: quarterTurn,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(false)
            expect(
                isAngleInsideArc({
                    angle: 3 * quarterTurn,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(false)
        },
    )

    it('includes major arcs without including their complementary gap', () => {
        for (const angle of [Math.PI, 3 * quarterTurn]) {
            expect(
                isAngleInsideArc({
                    angle,
                    startAngle: quarterTurn,
                    sweep: 3 * quarterTurn,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle,
                    startAngle: 0,
                    sweep: -3 * quarterTurn,
                    angularTolerance: exact,
                }),
            ).toBe(true)
        }

        expect(
            isAngleInsideArc({
                angle: quarterTurn / 2,
                startAngle: quarterTurn,
                sweep: 3 * quarterTurn,
                angularTolerance: exact,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: quarterTurn / 2,
                startAngle: 0,
                sweep: -3 * quarterTurn,
                angularTolerance: exact,
            }),
        ).toBe(false)
    })

    it.each([1, -1])(
        'preserves a tiny complementary gap in direction %s',
        (sign) => {
            const gap = 2 ** -50
            const start = sign < 0 ? 1e-15 : 2 ** -49
            const angle = sign < 0 ? 2 ** -49 : 1e-15
            const sweep = sign * (FULL_TURN - gap)
            const endTolerance = gap - Math.abs(angle - start)
            const end = start - sign * gap

            expect(
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(false)
            expect(
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: endTolerance / 2,
                }),
            ).toBe(false)
            expect(
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: endTolerance,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: start,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: end,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: start + sign * gap,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
        },
    )

    it.each([1, -1])(
        'keeps tiny complementary gaps across zero in direction %s',
        (sign) => {
            const halfGap = 2 ** -50
            const start = sign < 0 ? FULL_TURN - halfGap : halfGap
            const sweep = sign * (FULL_TURN - 2 * halfGap)
            const insideGap = halfGap / 2

            expect(
                isAngleInsideArc({
                    angle: insideGap,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(false)
            expect(
                isAngleInsideArc({
                    angle: 1.5 * halfGap,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toBe(true)
            expect(
                isAngleInsideArc({
                    angle: insideGap,
                    startAngle: start,
                    sweep,
                    angularTolerance: halfGap / 2,
                }),
            ).toBe(true)
        },
    )

    it('includes a computed endpoint despite subtraction roundoff', () => {
        expect(
            isAngleInsideArc({
                angle: 0.1 + 0.2,
                startAngle: 0.1,
                sweep: 0.2,
                angularTolerance: exact,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: 0.3 - 0.2,
                startAngle: 0.3,
                sweep: -0.2,
                angularTolerance: exact,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: 0.300001,
                startAngle: 0.1,
                sweep: 0.2,
                angularTolerance: exact,
            }),
        ).toBe(false)
    })

    it.each([
        [-22.41, 0.391],
        [-22.04, 1.304],
        [-15.01, -5.349],
    ])(
        'includes the computed end of an arc from unnormalized start %s within a tolerance',
        (start, sweep) => {
            expect(
                isAngleInsideArc({
                    angle: start + sweep,
                    startAngle: start,
                    sweep,
                    angularTolerance: 1e-12,
                }),
            ).toBe(true)
        },
    )

    it('requires an explicit tolerance', () => {
        expect(() => {
            // @ts-expect-error Callers must choose a tolerance, even if it is zero.
            isAngleInsideArc({ angle: 0, startAngle: 0, sweep: quarterTurn })
        }).toThrow(RangeError)
    })

    it('excludes distinct angles immediately outside the start', () => {
        expect(
            isAngleInsideArc({
                angle: Number.MIN_VALUE,
                startAngle: 0,
                sweep: -quarterTurn,
                angularTolerance: exact,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: 0,
                startAngle: Number.MIN_VALUE,
                sweep: quarterTurn,
                angularTolerance: exact,
            }),
        ).toBe(false)
    })

    it('distinguishes a zero sweep from a full circle', () => {
        expect(
            isAngleInsideArc({
                angle: FULL_TURN,
                startAngle: 0,
                sweep: 0,
                angularTolerance: exact,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: Number.MIN_VALUE,
                startAngle: 0,
                sweep: -0,
                angularTolerance: exact,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: 0,
                startAngle: Number.MIN_VALUE,
                sweep: 0,
                angularTolerance: exact,
            }),
        ).toBe(false)

        for (const sweep of [FULL_TURN, -FULL_TURN]) {
            for (const angle of [0, quarterTurn, Math.PI, Number.MAX_VALUE]) {
                expect(
                    isAngleInsideArc({
                        angle,
                        startAngle: -Number.MAX_VALUE,
                        sweep,
                        angularTolerance: exact,
                    }),
                ).toBe(true)
            }
        }
    })

    it('uses an inclusive explicit radians tolerance at either endpoint', () => {
        expect(
            isAngleInsideArc({
                angle: 0.375,
                startAngle: 0.5,
                sweep: 0.5,
                angularTolerance: 0.125,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: 1.125,
                startAngle: 0.5,
                sweep: 0.5,
                angularTolerance: 0.125,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: 0.374,
                startAngle: 0.5,
                sweep: 0.5,
                angularTolerance: 0.125,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: 1.126,
                startAngle: 0.5,
                sweep: 0.5,
                angularTolerance: 0.125,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: -0.0625,
                startAngle: 0,
                sweep: quarterTurn,
                angularTolerance: 0.125,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: 0.0625,
                startAngle: 0,
                sweep: -quarterTurn,
                angularTolerance: 0.125,
            }),
        ).toBe(true)
        expect(
            isAngleInsideArc({
                angle: -0.1875,
                startAngle: 0,
                sweep: quarterTurn,
                angularTolerance: 0.125,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: -0.0625,
                startAngle: 0,
                sweep: quarterTurn,
                angularTolerance: exact,
            }),
        ).toBe(false)
        expect(
            isAngleInsideArc({
                angle: -0.0625,
                startAngle: 0,
                sweep: 0,
                angularTolerance: 0.125,
            }),
        ).toBe(true)
    })

    it.each([
        { angle: 0, startAngle: 1e-17, sweep: 0 },
        { angle: 1e-17, startAngle: 0, sweep: -1 },
        { angle: 0, startAngle: 1e-17, sweep: 1 },
        { angle: 1e-17, startAngle: 0, sweep: 0 },
        { angle: 2e-17, startAngle: 0, sweep: 1e-17 },
        { angle: 0, startAngle: 2e-17, sweep: -1e-17 },
    ])(
        'respects a tiny boundary gap for angle $angle, start $startAngle and sweep $sweep',
        (arc) => {
            expect(isAngleInsideArc({ ...arc, angularTolerance: 1e-18 })).toBe(
                false,
            )
            expect(isAngleInsideArc({ ...arc, angularTolerance: 1e-17 })).toBe(
                true,
            )
            expect(isAngleInsideArc({ ...arc, angularTolerance: 2e-17 })).toBe(
                true,
            )
        },
    )

    it.each([-1, NaN, Infinity, -Infinity])(
        'rejects invalid tolerance %s',
        (tolerance) => {
            for (const sweep of [0, quarterTurn, FULL_TURN]) {
                expect(() =>
                    isAngleInsideArc({
                        angle: 0,
                        startAngle: 0,
                        sweep,
                        angularTolerance: tolerance,
                    }),
                ).toThrow(RangeError)
            }
        },
    )

    it.each([FULL_TURN + 0.001, -FULL_TURN - 0.001])(
        'rejects oversized sweep %s',
        (sweep) => {
            expect(() =>
                isAngleInsideArc({
                    angle: 0,
                    startAngle: 0,
                    sweep,
                    angularTolerance: exact,
                }),
            ).toThrow(RangeError)
        },
    )
})

describe('finite angle validation', () => {
    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite input %s',
        (angle) => {
            expect(() => normalizeAngle(angle)).toThrow(RangeError)
            expect(() =>
                signedSweep({ startAngle: angle, endAngle: 0 }, 'clockwise'),
            ).toThrow(RangeError)
            expect(() =>
                signedSweep(
                    { startAngle: 0, endAngle: angle },
                    'counterclockwise',
                ),
            ).toThrow(RangeError)
            expect(() =>
                isAngleInsideArc({
                    angle,
                    startAngle: 0,
                    sweep: FULL_TURN,
                    angularTolerance: exact,
                }),
            ).toThrow(RangeError)
            expect(() =>
                isAngleInsideArc({
                    angle: 0,
                    startAngle: angle,
                    sweep: FULL_TURN,
                    angularTolerance: exact,
                }),
            ).toThrow(RangeError)
            expect(() =>
                isAngleInsideArc({
                    angle: 0,
                    startAngle: 0,
                    sweep: angle,
                    angularTolerance: exact,
                }),
            ).toThrow(RangeError)
        },
    )
})

describe('arc membership properties (fixed seed)', () => {
    const tolerance = 1e-12
    const random = seededRandom(20261016)
    // Unnormalized angles on purpose: transforms will produce them.
    const cases = Array.from({ length: 20_000 }, () => ({
        angle: random.between(-30, 30),
        start: random.between(-30, 30),
        end: random.between(-30, 30),
        sweep: random.sign() * random.between(1e-9, FULL_TURN - 1e-9),
        direction: (random.sign() > 0
            ? 'counterclockwise'
            : 'clockwise') as AngleDirection,
    }))

    function circularDistance(first: number, second: number): number {
        const gap = Math.abs(normalizeAngle(first) - normalizeAngle(second))

        return Math.min(gap, FULL_TURN - gap)
    }

    it('never excludes an included angle when the tolerance grows', () => {
        const failures = cases.filter(
            ({ angle, start, sweep }) =>
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: tolerance,
                }) &&
                !isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: 10 * tolerance,
                }),
        )

        expect(failures).toEqual([])
    })

    it('gives the same answer for an arc read from its other end', () => {
        const failures = cases.filter(
            ({ angle, start, sweep }) =>
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: tolerance,
                }) !==
                isAngleInsideArc({
                    angle,
                    startAngle: start + sweep,
                    sweep: -sweep,
                    angularTolerance: tolerance,
                }),
        )

        expect(failures).toEqual([])
    })

    it('puts every angle away from the endpoints in exactly one of an arc and its complement', () => {
        const failures = cases.filter(({ angle, start, sweep }) => {
            const end = start + sweep
            const complement = Math.sign(sweep) * (FULL_TURN - Math.abs(sweep))
            const nearEndpoint =
                circularDistance(angle, start) < 1e-9 ||
                circularDistance(angle, end) < 1e-9

            return (
                !nearEndpoint &&
                isAngleInsideArc({
                    angle,
                    startAngle: start,
                    sweep,
                    angularTolerance: tolerance,
                }) ===
                    isAngleInsideArc({
                        angle,
                        startAngle: end,
                        sweep: complement,
                        angularTolerance: tolerance,
                    })
            )
        })

        expect(failures).toEqual([])
    })

    it('includes both ends of every sweep from signedSweep', () => {
        const failures = cases.filter(({ start, end, direction }) => {
            const sweep = signedSweep(
                { startAngle: start, endAngle: end },
                direction,
            )

            return (
                !isAngleInsideArc({
                    angle: end,
                    startAngle: start,
                    sweep,
                    angularTolerance: tolerance,
                }) ||
                !isAngleInsideArc({
                    angle: start,
                    startAngle: start,
                    sweep,
                    angularTolerance: exact,
                })
            )
        })

        expect(failures).toEqual([])
    })
})
