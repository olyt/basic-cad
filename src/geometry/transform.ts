import {
    createArc,
    createCircle,
    createLine,
    type Curve,
    type PolylineSegment,
} from './curve'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { copySegment } from './segment'
import { createModelTolerance, type ModelTolerance } from './tolerance'
import { transformArcAngle } from './transform-angle'
import {
    prepareTransform,
    type CurveTransform,
    type PreparedTransform,
} from './transform-point'

export type { CurveTransform } from './transform-point'

type PrimitiveCurve = Exclude<Curve, { type: 'polyline' }>

export interface CurveTransformQuery {
    readonly transform: CurveTransform
    readonly modelTolerance: ModelTolerance
}

interface TransformContext {
    readonly transform: PreparedTransform
    readonly modelTolerance: ModelTolerance
}

function checkedCurve(curve: Curve, modelTolerance: ModelTolerance): Curve {
    switch (curve.type) {
        case 'line':
        case 'arc':
            return copySegment(curve)
        case 'circle':
            return createCircle(curve.center, curve.radius)
        case 'polyline':
            return createPolyline(curve, modelTolerance)

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Unsupported curve type: ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}

function transformSegment(
    segment: PolylineSegment,
    context: TransformContext,
): PolylineSegment {
    const { transform, modelTolerance } = context

    if (segment.type === 'line') {
        return createLine(
            transform.point(segment.start),
            transform.point(segment.end),
        )
    }

    const { center, radius } = createCircle(
        transform.point(segment.center),
        segment.radius * transform.scale,
    )

    return createArc({
        center,
        radius,
        startAngle: transformArcAngle(segment, {
            transform,
            radius,
            modelTolerance,
        }),
        sweep: transform.reflected ? -segment.sweep : segment.sweep,
    })
}

function transformPrimitive(
    curve: PrimitiveCurve,
    context: TransformContext,
): PrimitiveCurve {
    const { transform } = context
    const result =
        curve.type === 'circle'
            ? createCircle(
                  transform.point(curve.center),
                  curve.radius * transform.scale,
              )
            : transformSegment(curve, context)

    curveLength(result)

    return result
}

export function transformCurve(
    curve: Curve,
    input: CurveTransformQuery,
): Curve {
    const modelTolerance = createModelTolerance(
        input.modelTolerance?.distance ?? NaN,
    )
    const source = checkedCurve(curve, modelTolerance)
    const transform = prepareTransform(input.transform)
    const context = { transform, modelTolerance }

    if (source.type === 'polyline') {
        const segments = source.segments.map((segment) => {
            const result = transformSegment(segment, context)

            curveLength(result)

            return result
        })

        return createPolyline(
            { segments, closed: source.closed },
            modelTolerance,
        )
    }

    return transformPrimitive(source, context)
}
