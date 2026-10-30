import { FULL_TURN } from './angle'
import { createArc, createCircle, type Arc } from './curve'
import { lineCircleIntersections } from './line-circle-intersection'
import { type LineOperand } from './line-intersection'
import { circularEvaluation } from './segment'
import { cross, dot, type Vector2 } from './vector'

export interface LineArcInput {
    readonly arc: Arc
    // Radians; zero admits no angular expansion.
    readonly angularTolerance: number
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

function isInsideSweep(delta: number, magnitude: number): boolean {
    if (magnitude <= Math.PI) {
        return delta >= 0 && delta <= magnitude
    }

    // Preserve the tiny excluded gap without adding a full turn to delta.
    return delta >= 0 || -delta >= FULL_TURN - magnitude
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
        isInsideSweep(
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

export function intersectLineArc(
    operand: LineOperand,
    { arc, angularTolerance }: LineArcInput,
): readonly Vector2[] {
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
    const circle = createCircle(checked.center, checked.radius)

    return lineCircleIntersections(operand, circle)
        .filter(({ direction }) => containsDirection(boundary, direction))
        .map(({ point }) => point)
}
