import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import {
    intersectCircularCurves,
    type CircularPairQuery,
} from './circular-intersection'
import { createArc, createCircle, type Circle, type Arc } from './curve'

const circle = createCircle({ x: 0, y: 0 }, 5)
const other = createCircle({ x: 8, y: 0 }, 5)

function arcOn(curve: Circle, sweep: number): Arc {
    return createArc({
        center: curve.center,
        radius: curve.radius,
        startAngle: 0,
        sweep,
    })
}

describe('circular curve pairs', () => {
    it.each([-1, 1])(
        'filters either operand across zero in direction %s',
        (sign) => {
            const arc = arcOn(circle, (sign * Math.PI) / 2)
            const expected = { kind: 'points', points: [{ x: 4, y: sign * 3 }] }

            expect(
                intersectCircularCurves({
                    first: arc,
                    second: other,
                    angularTolerance: 0,
                }),
            ).toEqual(expected)
            expect(
                intersectCircularCurves({
                    first: other,
                    second: arc,
                    angularTolerance: 0,
                }),
            ).toEqual(expected)
        },
    )

    it('requires a point to belong to both arcs', () => {
        const first = arcOn(circle, Math.PI / 2)
        const upper = createArc({
            center: other.center,
            radius: 5,
            startAngle: Math.PI / 2,
            sweep: Math.PI / 2,
        })
        const lower = createArc({
            center: other.center,
            radius: 5,
            startAngle: Math.PI,
            sweep: Math.PI / 2,
        })

        expect(
            intersectCircularCurves({
                first,
                second: upper,
                angularTolerance: 0,
            }),
        ).toEqual({ kind: 'points', points: [{ x: 4, y: 3 }] })
        expect(
            intersectCircularCurves({
                first,
                second: lower,
                angularTolerance: 0,
            }),
        ).toEqual({ kind: 'none' })
    })

    it('includes tangency at either direction of an arc endpoint', () => {
        for (const sign of [-1, 1]) {
            const first = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: (sign * Math.PI) / 2,
            })
            const second = createArc({
                center: { x: 2, y: 0 },
                radius: 1,
                startAngle: Math.PI - (sign * Math.PI) / 2,
                sweep: (sign * Math.PI) / 2,
            })

            expect(
                intersectCircularCurves({ first, second, angularTolerance: 0 }),
            ).toEqual({ kind: 'points', points: [{ x: 1, y: 0 }] })
        }
    })

    it('retains two crossings inside signed major arcs', () => {
        const first = createArc({
            center: circle.center,
            radius: 5,
            startAngle: Math.PI,
            sweep: (3 * Math.PI) / 2,
        })
        const second = arcOn(other, (-3 * Math.PI) / 2)

        expect(
            intersectCircularCurves({ first, second, angularTolerance: 0 }),
        ).toEqual({
            kind: 'points',
            points: [
                { x: 4, y: -3 },
                { x: 4, y: 3 },
            ],
        })
    })

    it.each([-1, 1])(
        'preserves the near-full excluded gap for direction %s',
        (sign) => {
            const first = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: sign * (FULL_TURN - 2 ** -50),
            })
            const second = createCircle(
                { x: 1, y: -sign * Number.MIN_VALUE },
                Number.MIN_VALUE,
            )

            expect(
                intersectCircularCurves({ first, second, angularTolerance: 0 }),
            ).toEqual({ kind: 'points', points: [{ x: 1, y: 0 }] })

            const expanded = intersectCircularCurves({
                first,
                second,
                angularTolerance: 2 * Number.MIN_VALUE,
            })

            expect(expanded.kind).toBe('points')

            if (expanded.kind === 'points') {
                expect(expanded.points).toHaveLength(2)
            }
        },
    )

    it('uses both local directions when world points round identically', () => {
        const center = { x: 6e11, y: 8e11 }
        const first = createArc({
            center,
            radius: Number.MIN_VALUE,
            startAngle: 0,
            sweep: Math.PI,
        })
        const second = createCircle({ x: 0, y: 0 }, 1e12)

        expect(
            intersectCircularCurves({ first, second, angularTolerance: 0 }),
        ).toEqual({ kind: 'points', points: [center] })
        expect(
            intersectCircularCurves({
                first,
                second: arcOn(second, -Math.PI),
                angularTolerance: 0,
            }),
        ).toEqual({ kind: 'none' })
    })

    it('flags concentric and coincident supporting circles regardless of arc overlap', () => {
        const first = arcOn(circle, Math.PI / 4)
        const second = createArc({
            center: circle.center,
            radius: 5,
            startAngle: Math.PI,
            sweep: Math.PI / 4,
        })

        expect(
            intersectCircularCurves({ first, second, angularTolerance: 0 }),
        ).toEqual({ kind: 'coincident' })
        expect(
            intersectCircularCurves({
                first,
                second: createCircle(circle.center, 2),
                angularTolerance: 0,
            }),
        ).toEqual({ kind: 'concentric' })
    })

    it.each([-1, NaN, Infinity])(
        'rejects angular tolerance %s even for coincident circles',
        (angularTolerance) => {
            expect(() =>
                intersectCircularCurves({
                    first: circle,
                    second: circle,
                    angularTolerance,
                }),
            ).toThrow(RangeError)
        },
    )

    it('revalidates both operands and rejects noncircular raw curves', () => {
        const invalid = { ...arcOn(circle, Math.PI), sweep: 0 }

        expect(() =>
            intersectCircularCurves({
                first: invalid,
                second: other,
                angularTolerance: 0,
            }),
        ).toThrow(RangeError)
        expect(() =>
            intersectCircularCurves({
                first: other,
                second: invalid,
                angularTolerance: 0,
            }),
        ).toThrow(RangeError)
        expect(() =>
            intersectCircularCurves({
                first: { type: 'line' },
                second: other,
                angularTolerance: 0,
            } as unknown as CircularPairQuery),
        ).toThrow(RangeError)
    })
})
