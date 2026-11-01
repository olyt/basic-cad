import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createArc, createLine } from './curve'
import { intersectCurves } from './curve-intersection'
import { splitCurve } from './curve-split'
import { prepareIntersectionCurve } from './intersection-curve'
import { directionLocation } from './intersection-part'
import { admitJointArcRoots } from './joint-root-admission'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

const modelTolerance = { distance: 1e-7 }

describe('supporting-circle roots near admitted joints', () => {
    it.each([-1, 1])(
        'admits an actual root outside angular allowance at a joint, direction %s',
        (sign) => {
            const arc = createArc({
                center: { x: 0, y: 0 },
                radius: 1,
                startAngle: 0.7,
                sweep: sign,
            })
            const { start, end } = segmentEndpoints(arc)
            const line = createLine(
                { x: start.x - sign, y: start.y },
                { x: start.x - sign * 1e-11, y: start.y },
            )
            const first = createPolyline(
                { segments: [line, arc], closed: false },
                modelTolerance,
            )
            const angle = 0.7 - sign * 1e-8
            const second = createLine(
                { x: 0, y: 0 },
                { x: 2 * Math.cos(angle), y: 2 * Math.sin(angle) },
            )
            const query = {
                first,
                second,
                angularTolerance: 1e-10,
                modelTolerance,
            }
            const { hits } = intersectCurves(query)

            expect(
                intersectCurves({ ...query, modelTolerance: { distance: 0 } })
                    .hits,
            ).toEqual([])
            expect(intersectCurves({ ...query, first: arc }).hits).toEqual([])
            expect(hits).toHaveLength(1)
            expect(hits[0]!.first).toEqual({ segmentIndex: 0, parameter: 1 })
            expect(
                Math.hypot(
                    hits[0]!.point.x - start.x,
                    hits[0]!.point.y - start.y,
                ),
            ).toBeLessThan(modelTolerance.distance)
            expect(
                splitCurve(first, {
                    locations: hits.map((hit) => hit.first),
                    modelTolerance,
                }),
            ).toHaveLength(2)
            expect(
                intersectCurves({
                    ...query,
                    modelTolerance: { distance: 1e-9 },
                }).hits,
            ).toEqual([])

            const reversed = intersectCurves({
                ...query,
                first: second,
                second: first,
            }).hits

            expect(reversed).toEqual(
                hits.map((hit) => ({
                    point: hit.point,
                    first: hit.second,
                    second: hit.first,
                })),
            )

            const closed = createPolyline(
                {
                    segments: [arc, createLine(end, line.start), line],
                    closed: true,
                },
                modelTolerance,
            )
            const seamHits = intersectCurves({
                ...query,
                first: closed,
            }).hits.filter(
                ({ point }) =>
                    Math.hypot(point.x - start.x, point.y - start.y) <
                    modelTolerance.distance,
            )

            expect(seamHits).toHaveLength(1)
            expect(seamHits[0]!.first).toEqual({
                segmentIndex: 0,
                parameter: 0,
            })
        },
    )

    it('does not extend finite operands to create a joint hit', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0.7,
            sweep: 1,
        })
        const { start } = segmentEndpoints(arc)
        const first = createPolyline(
            {
                segments: [
                    createLine({ x: start.x - 1, y: start.y }, start),
                    arc,
                ],
                closed: false,
            },
            modelTolerance,
        )
        const angle = 0.7 - 1e-8
        const second = createLine(
            { x: 0, y: 0 },
            { x: 0.5 * Math.cos(angle), y: 0.5 * Math.sin(angle) },
        )

        expect(
            intersectCurves({
                first,
                second,
                angularTolerance: 0,
                modelTolerance,
            }).hits,
        ).toEqual([])
    })

    it('keeps an excluded ray ambiguous when both arc ends are within model distance', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0,
            sweep: FULL_TURN - 1e-9,
        })
        const first = createPolyline(
            {
                segments: [createLine({ x: 2, y: 0 }, { x: 1, y: 0 }), arc],
                closed: false,
            },
            modelTolerance,
        )
        const second = createLine({ x: 0, y: 0 }, { x: 2, y: -1e-9 })

        expect(
            intersectCurves({
                first,
                second,
                angularTolerance: 0,
                modelTolerance,
            }).hits,
        ).toEqual([])
    })

    it('checks local direction when world-coordinate rounding hides the root separation', () => {
        const arc = createArc({
            center: { x: 1e14, y: 1e14 },
            radius: 1,
            startAngle: Math.PI / 4 + 0.001,
            sweep: 1,
        })
        const { start } = segmentEndpoints(arc)
        const path = createPolyline(
            {
                segments: [
                    createLine({ x: start.x - 1, y: start.y }, start),
                    arc,
                ],
                closed: false,
            },
            modelTolerance,
        )
        const prepared = admitJointArcRoots(
            prepareIntersectionCurve(path, 0),
            modelTolerance,
        )

        expect(
            directionLocation(prepared.parts[1]!, {
                point: start,
                direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
            }),
        ).toBeUndefined()
    })
})
