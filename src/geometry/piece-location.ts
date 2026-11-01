import { createCircle, type Curve, type Polyline } from './curve'
import { type CurveLocation } from './evaluation'
import { createPolyline } from './polyline'
import { copySegment } from './segment'
import { createModelTolerance, type ModelTolerance } from './tolerance'

export function preparePieceCurve(
    curve: Curve,
    tolerance: ModelTolerance,
): Curve {
    const checked = createModelTolerance(tolerance?.distance ?? NaN)

    switch (curve.type) {
        case 'line':
        case 'arc':
            return copySegment(curve)
        case 'circle':
            return createCircle(curve.center, curve.radius)
        case 'polyline':
            return createPolyline(curve, checked)

        default: {
            const unsupported: never = curve

            throw new RangeError(
                `Unsupported curve type: ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}

function polylinePieceLocation(
    polyline: Polyline,
    location: CurveLocation,
): CurveLocation {
    const { parameter, segmentIndex } = location
    const validIndex =
        segmentIndex !== undefined && Number.isInteger(segmentIndex)
    const outsideRange =
        segmentIndex === undefined ||
        segmentIndex < 0 ||
        segmentIndex >= polyline.segments.length

    if (!validIndex || outsideRange) {
        throw new RangeError(
            'A polyline location needs an in-range integer segment index.',
        )
    }

    const closingEnd =
        segmentIndex === polyline.segments.length - 1 && parameter === 1

    if (polyline.closed && closingEnd) {
        return { segmentIndex: 0, parameter: 0 }
    }

    if (parameter === 0 && segmentIndex > 0) {
        return { segmentIndex: segmentIndex - 1, parameter: 1 }
    }

    return { segmentIndex, parameter }
}

export function pieceLocation(
    curve: Curve,
    location: CurveLocation,
): CurveLocation {
    const { parameter } = location

    if (!Number.isFinite(parameter)) {
        throw new RangeError('Curve parameter must be finite.')
    }

    if (curve.type !== 'polyline' && 'segmentIndex' in location) {
        throw new RangeError('Primitive locations cannot have a segment index.')
    }

    if (curve.type === 'circle') {
        return { parameter: parameter % 1 }
    }

    if (parameter < 0 || parameter > 1) {
        throw new RangeError('Segment parameter must be within [0, 1].')
    }

    return curve.type === 'polyline'
        ? polylinePieceLocation(curve, location)
        : { parameter }
}

export function comparePieceLocations(
    first: CurveLocation,
    second: CurveLocation,
): number {
    const segmentOrder = (first.segmentIndex ?? 0) - (second.segmentIndex ?? 0)

    return segmentOrder || first.parameter - second.parameter
}

export function pieceCurveEnds(curve: Curve): {
    start: CurveLocation
    end: CurveLocation
} {
    if (curve.type === 'polyline') {
        return {
            start: { segmentIndex: 0, parameter: 0 },
            end: { segmentIndex: curve.segments.length - 1, parameter: 1 },
        }
    }

    return { start: { parameter: 0 }, end: { parameter: 1 } }
}
