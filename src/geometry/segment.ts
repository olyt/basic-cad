import { FULL_TURN } from './angle'
import {
    createArc,
    createLine,
    type ArcInput,
    type PolylineSegment,
} from './curve'
import { createVector2, type Vector2 } from './vector'

export function copySegment(segment: PolylineSegment): PolylineSegment {
    switch (segment.type) {
        case 'line':
            return createLine(segment.start, segment.end)
        case 'arc':
            return createArc({
                center: segment.center,
                radius: segment.radius,
                startAngle: segment.startAngle,
                sweep: segment.sweep,
            })

        default: {
            const unsupported: never = segment

            throw new RangeError(
                `Polyline segments must be lines or arcs, not ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}

export function segmentEndpoints(segment: PolylineSegment): {
    start: Vector2
    end: Vector2
} {
    const copy = copySegment(segment)

    if (copy.type === 'line') {
        return { start: copy.start, end: copy.end }
    }

    return {
        start: circularEvaluation(copy, 0).point,
        end: circularEvaluation(copy, 1).point,
    }
}

export function circularEvaluation(
    traversal: ArcInput,
    parameter: number,
): {
    point: Vector2
    tangent: Vector2
} {
    const startDirection =
        cardinalDirection(traversal.startAngle) ??
        createVector2(
            Math.cos(traversal.startAngle),
            Math.sin(traversal.startAngle),
        )
    const start = pointForDirection(traversal, startDirection)
    const rawRotation = traversal.sweep * parameter
    const rotation =
        Math.abs(rawRotation) > Math.PI
            ? rawRotation - Math.sign(rawRotation) * FULL_TURN
            : rawRotation
    // At this scale the cubic correction is below double precision.
    let chord = 2 * traversal.radius * Math.sin(rotation / 2)

    if (Math.abs(rotation) < 1e-8) {
        chord =
            rotation === rawRotation
                ? traversal.radius * traversal.sweep * parameter
                : traversal.radius * rotation
    }

    const midpointDirection = rotate(startDirection, rotation / 2)
    const endAngle = traversal.startAngle + rotation
    const addedRotation = endAngle - traversal.startAngle
    // TwoSum detects a tiny rotation lost when adding it to the start angle.
    const error =
        traversal.startAngle -
        (endAngle - addedRotation) +
        (rotation - addedRotation)
    const rotationRepresented = rotation !== 0 || chord === 0
    const cardinalEnd =
        error === 0 && rotationRepresented
            ? cardinalDirection(endAngle)
            : undefined
    const point = cardinalEnd
        ? pointForDirection(traversal, cardinalEnd)
        : createVector2(
              start.x - chord * midpointDirection.y,
              start.y + chord * midpointDirection.x,
          )
    const direction = cardinalEnd ?? rotate(startDirection, rotation)
    const sign = Math.sign(traversal.sweep)

    return {
        point,
        tangent: createVector2(-direction.y * sign, direction.x * sign),
    }
}

function rotate(direction: Vector2, rotation: number): Vector2 {
    const sine = Math.sin(rotation)
    const cosine = Math.cos(rotation)

    return createVector2(
        direction.x * cosine - direction.y * sine,
        direction.y * cosine + direction.x * sine,
    )
}

function pointForDirection(traversal: ArcInput, direction: Vector2): Vector2 {
    return createVector2(
        traversal.center.x + direction.x * traversal.radius,
        traversal.center.y + direction.y * traversal.radius,
    )
}

function cardinalDirection(angle: number): Vector2 | undefined {
    // Match the original sum, avoiding any rounding during angle normalization.
    const axes = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
    ]

    for (const [index, axis] of axes.entries()) {
        const cardinal = (index * Math.PI) / 2

        if (
            [cardinal, cardinal - FULL_TURN, cardinal + FULL_TURN].includes(
                angle,
            )
        ) {
            return axis
        }
    }

    return undefined
}
