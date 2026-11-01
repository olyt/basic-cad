import { describe, expect, it, vi } from 'vitest'
import {
    createArc,
    createCircle,
    createLine,
    type Curve,
    type Polyline,
} from './curve'
import { intersectCurves } from './curve-intersection'
import { evaluateCurve } from './evaluation'
import { createPolyline } from './polyline'
import * as primitiveModule from './primitive-intersection'

function path(points: readonly { x: number; y: number }[]): Polyline {
    const segments = points
        .slice(1)
        .map((point, index) => createLine(points[index]!, point))

    return createPolyline({ segments, closed: false }, { distance: 0 })
}

describe('curve and polyline intersections', () => {
    it('returns locations on both open polylines', () => {
        const first = path([
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
        ])
        const second = path([
            { x: 2, y: -2 },
            { x: 2, y: 2 },
            { x: 6, y: 2 },
        ])
        const result = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        })

        expect(result).toEqual({
            hits: [
                {
                    point: { x: 2, y: 0 },
                    first: { segmentIndex: 0, parameter: 0.5 },
                    second: { segmentIndex: 0, parameter: 0.5 },
                },
                {
                    point: { x: 4, y: 2 },
                    first: { segmentIndex: 1, parameter: 0.5 },
                    second: { segmentIndex: 1, parameter: 0.5 },
                },
            ],
            coincident: [],
        })

        for (const hit of result.hits) {
            expect(evaluateCurve(first, hit.first).point).toEqual(hit.point)
            expect(evaluateCurve(second, hit.second).point).toEqual(hit.point)
        }
    })

    it('handles circles, signed arcs and mixed line/arc polylines', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: Math.PI,
            sweep: -Math.PI,
        })
        const first = createPolyline(
            {
                segments: [arc, createLine({ x: 1, y: 0 }, { x: 2, y: 0 })],
                closed: false,
            },
            { distance: 0 },
        )
        const second = createLine({ x: 0, y: -2 }, { x: 0, y: 2 })
        const result = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        })

        expect(result).toEqual({
            hits: [
                {
                    point: { x: 0, y: 1 },
                    first: { segmentIndex: 0, parameter: 0.5 },
                    second: { parameter: 0.75 },
                },
            ],
            coincident: [],
        })

        const circle = createCircle({ x: 1, y: 0 }, 1)
        const circularHits = intersectCurves({
            first,
            second: circle,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        }).hits

        expect(circularHits).toHaveLength(2)

        for (const hit of circularHits) {
            const point = evaluateCurve(first, hit.first).point

            expect(
                Math.hypot(point.x - hit.point.x, point.y - hit.point.y),
            ).toBeLessThan(1e-14)
            expect('segmentIndex' in hit.second).toBe(false)
        }
    })

    it('keeps angularly admitted roots outside the tight arc box', () => {
        const first = createPolyline(
            {
                segments: [
                    createArc({
                        center: { x: 0, y: 0 },
                        radius: 1,
                        startAngle: 0,
                        sweep: Math.PI / 2,
                    }),
                ],
                closed: false,
            },
            { distance: 0 },
        )
        const second = createLine({ x: 0, y: -1e-10 }, { x: 2, y: -1e-10 })

        expect(
            intersectCurves({
                first,
                second,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }).hits,
        ).toEqual([])
        expect(
            intersectCurves({
                first,
                second,
                modelTolerance: { distance: 0 },
                angularTolerance: 1e-9,
            }).hits,
        ).toEqual([
            {
                point: { x: 1, y: -1e-10 },
                first: { segmentIndex: 0, parameter: 0 },
                second: { parameter: 0.5 },
            },
        ])
    })

    it('rejects disjoint bounds before calling any exact primitive kernel', () => {
        const first = path([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0 },
        ])
        const second = path([
            { x: 100, y: 100 },
            { x: 101, y: 101 },
        ])
        const spy = vi.spyOn(primitiveModule, 'intersectPrimitiveParts')

        try {
            expect(
                intersectCurves({
                    first,
                    second,
                    modelTolerance: { distance: 0 },
                    angularTolerance: 0,
                }),
            ).toEqual({ hits: [], coincident: [] })
            expect(spy).not.toHaveBeenCalled()
        } finally {
            spy.mockRestore()
        }
    })

    it('reports coincident candidate supports without extracting overlaps', () => {
        const first = path([
            { x: 0, y: 0 },
            { x: 4, y: 0 },
        ])
        const second = createLine({ x: 2, y: 0 }, { x: 6, y: 0 })

        expect(
            intersectCurves({
                first,
                second,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }),
        ).toEqual({ hits: [], coincident: [{ firstSegmentIndex: 0 }] })
    })

    it('validates geometry and tolerance even for disjoint shapes', () => {
        const first = createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
        const invalid = {
            type: 'polyline',
            segments: [],
            closed: false,
        } as Polyline

        expect(() =>
            intersectCurves({
                first,
                second: invalid,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }),
        ).toThrow(RangeError)

        for (const angularTolerance of [-1, NaN, Infinity]) {
            expect(() =>
                intersectCurves({
                    first,
                    second: first,
                    modelTolerance: { distance: 0 },
                    angularTolerance,
                }),
            ).toThrow(RangeError)
        }

        expect(() =>
            intersectCurves({
                first: { type: 'spline' } as unknown as Curve,
                second: first,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }),
        ).toThrow(RangeError)
    })
})
