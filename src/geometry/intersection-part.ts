import { FULL_TURN } from './angle'
import { createArcBoundary, type ArcBoundary } from './arc-boundary'
import { curveBounds, type BoundingBox } from './bounds'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Circle,
    type Line,
} from './curve'
import { type ParameterLocation } from './intersection-location'
import { segmentEndpoints } from './segment'
import { assertFiniteVector2, type Vector2 } from './vector'

export type PrimitiveCurve = Line | Circle | Arc

export interface CircularRoot {
    readonly point: Vector2
    readonly direction: Vector2
}

export interface IntersectionPart {
    readonly curve: PrimitiveCurve
    readonly bounds: BoundingBox
    readonly endpoints:
        { readonly start: Vector2; readonly end: Vector2 } | undefined
    readonly circle: Circle | undefined
    readonly boundary: ArcBoundary | undefined
    readonly locateJointRoot?: (
        root: CircularRoot,
    ) => ParameterLocation | undefined
}

function checkedPrimitive(curve: PrimitiveCurve): PrimitiveCurve {
    switch (curve.type) {
        case 'line':
            return createLine(curve.start, curve.end)
        case 'circle':
            return createCircle(curve.center, curve.radius)
        case 'arc':
            return createArc(curve)

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Intersection parts need primitive curves, not ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}

export function prepareIntersectionPart(
    curve: PrimitiveCurve,
    angularTolerance: number,
): IntersectionPart {
    if (!Number.isFinite(angularTolerance) || angularTolerance < 0) {
        throw new RangeError(
            'Angular tolerance must be finite and nonnegative.',
        )
    }

    const checked = checkedPrimitive(curve)
    const boundary =
        checked.type === 'arc'
            ? createArcBoundary({ arc: checked, angularTolerance })
            : undefined
    const circle = checked.type === 'circle' ? checked : boundary?.circle

    return {
        curve: checked,
        circle,
        boundary,
        // Supporting-circle boxes also enclose angularly admitted arc hits.
        bounds: curveBounds(circle ?? checked),
        endpoints:
            checked.type === 'circle' ? undefined : segmentEndpoints(checked),
    }
}

export function directionLocation(
    part: IntersectionPart,
    root: CircularRoot,
): ParameterLocation | undefined {
    const { direction } = root

    assertFiniteVector2(direction)

    if (direction.x === 0 && direction.y === 0) {
        throw new RangeError(
            'A circular intersection direction must be nonzero.',
        )
    }

    if (part.curve.type === 'circle') {
        return { parameter: Math.atan2(direction.y, direction.x) / FULL_TURN }
    }

    if (part.boundary) {
        return (
            part.boundary.locateDirection(direction) ??
            part.locateJointRoot?.(root)
        )
    }

    throw new RangeError('A line has no circular direction location.')
}
