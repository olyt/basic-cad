import { type Arc } from './curve'
import { type IntersectionCurve } from './intersection-curve'
import {
    curveJoints,
    jointAtPoint,
    type JointCurve,
} from './intersection-joints'
import { type ParameterLocation } from './intersection-location'
import { type CircularRoot } from './intersection-part'
import { circularEvaluation } from './segment'
import { type ModelTolerance } from './tolerance'
import { type Vector2 } from './vector'

function endpointDistance(
    arc: Arc,
    input: { readonly direction: Vector2; readonly parameter: number },
): number {
    const { tangent } = circularEvaluation(arc, input.parameter)
    const sign = Math.sign(arc.sweep)

    return (
        arc.radius *
        Math.hypot(
            input.direction.x - sign * tangent.y,
            input.direction.y + sign * tangent.x,
        )
    )
}

function locateJointRoot(
    input: {
        readonly joints: JointCurve
        readonly index: number
        readonly arc: Arc
    },
    root: CircularRoot,
): ParameterLocation | undefined {
    const { joints, index, arc } = input
    const joint = jointAtPoint(joints, { part: index, point: root.point })

    if (!joint) {
        return undefined
    }

    const nearStart =
        endpointDistance(arc, { direction: root.direction, parameter: 0 }) <=
        joints.tolerance.distance
    const nearEnd =
        endpointDistance(arc, { direction: root.direction, parameter: 1 }) <=
        joints.tolerance.distance

    if (nearStart === nearEnd) {
        return undefined
    }

    const atStartJoint = joint.right === index && nearStart
    const atEndJoint = joint.left === index && nearEnd

    return atStartJoint || atEndJoint
        ? { parameter: atStartJoint ? 0 : 1 }
        : undefined
}

export function admitJointArcRoots(
    curve: IntersectionCurve,
    tolerance: ModelTolerance,
): IntersectionCurve {
    if (!curve.polyline || tolerance.distance === 0) {
        return curve
    }

    const joints = curveJoints(curve, tolerance)
    const parts = curve.parts.map((part, index) => {
        const arc = part.curve

        if (arc.type !== 'arc' || joints.byPart[index]!.length === 0) {
            return part
        }

        return {
            ...part,
            locateJointRoot: (root: CircularRoot) =>
                locateJointRoot({ joints, index, arc }, root),
        }
    })

    return { ...curve, parts }
}
