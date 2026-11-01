import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createArc, createLine } from './curve'
import { transformArcAngle } from './transform-angle'
import { prepareTransform } from './transform-point'

const center = { x: 0, y: 0 }
const modelTolerance = { distance: 0 }
const arc = createArc({ center, radius: 1, startAngle: 0.7, sweep: 1 })

describe('transformed arc phases', () => {
    it('adds a rotation and wraps an exact full-turn boundary', () => {
        const transform = prepareTransform({ type: 'rotate', center, angle: 1 })

        expect(
            transformArcAngle(arc, { transform, radius: 1, modelTolerance }),
        ).toBe(1.7)

        const boundary = createArc({
            center,
            radius: 1,
            startAngle: FULL_TURN - 2 ** -50,
            sweep: 1,
        })
        const wrapped = prepareTransform({
            type: 'rotate',
            center,
            angle: 2 ** -50,
        })

        expect(
            transformArcAngle(boundary, {
                transform: wrapped,
                radius: 1,
                modelTolerance,
            }),
        ).toBe(0)
    })

    it('measures phase error across the full-turn seam', () => {
        // The exact phase lies just below a turn and rounds up to zero.
        const transform = prepareTransform({
            type: 'rotate',
            center,
            angle: -(arc.startAngle + 2 ** -53),
        })

        expect(
            transformArcAngle(arc, { transform, radius: 1, modelTolerance }),
        ).toBe(0)
    })

    it('reflects the original start ray without exchanging endpoints', () => {
        const transform = prepareTransform({
            type: 'mirror',
            axis: createLine(center, { x: 1, y: 1 }),
        })
        const input = createArc({
            center,
            radius: 1,
            startAngle: Math.PI / 2,
            sweep: 0.5,
        })

        expect(
            transformArcAngle(input, { transform, radius: 1, modelTolerance }),
        ).toBe(0)
    })

    it('retains the exact phase for movement and positive scaling', () => {
        for (const transform of [
            prepareTransform({ type: 'move', offset: { x: 10, y: 20 } }),
            prepareTransform({ type: 'scale', center, factor: 2 }),
        ]) {
            expect(
                transformArcAngle(arc, {
                    transform,
                    radius: 2,
                    modelTolerance,
                }),
            ).toBe(arc.startAngle)
        }
    })

    it('rejects a shifted tiny arc whose start angle cannot encode the requested placement', () => {
        const input = createArc({
            center,
            radius: 1e15,
            startAngle: 1,
            sweep: 1e-20,
        })
        const transform = prepareTransform({
            type: 'rotate',
            center,
            angle: 1e-18,
        })

        expect(() =>
            transformArcAngle(input, {
                transform,
                radius: input.radius,
                modelTolerance: { distance: 1e-7 },
            }),
        ).toThrow('cannot preserve')
    })

    it.each([-1, 1])(
        'pins the relative budget independently of model tolerance for sweep sign %s',
        (sign) => {
            const step = 2 ** -54
            const input = createArc({
                center,
                radius: 1,
                startAngle: 1,
                sweep: sign * 100_000_000 * step,
            })
            const transform = prepareTransform({
                type: 'rotate',
                center,
                angle: step,
            })

            expect(
                transformArcAngle(input, {
                    transform,
                    radius: 1,
                    modelTolerance,
                }),
            ).toBe(1)
            expect(() =>
                transformArcAngle(
                    { ...input, sweep: sign * 99_999_999 * step },
                    { transform, radius: 1, modelTolerance },
                ),
            ).toThrow('cannot preserve')
        },
    )

    it('pins the quarter-distance allowance using the transformed radius', () => {
        const step = 2 ** -54
        const input = createArc({
            center,
            radius: 1,
            startAngle: 1,
            sweep: 1e-14,
        })
        const transform = prepareTransform({
            type: 'rotate',
            center,
            angle: step,
        })
        const distance = 4e6 * step

        expect(
            transformArcAngle(input, {
                transform,
                radius: 1e6,
                modelTolerance: { distance },
            }),
        ).toBe(1)
        expect(() =>
            transformArcAngle(input, {
                transform,
                radius: 1e6,
                modelTolerance: { distance: distance * (1 - Number.EPSILON) },
            }),
        ).toThrow('cannot preserve')
    })
})
