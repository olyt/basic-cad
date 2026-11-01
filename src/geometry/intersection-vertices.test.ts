import { describe, expect, it } from 'vitest'
import { createArc, createCircle, createLine, type Polyline } from './curve'
import { intersectCurves } from './curve-intersection'
import { createPolyline } from './polyline'

const origin = { x: 0, y: 0 }

function path(
    points: readonly { x: number; y: number }[],
    closed = false,
): Polyline {
    return createPolyline(
        {
            segments: points
                .slice(1)
                .map((point, index) => createLine(points[index]!, point)),
            closed,
        },
        { distance: 0 },
    )
}

describe('intersection vertex identity', () => {
    it('reports a shared vertex once when it belongs to both polylines', () => {
        const first = path([{ x: -1, y: 1 }, origin, { x: 1, y: 1 }])
        const second = path([{ x: -2, y: 0 }, origin, { x: 2, y: 0 }])

        expect(
            intersectCurves({
                first,
                second,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }),
        ).toEqual({
            hits: [
                {
                    point: origin,
                    first: { segmentIndex: 0, parameter: 1 },
                    second: { segmentIndex: 0, parameter: 1 },
                },
            ],
            coincident: [],
        })
    })

    it('unifies the closed seam while keeping an open path’s repeated ends separate', () => {
        const points = [origin, { x: 2, y: 0 }, { x: 0, y: 2 }, origin]
        const second = createLine({ x: -1, y: 1 }, { x: 1, y: -1 })
        const closed = intersectCurves({
            first: path(points, true),
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        })
        const open = intersectCurves({
            first: path(points),
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        })

        expect(closed.hits).toEqual([
            {
                point: origin,
                first: { segmentIndex: 0, parameter: 0 },
                second: { parameter: 0.5 },
            },
        ])
        expect(open.hits.map(({ first }) => first)).toEqual([
            { segmentIndex: 0, parameter: 0 },
            { segmentIndex: 2, parameter: 1 },
        ])
    })

    it('recognizes an exact shared line/arc endpoint', () => {
        const first = createPolyline(
            {
                segments: [
                    createLine({ x: -2, y: 0 }, { x: -1, y: 0 }),
                    createArc({
                        center: origin,
                        radius: 1,
                        startAngle: Math.PI,
                        sweep: -Math.PI,
                    }),
                ],
                closed: false,
            },
            { distance: 0 },
        )
        const second = createLine({ x: -1, y: -1 }, { x: -1, y: 1 })

        expect(
            intersectCurves({
                first,
                second,
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }).hits,
        ).toEqual([
            {
                point: { x: -1, y: 0 },
                first: { segmentIndex: 0, parameter: 1 },
                second: { parameter: 0.5 },
            },
        ])
    })

    it('preserves distinct visits to the same point in a self-crossing path', () => {
        const first = path([
            { x: -2, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 },
            { x: 2, y: -2 },
        ])
        const second = createLine({ x: -3, y: 0 }, { x: 3, y: 0 })
        const hits = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        }).hits

        expect(hits.map(({ first }) => first)).toEqual([
            { segmentIndex: 0, parameter: 0.5 },
            { segmentIndex: 2, parameter: 0.5 },
        ])
        expect(hits.map(({ point }) => point)).toEqual([origin, origin])
    })

    it('preserves admitted gaps without inventing connecting segments', () => {
        const first = createPolyline(
            {
                segments: [
                    createLine({ x: -1, y: -1 }, origin),
                    createLine({ x: 0.125, y: 0 }, { x: 1, y: -1 }),
                ],
                closed: false,
            },
            { distance: 0.125 },
        )
        const second = createLine({ x: -1, y: 0 }, { x: 1, y: 0 })
        const hits = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        }).hits

        expect(hits.map(({ point }) => point)).toEqual([
            origin,
            { x: 0.125, y: 0 },
        ])
        expect(hits.map(({ first }) => first)).toEqual([
            { segmentIndex: 0, parameter: 1 },
            { segmentIndex: 1, parameter: 0 },
        ])
        expect(
            intersectCurves({
                first,
                second: createLine({ x: 0.0625, y: -1 }, { x: 0.0625, y: 1 }),
                modelTolerance: { distance: 0 },
                angularTolerance: 0,
            }).hits,
        ).toEqual([])
    })

    it('keeps two roots even when their points and both parameters are identical', () => {
        const x = 1e12
        const first = path([
            { x: x - 1, y: Number.MIN_VALUE },
            { x: x + 1, y: Number.MIN_VALUE },
        ])
        const second = createCircle({ x, y: 1 }, 1)
        const hits = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        }).hits

        expect(hits).toHaveLength(2)
        expect(hits[0]).toEqual(hits[1])
        expect(hits[0]).toEqual({
            point: { x, y: Number.MIN_VALUE },
            first: { segmentIndex: 0, parameter: 0.5 },
            second: { parameter: -0.25 },
        })
    })

    it('merges the true shared vertex while retaining an interior root rounded onto it', () => {
        const x = 1e12
        const first = path([
            { x: x - 1, y: Number.MIN_VALUE },
            { x, y: 0 },
            { x: x + 1, y: 0 },
        ])
        const second = createCircle({ x, y: 1 }, 1)
        const hits = intersectCurves({
            first,
            second,
            modelTolerance: { distance: 0 },
            angularTolerance: 0,
        }).hits

        expect(hits).toHaveLength(2)
        expect(hits[0]).toEqual(hits[1])
        expect(hits[0]?.first).toEqual({ segmentIndex: 0, parameter: 1 })
    })
})
