import { describe, expect, it } from 'vitest'
import { createArc, createCircle, createLine, type Polyline } from './curve'
import { intersectCurves } from './curve-intersection'
import { createPolyline } from './polyline'
import { type ModelTolerance } from './tolerance'

const modelTolerance = { distance: 0.125 }
const probe = createLine({ x: -2, y: -2 }, { x: 2, y: 2 })

function path(
    points: readonly { x: number; y: number }[],
    closed = false,
): Polyline {
    return createPolyline(
        {
            segments: points
                .slice(1)
                .map((end, index) => createLine(points[index]!, end)),
            closed,
        },
        modelTolerance,
    )
}

describe('model tolerance at polyline joints', () => {
    it('merges line/arc joint hits and retains the exact line hit and far crossing', () => {
        const first = createPolyline(
            {
                segments: [
                    createLine({ x: -1, y: 0 }, { x: 0, y: 0 }),
                    createArc({
                        center: { x: 1.05, y: 0 },
                        radius: 1,
                        startAngle: Math.PI,
                        sweep: -Math.PI,
                    }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const query = {
            first,
            second: probe,
            angularTolerance: 0,
            modelTolerance,
        }
        const strict = intersectCurves({
            ...query,
            modelTolerance: { distance: 0 },
        })
        const result = intersectCurves(query)
        const near = (point: { x: number; y: number }) =>
            Math.hypot(point.x, point.y) <= modelTolerance.distance

        expect(strict.hits.filter(({ point }) => near(point))).toHaveLength(2)
        expect(result.hits.filter(({ point }) => near(point))).toEqual([
            strict.hits.find(({ first }) => first.segmentIndex === 0),
        ])
        expect(result.hits.filter(({ point }) => !near(point))).toStrictEqual(
            strict.hits.filter(({ point }) => !near(point)),
        )
        expect(
            intersectCurves({
                ...query,
                second: createLine({ x: 0.025, y: -1 }, { x: 0.025, y: 1 }),
            }).hits,
        ).toEqual([])
    })

    it('handles non-shared arc/arc joints and the closed seam', () => {
        const first = createPolyline(
            {
                segments: [
                    createArc({
                        center: { x: 0, y: -1 },
                        radius: 1,
                        startAngle: Math.PI,
                        sweep: -Math.PI / 2,
                    }),
                    createArc({
                        center: { x: 0.05, y: 1 },
                        radius: 1,
                        startAngle: (3 * Math.PI) / 2,
                        sweep: -Math.PI / 2,
                    }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const arcHits = intersectCurves({
            first,
            second: probe,
            angularTolerance: 0,
            modelTolerance,
        }).hits

        expect(
            arcHits.filter(({ point }) => Math.hypot(point.x, point.y) < 0.125),
        ).toEqual([
            {
                point: { x: 0, y: 0 },
                first: { segmentIndex: 0, parameter: 1 },
                second: { parameter: 0.5 },
            },
        ])

        const closed = path(
            [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: -1, y: 2 },
                { x: 0.05, y: 0 },
            ],
            true,
        )
        const seamHits = intersectCurves({
            first: closed,
            second: probe,
            angularTolerance: 0,
            modelTolerance,
        }).hits

        expect(
            seamHits.filter(
                ({ point }) => Math.hypot(point.x, point.y) < 0.125,
            ),
        ).toEqual([
            {
                point: { x: 0, y: 0 },
                first: { segmentIndex: 0, parameter: 0 },
                second: { parameter: 0.5 },
            },
        ])
    })

    it('merges only against the same counterpart part and does not snap that part to its nearby joint', () => {
        const first = path([
            { x: -1, y: 2 },
            { x: 0, y: 0 },
            { x: 1, y: 2 },
        ])
        const second = path([
            { x: -2, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 },
            { x: 2, y: -2 },
        ])
        const hits = intersectCurves({
            first,
            second,
            angularTolerance: 0,
            modelTolerance,
        }).hits.filter(({ point }) => point.x === 0 && point.y === 0)

        expect(hits).toHaveLength(2)
        expect(hits.map(({ second }) => second.segmentIndex)).toEqual([0, 2])

        const nearbyJoint = path([
            { x: -2, y: 0 },
            { x: 0.05, y: 0 },
            { x: 2, y: 0 },
        ])
        const result = intersectCurves({
            first,
            second: nearbyJoint,
            angularTolerance: 0,
            modelTolerance,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.hits[0]!.second.parameter).toBeLessThan(1)
    })

    it('retains another root from a primitive pair after merging its shared vertex hit', () => {
        const x = 1e12
        const first = path([
            { x: x - 1, y: Number.MIN_VALUE },
            { x, y: 0 },
            { x: x + 1, y: 0 },
        ])
        const second = createCircle({ x, y: 1 }, 1)

        expect(
            intersectCurves({
                first,
                second,
                angularTolerance: 0,
                modelTolerance: { distance: 1e-7 },
            }).hits,
        ).toHaveLength(2)

        const singlePart = path([
            { x: x - 1, y: Number.MIN_VALUE },
            { x: x + 1, y: Number.MIN_VALUE },
        ])
        const query = {
            first: singlePart,
            second,
            angularTolerance: 0,
            modelTolerance: { distance: 1e-7 },
        }

        expect(intersectCurves(query)).toStrictEqual(
            intersectCurves({ ...query, modelTolerance: { distance: 0 } }),
        )
        expect(intersectCurves(query).hits).toHaveLength(2)
    })

    it.each([-1, NaN, Infinity, undefined])(
        'requires valid model tolerance even without polylines: %s',
        (distance) => {
            const first = createLine({ x: 0, y: 0 }, { x: 1, y: 0 })

            expect(() =>
                intersectCurves({
                    first,
                    second: first,
                    angularTolerance: 0,
                    modelTolerance: { distance } as ModelTolerance,
                }),
            ).toThrow(RangeError)
        },
    )
})
