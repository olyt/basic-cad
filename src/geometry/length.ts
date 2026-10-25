import { FULL_TURN } from './angle'
import { createCircle, type Curve } from './curve'
import { copyPolylineSegments } from './polyline'
import { copySegment } from './segment'

function positiveLength(length: number): number {
    if (!Number.isFinite(length) || length <= 0) {
        throw new RangeError(
            'Curve length is outside the positive finite range.',
        )
    }

    return length
}

export function curveLength(curve: Curve): number {
    if (curve.type === 'polyline') {
        const total = copyPolylineSegments(curve).reduce(
            (sum, segment) => sum + curveLength(segment),
            0,
        )

        return positiveLength(total)
    }

    if (curve.type === 'circle') {
        const circle = createCircle(curve.center, curve.radius)

        return positiveLength(circle.radius * FULL_TURN)
    }

    const segment = copySegment(curve)

    if (segment.type === 'arc') {
        return positiveLength(segment.radius * Math.abs(segment.sweep))
    }

    return positiveLength(
        Math.hypot(
            segment.end.x - segment.start.x,
            segment.end.y - segment.start.y,
        ),
    )
}
