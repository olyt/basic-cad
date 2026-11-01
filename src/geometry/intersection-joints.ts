import { type CurveLocation } from './evaluation'
import { type IntersectionCurve } from './intersection-curve'
import { type IntersectionEvent } from './intersection-events'
import { pointsCoincide, type ModelTolerance } from './tolerance'
import { type Vector2 } from './vector'

export interface IntersectionJoint {
    readonly index: number
    readonly left: number
    readonly right: number
    readonly point: Vector2
    readonly location: CurveLocation
}

export interface JointCurve {
    readonly curve: IntersectionCurve
    readonly byPart: readonly (readonly IntersectionJoint[])[]
    readonly tolerance: ModelTolerance
}

export interface JointEvent {
    readonly event: IntersectionEvent
    readonly firstJoint: IntersectionJoint | undefined
    readonly secondJoint: IntersectionJoint | undefined
    readonly endpointScore: number
    readonly distanceScore: number
    readonly lineScore: number
}

function makeJoint(
    curve: IntersectionCurve,
    input: { readonly left: number; readonly tolerance: ModelTolerance },
): IntersectionJoint | undefined {
    const left = input.left
    const right = (left + 1) % curve.parts.length
    const a = curve.parts[left]!
    const b = curve.parts[right]!
    const end = a.endpoints!.end
    const start = b.endpoints!.start

    if (!pointsCoincide(end, start, input.tolerance)) {
        return undefined
    }

    const point =
        b.curve.type === 'line' && a.curve.type !== 'line' ? start : end
    const location =
        right === 0
            ? { segmentIndex: 0, parameter: 0 }
            : { segmentIndex: left, parameter: 1 }

    return { index: left, left, right, point, location }
}

export function curveJoints(
    curve: IntersectionCurve,
    tolerance: ModelTolerance,
): JointCurve {
    const byPart: IntersectionJoint[][] = curve.parts.map(() => [])

    if (!curve.polyline) {
        return { curve, byPart, tolerance }
    }

    const count = curve.closed ? curve.parts.length : curve.parts.length - 1

    for (let left = 0; left < count; left++) {
        const joint = makeJoint(curve, { left, tolerance })

        if (joint) {
            byPart[left]!.push(joint)
            byPart[joint.right]!.push(joint)
        }
    }

    return { curve, byPart, tolerance }
}

export function jointAtPoint(
    curve: JointCurve,
    input: { readonly part: number; readonly point: Vector2 },
): IntersectionJoint | undefined {
    const candidates = curve.byPart[input.part]!.filter((joint) => {
        const end = curve.curve.parts[joint.left]!.endpoints!.end
        const start = curve.curve.parts[joint.right]!.endpoints!.start

        return (
            pointsCoincide(input.point, end, curve.tolerance) &&
            pointsCoincide(input.point, start, curve.tolerance)
        )
    })

    return candidates.length === 1 ? candidates[0] : undefined
}

function jointDistance(
    point: Vector2,
    joint: IntersectionJoint | undefined,
): number {
    return joint
        ? Math.hypot(point.x - joint.point.x, point.y - joint.point.y)
        : 0
}

export function classifyJointEvent(
    event: IntersectionEvent,
    curves: { readonly first: JointCurve; readonly second: JointCurve },
): JointEvent {
    const firstJoint = jointAtPoint(curves.first, {
        part: event.firstPart,
        point: event.hit.point,
    })
    const secondJoint = jointAtPoint(curves.second, {
        part: event.secondPart,
        point: event.hit.point,
    })
    const firstEndpoint = firstJoint !== undefined && event.firstEndpoint
    const secondEndpoint = secondJoint !== undefined && event.secondEndpoint

    return {
        event,
        firstJoint,
        secondJoint,
        endpointScore: Number(firstEndpoint) + Number(secondEndpoint),
        distanceScore:
            jointDistance(event.hit.point, firstJoint) +
            jointDistance(event.hit.point, secondJoint),
        lineScore:
            Number(
                curves.first.curve.parts[event.firstPart]!.curve.type ===
                    'line',
            ) +
            Number(
                curves.second.curve.parts[event.secondPart]!.curve.type ===
                    'line',
            ),
    }
}

export function jointEventKey(candidate: JointEvent): string {
    const first = candidate.firstJoint
        ? `joint:${candidate.firstJoint.index}`
        : `part:${candidate.event.firstPart}`
    const second = candidate.secondJoint
        ? `joint:${candidate.secondJoint.index}`
        : `part:${candidate.event.secondPart}`

    return `${first}/${second}`
}
