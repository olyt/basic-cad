import { type Curve, type Polyline, type PolylineSegment } from './curve'
import { type CurveLocation } from './evaluation'
import { resolveFreeEndpoint } from './piece-endpoint'
import {
    comparePieceLocations,
    pieceLocation,
    preparePieceCurve,
} from './piece-location'
import { createPolyline } from './polyline'
import { primitivePiece } from './primitive-piece'
import { type ModelTolerance } from './tolerance'

export interface CurveInterval {
    readonly start: CurveLocation
    readonly end: CurveLocation
    readonly modelTolerance: ModelTolerance
}

function polylinePiece(polyline: Polyline, interval: CurveInterval): Polyline {
    const { start, end, modelTolerance } = interval
    const first = start.segmentIndex!
    const last =
        end.segmentIndex! +
        (comparePieceLocations(start, end) > 0 ? polyline.segments.length : 0)
    const segments: PolylineSegment[] = []

    for (let index = first; index <= last; index++) {
        const from = index === first ? start.parameter : 0
        const to = index === last ? end.parameter : 1

        if (from < to) {
            segments.push(
                primitivePiece(
                    polyline.segments[index % polyline.segments.length]!,
                    { start: from, end: to, modelTolerance },
                ),
            )
        }
    }

    return createPolyline({ segments, closed: false }, modelTolerance)
}

// Internal entry for a copied curve and validated, joint-canonical locations.
export function extractPreparedCurve(
    curve: Curve,
    interval: CurveInterval,
): PolylineSegment | Polyline {
    const { start, end } = interval

    if (curve.type === 'circle') {
        return primitivePiece(curve, {
            start: start.parameter,
            end: end.parameter,
            modelTolerance: interval.modelTolerance,
        })
    }

    const order = comparePieceLocations(start, end)
    const cyclic = curve.type === 'polyline' && curve.closed
    const reversedOpen = !cyclic && order > 0

    if (order === 0 || reversedOpen) {
        throw new RangeError(
            'Curve interval must be nonempty and follow its stored direction.',
        )
    }

    if (curve.type === 'polyline') {
        return polylinePiece(curve, interval)
    }

    return primitivePiece(curve, {
        start: start.parameter,
        end: end.parameter,
        modelTolerance: interval.modelTolerance,
    })
}

export function extractCurve(
    curve: Curve,
    interval: CurveInterval,
): PolylineSegment | Polyline {
    const checked = preparePieceCurve(curve, interval.modelTolerance)
    const context = { curve: checked, modelTolerance: interval.modelTolerance }

    return extractPreparedCurve(checked, {
        ...interval,
        start: resolveFreeEndpoint(
            context,
            pieceLocation(checked, interval.start),
        ),
        end: resolveFreeEndpoint(context, pieceLocation(checked, interval.end)),
    })
}
