import { describe, expect, it } from 'vitest'
import { createArc, createLine } from './curve'
import { intersectCurves } from './curve-intersection'
import { splitCurve } from './curve-split'
import { prepareIntersectionCurve } from './intersection-curve'
import { type IntersectionEvent } from './intersection-events'
import { mergeJointIntersections } from './intersection-joint-merge'
import { classifyJointEvent, curveJoints } from './intersection-joints'
import { createPolyline } from './polyline'

const modelTolerance = { distance: 0.125 }

describe('independent joint-merge regressions', () => {
    it('prefers the line root even when an arc root ranks closer to an exactly shared joint', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: Math.PI,
            sweep: -Math.PI,
        })
        const line = createLine({ x: 1, y: 0 }, { x: 2, y: 0 })
        const first = createPolyline(
            { segments: [arc, line], closed: false },
            modelTolerance,
        )
        const point = { x: Math.cos(0.01), y: Math.sin(0.01) }
        const delta = { x: 1.1 - point.x, y: -point.y }
        const second = createLine(
            { x: point.x - delta.x, y: point.y - delta.y },
            { x: 1.1 + delta.x, y: delta.y },
        )
        const query = { first, second, angularTolerance: 0, modelTolerance }
        const strict = intersectCurves({
            ...query,
            modelTolerance: { distance: 0 },
        }).hits
        const lineHit = strict.find((hit) => hit.first.segmentIndex === 1)!
        const arcHit = strict.find((hit) => hit.first.segmentIndex === 0)!
        const merged = intersectCurves(query).hits

        expect(Math.hypot(arcHit.point.x - 1, arcHit.point.y)).toBeLessThan(
            Math.hypot(lineHit.point.x - 1, lineHit.point.y),
        )
        expect(lineHit.first.parameter).toBeGreaterThan(0)
        expect(merged).toEqual([
            { ...lineHit, first: { segmentIndex: 0, parameter: 1 } },
        ])
        expect(
            splitCurve(first, {
                locations: [merged[0]!.first],
                modelTolerance,
            }),
        ).toEqual([
            createPolyline({ segments: [arc], closed: false }, modelTolerance),
            createPolyline({ segments: [line], closed: false }, modelTolerance),
        ])
    })

    it('uses the outgoing line endpoint as the ranking anchor without selecting a representative', () => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: Math.PI,
            sweep: -Math.PI,
        })
        const path = createPolyline(
            {
                segments: [
                    arc,
                    createLine({ x: 1.0625, y: 0 }, { x: 2, y: 0 }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const first = curveJoints(
            prepareIntersectionCurve(path, 0),
            modelTolerance,
        )
        const second = curveJoints(
            prepareIntersectionCurve(
                createLine({ x: 0, y: -1 }, { x: 0, y: 1 }),
                0,
            ),
            modelTolerance,
        )
        const event: IntersectionEvent = {
            firstPart: 0,
            secondPart: 0,
            firstEndpoint: false,
            secondEndpoint: false,
            hit: {
                point: { x: 1.09375, y: 0 },
                first: { segmentIndex: 0, parameter: 0.99 },
                second: { parameter: 0.5 },
            },
        }
        const candidate = classifyJointEvent(event, { first, second })

        expect(candidate.firstJoint!.point).toEqual({ x: 1.0625, y: 0 })
        expect(candidate.distanceScore).toBe(0.03125)
    })

    it('needs a shared counterpart part to connect two joint events', () => {
        const path = createPolyline(
            {
                segments: [
                    createLine({ x: -1, y: 0 }, { x: 0, y: 0 }),
                    createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const first = prepareIntersectionCurve(path, 0)
        const event = (
            firstPart: number,
            secondPart: number,
        ): IntersectionEvent => ({
            firstPart,
            secondPart,
            firstEndpoint: false,
            secondEndpoint: false,
            hit: {
                point: { x: 0, y: 0 },
                first: {
                    segmentIndex: firstPart,
                    parameter: firstPart === 0 ? 0.99 : 0.01,
                },
                second: {
                    segmentIndex: secondPart,
                    parameter: secondPart === 0 ? 0.99 : 0.01,
                },
            },
        })
        const diagonal = [event(0, 0), event(1, 1)]

        const disconnected = mergeJointIntersections(
            { first, second: first, events: diagonal },
            modelTolerance,
        )

        expect(disconnected).toHaveLength(2)
        expect(disconnected).toEqual(expect.arrayContaining(diagonal))

        const connected = mergeJointIntersections(
            { first, second: first, events: [...diagonal, event(0, 1)] },
            modelTolerance,
        )

        expect(connected).toHaveLength(1)
        expect(connected[0]!.hit.first).toEqual({
            segmentIndex: 0,
            parameter: 1,
        })
        expect(connected[0]!.hit.second).toEqual({
            segmentIndex: 0,
            parameter: 1,
        })
        expect(connected[0]!.sourcePairs).toHaveLength(3)
    })
})
