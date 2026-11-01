import { type Curve } from './curve'
import { extractPreparedCurve } from './curve-piece'
import { type CurveLocation } from './evaluation'
import { resolveFreeEndpoint } from './piece-endpoint'
import {
    comparePieceLocations,
    pieceCurveEnds,
    pieceLocation,
    preparePieceCurve,
} from './piece-location'
import { type ModelTolerance } from './tolerance'

export interface CurveSplit {
    readonly locations: readonly CurveLocation[]
    readonly modelTolerance: ModelTolerance
}

export function splitCurve(curve: Curve, split: CurveSplit): readonly Curve[] {
    const checked = preparePieceCurve(curve, split.modelTolerance)
    const cyclic =
        checked.type === 'circle' ||
        (checked.type === 'polyline' && checked.closed)

    if (cyclic) {
        throw new RangeError(
            'Use extractCurve for circles and closed polylines.',
        )
    }

    const cuts = split.locations
        .map((location) => pieceLocation(checked, location))
        .sort(comparePieceLocations)

    const { start, end } = pieceCurveEnds(checked)
    const resolved = cuts.map((location) =>
        resolveFreeEndpoint(
            { curve: checked, modelTolerance: split.modelTolerance },
            location,
        ),
    )
    const interior = resolved.filter(
        (location) =>
            comparePieceLocations(start, location) < 0 &&
            comparePieceLocations(location, end) < 0,
    )

    for (let index = 1; index < interior.length; index++) {
        if (
            comparePieceLocations(interior[index - 1]!, interior[index]!) === 0
        ) {
            throw new RangeError(
                'Cut locations must be distinct; rounded intersections may be unresolved.',
            )
        }
    }

    const boundaries = [start, ...interior, end]

    return boundaries.slice(1).map((location, index) =>
        extractPreparedCurve(checked, {
            start: boundaries[index]!,
            end: location,
            modelTolerance: split.modelTolerance,
        }),
    )
}
