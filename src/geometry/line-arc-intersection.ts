import { createArcBoundary, type ArcQuery } from './arc-boundary'
import { lineCircleIntersections } from './line-circle-intersection'
import { type LineOperand } from './line-intersection'
import { type Vector2 } from './vector'

export type LineArcInput = ArcQuery

export function intersectLineArc(
    operand: LineOperand,
    input: LineArcInput,
): readonly Vector2[] {
    const boundary = createArcBoundary(input)

    return lineCircleIntersections(operand, boundary.circle)
        .filter(({ direction }) => boundary.containsDirection(direction))
        .map(({ point }) => point)
}
