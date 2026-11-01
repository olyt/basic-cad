import { describe, expect, it } from 'vitest'
import {
    createArc,
    createCircle,
    createLine,
    MAX_COORDINATE,
    type Arc,
    type Curve,
    type Polyline,
} from './curve'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'
import { transformCurve, type CurveTransform } from './transform'

const origin = { x: 0, y: 0 }
const modelTolerance = { distance: 1e-7 }
const arc = createArc({
    center: origin,
    radius: 2,
    startAngle: 0,
    sweep: Math.PI / 2,
})
const { start, end } = segmentEndpoints(arc)
const line = createLine(end, start)
const circle = createCircle(origin, 2)
const polyline = createPolyline(
    { segments: [arc, line], closed: true },
    modelTolerance,
)
const mirror: CurveTransform = {
    type: 'mirror',
    axis: createLine({ x: -1, y: 0 }, { x: 1, y: 0 }),
}
const apply = (curve: Curve, transform: CurveTransform) =>
    transformCurve(curve, { transform, modelTolerance })

describe('curve transforms', () => {
    it.each([line, arc, circle, polyline])(
        'moves a $type while preserving its type',
        (source) => {
            const result = apply(source, {
                type: 'move',
                offset: { x: 10, y: -3 },
            })

            expect(result.type).toBe(source.type)
            expect(curveLength(result)).toBe(curveLength(source))
        },
    )

    it('rotates circle centers and line endpoints about an explicit pivot', () => {
        const transform: CurveTransform = {
            type: 'rotate',
            center: { x: 1, y: 1 },
            angle: Math.PI / 2,
        }

        expect(apply(createCircle({ x: 2, y: 1 }, 3), transform)).toEqual(
            createCircle({ x: 1, y: 2 }, 3),
        )
        expect(
            apply(createLine({ x: 2, y: 1 }, { x: 3, y: 1 }), transform),
        ).toEqual(createLine({ x: 1, y: 2 }, { x: 1, y: 3 }))
    })

    it('scales centers, endpoints and radii without changing signed sweeps', () => {
        const transform: CurveTransform = {
            type: 'scale',
            center: { x: 1, y: 1 },
            factor: 3,
        }

        expect(apply(line, transform)).toEqual(
            createLine({ x: -2, y: 4 }, { x: 4, y: -2 }),
        )
        expect(apply(arc, transform)).toEqual(
            createArc({
                center: { x: -2, y: -2 },
                radius: 6,
                startAngle: 0,
                sweep: arc.sweep,
            }),
        )
        expect(apply(circle, transform)).toEqual(
            createCircle({ x: -2, y: -2 }, 6),
        )
    })

    it.each([-1, 1])(
        'reflects arc endpoints in place and reverses sweep sign %s',
        (sign) => {
            const source = createArc({
                center: origin,
                radius: 2,
                startAngle: 0,
                sweep: (sign * Math.PI) / 2,
            })
            const result = apply(source, mirror) as Arc

            expect(result.sweep).toBe(-source.sweep)
            expect(segmentEndpoints(result)).toEqual({
                start: { x: 2, y: 0 },
                end: { x: 0, y: -sign * 2 },
            })
            expect(apply(result, mirror)).toEqual(source)
        },
    )

    it.each([false, true])(
        'keeps mixed polyline order and closure %s through reflection',
        (closed) => {
            const source = createPolyline(
                { segments: [arc, line], closed },
                modelTolerance,
            )
            const result = apply(source, mirror) as Polyline

            expect(result.closed).toBe(closed)
            expect(result.segments).toEqual([
                createArc({ ...arc, sweep: -arc.sweep }),
                createLine({ x: 0, y: -2 }, { x: 2, y: 0 }),
            ])
            expect(apply(result, mirror)).toEqual(source)
        },
    )

    it('retains exact cardinal connectivity with zero model tolerance', () => {
        const result = transformCurve(polyline, {
            transform: { type: 'rotate', center: origin, angle: Math.PI / 2 },
            modelTolerance: { distance: 0 },
        })

        expect(result).toMatchObject({ type: 'polyline', closed: true })
    })

    it('returns independent geometry without changing its input', () => {
        const original = structuredClone(polyline)
        const result = apply(polyline, {
            type: 'move',
            offset: origin,
        }) as Polyline

        expect(polyline).toEqual(original)
        expect(result).toEqual(polyline)
        expect(result.segments).not.toBe(polyline.segments)
        expect(result.segments[0]).not.toBe(polyline.segments[0])
        expect((result.segments[0] as Arc).center).not.toBe(arc.center)
    })

    it('scales existing gaps and checks the unchanged drawing tolerance', () => {
        const source = createPolyline(
            {
                segments: [
                    createLine(origin, { x: 1, y: 0 }),
                    createLine({ x: 1.0625, y: 0 }, { x: 2, y: 0 }),
                ],
                closed: false,
            },
            { distance: 0.125 },
        )
        const input = {
            transform: { type: 'scale' as const, center: origin, factor: 2 },
            modelTolerance: { distance: 0.125 },
        }

        expect(transformCurve(source, input)).toEqual(
            createPolyline(
                {
                    segments: [
                        createLine(origin, { x: 2, y: 0 }),
                        createLine({ x: 2.125, y: 0 }, { x: 4, y: 0 }),
                    ],
                    closed: false,
                },
                input.modelTolerance,
            ),
        )
        expect(() =>
            transformCurve(source, {
                ...input,
                transform: { ...input.transform, factor: 4 },
            }),
        ).toThrow('connect')
    })

    it('checks the complete source before a transform could hide an invalid gap', () => {
        const source: Polyline = {
            type: 'polyline',
            closed: false,
            segments: [line, createLine({ x: 20, y: 0 }, { x: 30, y: 0 })],
        }

        expect(() =>
            apply(source, { type: 'scale', center: origin, factor: 1e-10 }),
        ).toThrow('connect')
    })

    it('rejects unsupported coordinates, radii and collapsed geometry atomically', () => {
        const source = createLine(
            { x: MAX_COORDINATE - 1, y: 0 },
            { x: MAX_COORDINATE, y: 0 },
        )
        const original = structuredClone(source)

        expect(() =>
            apply(source, { type: 'move', offset: { x: 1, y: 0 } }),
        ).toThrow('Coordinates')
        expect(() =>
            apply(createCircle(origin, MAX_COORDINATE), {
                type: 'scale',
                center: origin,
                factor: 2,
            }),
        ).toThrow('Radius')
        expect(() =>
            apply(createCircle(origin, Number.MIN_VALUE), {
                type: 'scale',
                center: origin,
                factor: 0.5,
            }),
        ).toThrow('Radius')
        expect(() =>
            apply(createLine(origin, { x: Number.MIN_VALUE, y: 0 }), {
                type: 'move',
                offset: { x: 1, y: 0 },
            }),
        ).toThrow('distinct')
        expect(source).toEqual(original)
    })

    it('rejects an unrepresentable transformed arc phase', () => {
        const source = createArc({
            center: origin,
            radius: 1e15,
            startAngle: 1,
            sweep: 1e-20,
        })

        expect(() =>
            apply(source, { type: 'rotate', center: origin, angle: 1e-18 }),
        ).toThrow('arc start angle')
    })

    it('rejects transformed arcs whose length is no longer representable', () => {
        const tiny = createArc({
            center: origin,
            radius: 1e-300,
            startAngle: 0,
            sweep: 1e-10,
        })
        const path = createPolyline(
            {
                segments: [
                    tiny,
                    createLine(segmentEndpoints(tiny).end, { x: 1, y: 0 }),
                ],
                closed: false,
            },
            modelTolerance,
        )

        for (const source of [tiny, path]) {
            expect(() =>
                apply(source, { type: 'scale', center: origin, factor: 1e-20 }),
            ).toThrow('Curve length')
        }
    })

    it.each([-1, NaN, Infinity, undefined])(
        'requires valid model tolerance %s',
        (distance) => {
            expect(() =>
                transformCurve(line, {
                    transform: mirror,
                    modelTolerance: { distance: distance as number },
                }),
            ).toThrow(RangeError)
        },
    )
})
