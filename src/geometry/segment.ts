import { FULL_TURN } from './angle'
import { createArc, createLine, type Arc, type PolylineSegment } from './curve'
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

    const start =
        cardinalPoint(copy, copy.startAngle) ??
        createVector2(
            copy.center.x + copy.radius * Math.cos(copy.startAngle),
            copy.center.y + copy.radius * Math.sin(copy.startAngle),
        )
    const rotation =
        Math.abs(copy.sweep) > Math.PI
            ? copy.sweep - Math.sign(copy.sweep) * FULL_TURN
            : copy.sweep
    // At this scale the cubic correction is below double precision.
    const chord =
        Math.abs(rotation) < 1e-8
            ? copy.radius * rotation
            : 2 * copy.radius * Math.sin(rotation / 2)
    const midpointAngle = copy.startAngle + rotation / 2
    const endAngle = copy.startAngle + rotation
    const addedRotation = endAngle - copy.startAngle
    // TwoSum detects a tiny rotation lost when adding it to the start angle.
    const error =
        copy.startAngle -
        (endAngle - addedRotation) +
        (rotation - addedRotation)
    const cardinalEnd = error === 0 ? cardinalPoint(copy, endAngle) : undefined
    const end =
        cardinalEnd ??
        createVector2(
            start.x - chord * Math.sin(midpointAngle),
            start.y + chord * Math.cos(midpointAngle),
        )

    return { start, end }
}

function cardinalPoint(arc: Arc, angle: number): Vector2 | undefined {
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
            return createVector2(
                arc.center.x + axis.x * arc.radius,
                arc.center.y + axis.y * arc.radius,
            )
        }
    }

    return undefined
}
