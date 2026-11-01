import { describe, expect, it } from 'vitest'
import { createArcBoundary } from './arc-boundary'
import { FULL_TURN } from './angle'
import { createArc } from './curve'

describe('arc direction locations', () => {
    it.each([-1, 1])(
        'locates endpoints and interior rays for direction %s',
        (sign) => {
            const arc = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: (sign * Math.PI) / 2,
            })
            const boundary = createArcBoundary({ arc, angularTolerance: 0 })

            expect(boundary.locateDirection({ x: 1, y: 0 })).toEqual({
                parameter: 0,
                endpoint: 'start',
            })
            expect(boundary.locateDirection({ x: 0, y: sign })).toEqual({
                parameter: 1,
                endpoint: 'end',
            })
            expect(
                boundary.locateDirection({
                    x: Math.SQRT1_2,
                    y: sign * Math.SQRT1_2,
                }),
            ).toEqual({ parameter: 0.5 })
            expect(boundary.locateDirection({ x: 0, y: -sign })).toBeUndefined()
        },
    )

    it.each([-1, 1])(
        'locates a signed major sweep and its excluded gap for direction %s',
        (sign) => {
            const arc = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0,
                sweep: (sign * 3 * Math.PI) / 2,
            })
            const boundary = createArcBoundary({ arc, angularTolerance: 0 })

            expect(
                boundary.locateDirection({ x: -1, y: 0 })?.parameter,
            ).toBeCloseTo(2 / 3, 15)
            expect(boundary.locateDirection({ x: 0, y: -sign })).toEqual({
                parameter: 1,
                endpoint: 'end',
            })
            expect(
                boundary.locateDirection({ x: 1, y: -sign * Number.MIN_VALUE }),
            ).toBeUndefined()
        },
    )

    it('uses angular allowance without assigning false endpoint identities', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0,
            sweep: Math.PI / 2,
        })
        const boundary = createArcBoundary({ arc, angularTolerance: 1e-9 })

        expect(boundary.locateDirection({ x: 1, y: -1e-10 })).toEqual({
            parameter: 0,
        })
        expect(
            boundary.locateDirection({ x: 1, y: 1e-10 })?.parameter,
        ).toBeGreaterThan(0)
        expect(
            boundary.locateDirection({ x: 1, y: 1e-10 })?.endpoint,
        ).toBeUndefined()
    })

    it('does not claim a unique endpoint for unresolved endpoint rays', () => {
        const startAngle = Math.PI / 4
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle,
            sweep: Number.MIN_VALUE,
        })
        const boundary = createArcBoundary({ arc, angularTolerance: 0 })

        expect(
            boundary.locateDirection({
                x: Math.cos(startAngle),
                y: Math.sin(startAngle),
            }),
        ).toEqual({ parameter: 0 })
    })

    it('keeps a near-full excluded ray outside at zero tolerance', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0,
            sweep: FULL_TURN - 2 ** -50,
        })

        expect(
            createArcBoundary({ arc, angularTolerance: 0 }).locateDirection({
                x: 1,
                y: -Number.MIN_VALUE,
            }),
        ).toBeUndefined()
    })
})
