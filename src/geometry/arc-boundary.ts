import { isDeltaInsideSweep } from './angle'
import { createArc, createCircle, type Arc, type Circle } from './curve'
import { circularEvaluation } from './segment'
import { cross, dot, type Vector2 } from './vector'

export interface ArcQuery {
    readonly arc: Arc
    // Radians; zero admits no angular expansion.
    readonly angularTolerance: number
}

export interface ArcBoundary {
    readonly circle: Circle
    // Intersection engines supply a normalized local direction.
    containsDirection(direction: Vector2): boolean
}

interface SweepBoundary {
    readonly start: Vector2
    readonly end: Vector2
    readonly sweep: number
    readonly angularTolerance: number
}

function rayAngle(first: Vector2, second: Vector2): number {
    return Math.atan2(cross(first, second), dot(first, second))
}

function containsDirection(
    boundary: SweepBoundary,
    direction: Vector2,
): boolean {
    const delta = rayAngle(boundary.start, direction)
    const endDistance = Math.abs(rayAngle(boundary.end, direction))
    const atEndpoint =
        Math.abs(delta) <= boundary.angularTolerance ||
        endDistance <= boundary.angularTolerance

    return (
        atEndpoint ||
        isDeltaInsideSweep(
            Math.sign(boundary.sweep) * delta,
            Math.abs(boundary.sweep),
        )
    )
}

function endpointDirection(arc: Arc, parameter: number): Vector2 {
    const { tangent } = circularEvaluation(arc, parameter)
    const sign = Math.sign(arc.sweep)

    return { x: sign * tangent.y, y: -sign * tangent.x }
}

export function createArcBoundary({
    arc,
    angularTolerance,
}: ArcQuery): ArcBoundary {
    if (!Number.isFinite(angularTolerance) || angularTolerance < 0) {
        throw new RangeError(
            'Angular tolerance must be finite and nonnegative.',
        )
    }

    const checked = createArc(arc)
    const boundary = {
        start: endpointDirection(checked, 0),
        end: endpointDirection(checked, 1),
        sweep: checked.sweep,
        angularTolerance,
    }

    return {
        circle: createCircle(checked.center, checked.radius),
        containsDirection: (direction) =>
            containsDirection(boundary, direction),
    }
}
