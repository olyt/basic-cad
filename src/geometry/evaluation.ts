import { FULL_TURN } from './angle'
import {
    createCircle,
    type Curve,
    type Polyline,
    type PolylineSegment,
} from './curve'
import { circularEvaluation, copySegment } from './segment'
import { copyPolylineSegments } from './polyline'
import { createVector2, normalize, type Vector2 } from './vector'

export interface CurveLocation {
    // Normalized [0, 1] on segments; signed periodic turns on circles.
    readonly parameter: number
    // Required on polylines and absent on primitives.
    readonly segmentIndex?: number
}

export interface CurveEvaluation {
    readonly point: Vector2
    readonly tangent: Vector2
}

function assertFiniteParameter(parameter: number): void {
    if (!Number.isFinite(parameter)) {
        throw new RangeError('Curve parameter must be finite.')
    }
}

function assertUnitParameter(parameter: number): void {
    assertFiniteParameter(parameter)

    if (parameter < 0 || parameter > 1) {
        throw new RangeError('Segment parameter must be within [0, 1].')
    }
}

function polylineSegment(
    polyline: Polyline,
    index: number | undefined,
): PolylineSegment {
    if (!Number.isInteger(index) || index === undefined) {
        throw new RangeError(
            'A polyline location needs an integer segment index.',
        )
    }

    const segment = copyPolylineSegments(polyline)[index]

    if (index < 0 || !segment) {
        throw new RangeError('Polyline segment index is out of range.')
    }

    return segment
}

// Polyline parameters are local to an explicitly chosen segment; admitted gaps
// remain gaps. Circle parameters are signed periodic turns from the +X axis.
export function evaluateCurve(
    curve: Curve,
    location: CurveLocation,
): CurveEvaluation {
    const { parameter, segmentIndex } = location

    if (curve.type === 'polyline') {
        return evaluateCurve(polylineSegment(curve, segmentIndex), {
            parameter,
        })
    }

    if ('segmentIndex' in location) {
        throw new RangeError('Primitive locations cannot have a segment index.')
    }

    assertFiniteParameter(parameter)

    if (curve.type === 'circle') {
        const circle = createCircle(curve.center, curve.radius)

        return circularEvaluation(
            { ...circle, startAngle: 0, sweep: FULL_TURN },
            parameter % 1,
        )
    }

    assertUnitParameter(parameter)

    const segment = copySegment(curve)

    if (segment.type === 'arc') {
        return circularEvaluation(segment, parameter)
    }

    const x = segment.end.x - segment.start.x
    const y = segment.end.y - segment.start.y

    const point =
        parameter <= 0.5
            ? createVector2(
                  segment.start.x + x * parameter,
                  segment.start.y + y * parameter,
              )
            : createVector2(
                  segment.end.x - x * (1 - parameter),
                  segment.end.y - y * (1 - parameter),
              )

    return {
        point,
        tangent: normalize({ x, y }),
    }
}
