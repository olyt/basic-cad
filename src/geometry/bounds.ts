import { isAngleInsideArc } from './angle'
import { createCircle, type Arc, type Curve, type Polyline } from './curve'
import { segmentEndpoints } from './segment'
import { type Vector2 } from './vector'

export interface BoundingBox {
    readonly min: Vector2
    readonly max: Vector2
}

function pointBounds(first: Vector2, second: Vector2): BoundingBox {
    return {
        min: { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) },
        max: { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) },
    }
}

function mergeBounds(first: BoundingBox, second: BoundingBox): BoundingBox {
    return {
        min: pointBounds(first.min, second.min).min,
        max: pointBounds(first.max, second.max).max,
    }
}

function arcBounds(arc: Arc): BoundingBox {
    const { start, end } = segmentEndpoints(arc)
    const { center, radius } = arc
    const extrema = [
        { x: center.x + radius, y: center.y },
        { x: center.x, y: center.y + radius },
        { x: center.x - radius, y: center.y },
        { x: center.x, y: center.y - radius },
    ]
    let bounds = pointBounds(start, end)

    for (const [index, point] of extrema.entries()) {
        if (
            isAngleInsideArc({
                angle: (index * Math.PI) / 2,
                startAngle: arc.startAngle,
                sweep: arc.sweep,
                angularTolerance: 0,
            })
        ) {
            bounds = mergeBounds(bounds, pointBounds(point, point))
        }
    }

    return bounds
}

function polylineBounds(polyline: Polyline): BoundingBox {
    let bounds: BoundingBox | undefined

    for (const segment of polyline.segments) {
        const current = curveBounds(segment)

        bounds = bounds ? mergeBounds(bounds, current) : current
    }

    if (!bounds) {
        throw new RangeError('Cannot bound an empty polyline.')
    }

    return bounds
}

// Analytic bounds in drawing units, without tolerance padding or tessellation.
export function curveBounds(curve: Curve): BoundingBox {
    switch (curve.type) {
        case 'line': {
            const { start, end } = segmentEndpoints(curve)

            return pointBounds(start, end)
        }

        case 'circle': {
            const { center, radius } = createCircle(curve.center, curve.radius)

            return pointBounds(
                { x: center.x - radius, y: center.y - radius },
                { x: center.x + radius, y: center.y + radius },
            )
        }

        case 'arc':
            return arcBounds(curve)
        case 'polyline':
            return polylineBounds(curve)

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Unsupported curve type: ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}
