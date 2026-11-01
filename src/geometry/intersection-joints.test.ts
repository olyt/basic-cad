import { describe, expect, it } from 'vitest'
import { createLine, type Polyline } from './curve'
import { prepareIntersectionCurve } from './intersection-curve'
import {
    uniqueIntersections,
    type IntersectionEvent,
} from './intersection-events'
import { classifyJointEvent, curveJoints } from './intersection-joints'

describe('joint neighborhoods', () => {
    it('keeps another source root when a line representative replaces a merged event', () => {
        const hit = {
            point: { x: 0, y: 0 },
            first: { segmentIndex: 0, parameter: 1 },
            second: { parameter: 0.5 },
        }
        const merged: IntersectionEvent = {
            hit,
            firstPart: 1,
            secondPart: 0,
            firstEndpoint: true,
            secondEndpoint: false,
            sourcePairs: ['0:0', '1:0'],
        }
        const remaining: IntersectionEvent = {
            hit,
            firstPart: 0,
            secondPart: 0,
            firstEndpoint: true,
            secondEndpoint: false,
        }

        expect(uniqueIntersections([merged, remaining])).toHaveLength(2)
    })

    it('uses the inclusive admission tolerance to identify a joint', () => {
        const curve: Polyline = {
            type: 'polyline',
            closed: false,
            segments: [
                createLine({ x: -1, y: 0 }, { x: 0, y: 0 }),
                createLine({ x: 0.125, y: 0 }, { x: 1, y: 0 }),
            ],
        }
        const prepared = prepareIntersectionCurve(curve, 0)

        expect(
            curveJoints(prepared, { distance: 0.125 }).byPart.map(
                (joints) => joints.length,
            ),
        ).toEqual([1, 1])
        expect(
            curveJoints(prepared, { distance: 0.0625 }).byPart.map(
                (joints) => joints.length,
            ),
        ).toEqual([0, 0])
    })

    it('does not choose arbitrarily when a hit is near two different joints', () => {
        const curve: Polyline = {
            type: 'polyline',
            closed: false,
            segments: [
                createLine({ x: -1, y: 0 }, { x: 0, y: 0 }),
                createLine({ x: 0, y: 0 }, { x: 0.05, y: 0 }),
                createLine({ x: 0.05, y: 0 }, { x: 1, y: 0 }),
            ],
        }
        const tolerance = { distance: 0.125 }
        const first = curveJoints(prepareIntersectionCurve(curve, 0), tolerance)
        const second = curveJoints(
            prepareIntersectionCurve(
                createLine({ x: 0.025, y: -1 }, { x: 0.025, y: 1 }),
                0,
            ),
            tolerance,
        )
        const event: IntersectionEvent = {
            firstPart: 1,
            secondPart: 0,
            firstEndpoint: false,
            secondEndpoint: false,
            hit: {
                point: { x: 0.025, y: 0 },
                first: { segmentIndex: 1, parameter: 0.5 },
                second: { parameter: 0.5 },
            },
        }

        expect(first.byPart[1]).toHaveLength(2)
        expect(
            classifyJointEvent(event, { first, second }).firstJoint,
        ).toBeUndefined()
    })
})
