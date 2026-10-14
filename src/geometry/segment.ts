import { FULL_TURN } from './angle'
import { createArc, createLine, type PolylineSegment } from './curve'
import { createVector2, type Vector2 } from './vector'

export function copySegment(segment: PolylineSegment): PolylineSegment {
    switch (segment.type) {
        case 'line':
            return createLine(segment.start, segment.end)
        case 'arc':
            return createArc(
                segment.center,
                segment.radius,
                segment.startAngle,
                segment.sweep,
            )
        default:
            throw new RangeError('Polyline segments must be lines or arcs.')
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

    const start = createVector2(
        copy.center.x + copy.radius * Math.cos(copy.startAngle),
        copy.center.y + copy.radius * Math.sin(copy.startAngle),
    )
    const rotation =
        Math.abs(copy.sweep) > Math.PI
            ? copy.sweep - Math.sign(copy.sweep) * FULL_TURN
            : copy.sweep
    const chord = 2 * copy.radius * Math.sin(rotation / 2)
    const midpointAngle = copy.startAngle + rotation / 2
    const end = createVector2(
        start.x - chord * Math.sin(midpointAngle),
        start.y + chord * Math.cos(midpointAngle),
    )

    return { start, end }
}
