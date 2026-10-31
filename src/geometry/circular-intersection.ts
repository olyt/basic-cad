import { createArcBoundary, type ArcBoundary } from './arc-boundary'
import {
    circleIntersections,
    type CircularIntersection,
} from './circle-intersection'
import { createCircle, type Arc, type Circle } from './curve'

type CircularCurve = Circle | Arc

export interface CircularPairQuery {
    readonly first: CircularCurve
    readonly second: CircularCurve
    // Radians, applied independently at each arc's endpoint rays.
    readonly angularTolerance: number
}

function prepareCurve(
    curve: CircularCurve,
    angularTolerance: number,
): ArcBoundary {
    switch (curve.type) {
        case 'circle':
            return {
                circle: createCircle(curve.center, curve.radius),
                containsDirection: () => true,
            }
        case 'arc':
            return createArcBoundary({ arc: curve, angularTolerance })

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Circular intersections need circles or arcs, not ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}

// Coincidence describes supporting circles; arc overlap is not extracted.
export function intersectCircularCurves({
    first,
    second,
    angularTolerance,
}: CircularPairQuery): CircularIntersection {
    if (!Number.isFinite(angularTolerance) || angularTolerance < 0) {
        throw new RangeError(
            'Angular tolerance must be finite and nonnegative.',
        )
    }

    const a = prepareCurve(first, angularTolerance)
    const b = prepareCurve(second, angularTolerance)
    const result = circleIntersections(a.circle, b.circle)

    if (result.kind !== 'points') {
        return result
    }

    const points = result.hits
        .filter(
            ({ firstDirection, secondDirection }) =>
                a.containsDirection(firstDirection) &&
                b.containsDirection(secondDirection),
        )
        .map(({ point }) => point)

    return points.length === 0 ? { kind: 'none' } : { kind: 'points', points }
}
