import { describe, expect, it } from 'vitest'
import { createArcBoundary } from './arc-boundary'
import { FULL_TURN } from './angle'
import { createArc } from './curve'

describe('prepared arc boundaries', () => {
    it('copies its arc and includes both endpoint rays', () => {
        const center = { x: 2, y: 3 }
        const arc = createArc({
            center,
            radius: 5,
            startAngle: 0,
            sweep: Math.PI / 2,
        })
        const boundary = createArcBoundary({
            arc: { ...arc, center },
            angularTolerance: 0,
        })

        center.x = 100

        expect(boundary.circle).toEqual({
            type: 'circle',
            center: { x: 2, y: 3 },
            radius: 5,
        })
        expect(boundary.containsDirection({ x: 1, y: 0 })).toBe(true)
        expect(boundary.containsDirection({ x: 0, y: 1 })).toBe(true)
        expect(boundary.containsDirection({ x: -1, y: 0 })).toBe(false)
        expect(boundary.containsDirection({ x: 0, y: -1 })).toBe(false)
    })

    it.each([-1, 1])(
        'preserves the tiny excluded gap for direction %s',
        (sign) => {
            const arc = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: sign * (FULL_TURN - 2 ** -50),
            })
            const direction = { x: 1, y: -sign * Number.MIN_VALUE }
            const strict = createArcBoundary({ arc, angularTolerance: 0 })
            const expanded = createArcBoundary({
                arc,
                angularTolerance: Number.MIN_VALUE,
            })

            expect(strict.containsDirection(direction)).toBe(false)
            expect(expanded.containsDirection(direction)).toBe(true)
        },
    )

    it.each([-1, NaN, Infinity])(
        'rejects invalid angular tolerance %s',
        (angularTolerance) => {
            const arc = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: 1,
            })

            expect(() => createArcBoundary({ arc, angularTolerance })).toThrow(
                RangeError,
            )
        },
    )
})
