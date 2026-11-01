import { type Curve } from './curve'
import { type CurveLocation } from './evaluation'
import { curveLength } from './length'
import { type ModelTolerance } from './tolerance'

export function resolveFreeEndpoint(
    input: { readonly curve: Curve; readonly modelTolerance: ModelTolerance },
    location: CurveLocation,
): CurveLocation {
    const { curve, modelTolerance } = input

    if (modelTolerance.distance === 0 || curve.type === 'circle') {
        return location
    }

    if (curve.type === 'polyline' && curve.closed) {
        return location
    }

    const index = location.segmentIndex ?? 0
    const segment = curve.type === 'polyline' ? curve.segments[index]! : curve
    const length = curveLength(segment)
    const nearStart = length * location.parameter <= modelTolerance.distance
    const nearEnd = length * (1 - location.parameter) <= modelTolerance.distance

    if (nearStart === nearEnd) {
        return location
    }

    const first = index === 0
    const last =
        curve.type !== 'polyline' || index === curve.segments.length - 1

    if (nearStart && first) {
        return { ...location, parameter: 0 }
    }

    return nearEnd && last ? { ...location, parameter: 1 } : location
}
