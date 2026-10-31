import { FULL_TURN, isDeltaInsideSweep } from './angle'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Circle,
    type Curve,
    type Line,
    type Polyline,
} from './curve'
import { evaluateCurve, type CurveLocation } from './evaluation'
import { copyPolylineSegments } from './polyline'
import {
    assertFiniteVector2,
    cross,
    distance,
    dot,
    normalize,
    subtract,
    type Vector2,
} from './vector'

type Primitive = Line | Circle | Arc

export interface ClosestPoint {
    readonly point: Vector2
    readonly location: CurveLocation
    readonly distance: number
}

interface CandidateInput {
    readonly query: Vector2
    readonly parameter: number
}

function candidateAt(
    curve: Primitive,
    { query, parameter }: CandidateInput,
): ClosestPoint {
    const location = { parameter }
    const { point } = evaluateCurve(curve, location)

    return { point, location, distance: distance(query, point) }
}

function closestOnLine(line: Line, query: Vector2): ClosestPoint {
    const x = line.end.x - line.start.x
    const y = line.end.y - line.start.y
    const scale = Math.max(Math.abs(x), Math.abs(y))
    const unit = { x: x / scale, y: y / scale }
    const offset = subtract(query, line.start)
    // Do not square the tiny chord or reject a projection that overflows before clamping.
    const projection =
        (offset.x * unit.x + offset.y * unit.y) / scale / dot(unit, unit)
    const parameter = Math.max(0, Math.min(1, projection))

    return candidateAt(line, { query, parameter })
}

function closestOnCircle(circle: Circle, query: Vector2): ClosestPoint {
    const offset = subtract(query, circle.center)

    if (offset.x === 0 && offset.y === 0) {
        return candidateAt(circle, { query, parameter: 0 })
    }

    const parameter = Math.atan2(offset.y, offset.x) / FULL_TURN

    return candidateAt(circle, { query, parameter })
}

function closestEndpoint(arc: Arc, query: Vector2): ClosestPoint {
    const start = candidateAt(arc, { query, parameter: 0 })
    const end = candidateAt(arc, { query, parameter: 1 })

    return end.distance < start.distance ? end : start
}

function closestOnArc(arc: Arc, query: Vector2): ClosestPoint {
    const offset = subtract(query, arc.center)

    if (offset.x === 0 && offset.y === 0) {
        return candidateAt(arc, { query, parameter: 0 })
    }

    const { tangent } = evaluateCurve(arc, { parameter: 0 })
    const sign = Math.sign(arc.sweep)
    const startUnit = { x: sign * tangent.y, y: -sign * tangent.x }
    const queryUnit = normalize(offset)
    const delta =
        sign *
        Math.atan2(cross(startUnit, queryUnit), dot(startUnit, queryUnit))
    const magnitude = Math.abs(arc.sweep)

    if (!isDeltaInsideSweep(delta, magnitude)) {
        return closestEndpoint(arc, query)
    }

    const travel = delta < 0 ? FULL_TURN + delta : delta
    const parameter = Math.max(0, Math.min(1, travel / magnitude))

    return candidateAt(arc, { query, parameter })
}

function closestOnPolyline(polyline: Polyline, query: Vector2): ClosestPoint {
    let best: ClosestPoint | undefined

    for (const [segmentIndex, segment] of copyPolylineSegments(
        polyline,
    ).entries()) {
        const candidate = closestPoint(segment, query)

        if (!best || candidate.distance < best.distance) {
            best = {
                ...candidate,
                location: { ...candidate.location, segmentIndex },
            }
        }
    }

    if (!best) {
        throw new RangeError('Cannot query an empty polyline.')
    }

    return best
}

// Parameters and points use double precision; exact ties retain the first candidate.
export function closestPoint(curve: Curve, query: Vector2): ClosestPoint {
    assertFiniteVector2(query)

    switch (curve.type) {
        case 'line':
            return closestOnLine(createLine(curve.start, curve.end), query)
        case 'circle':
            return closestOnCircle(
                createCircle(curve.center, curve.radius),
                query,
            )
        case 'arc':
            return closestOnArc(createArc(curve), query)
        case 'polyline':
            return closestOnPolyline(curve, query)

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Unsupported curve type: ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}
