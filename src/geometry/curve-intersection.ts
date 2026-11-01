import { type Curve } from './curve'
import {
    intersectionCandidates,
    type IntersectionCandidate,
} from './intersection-candidates'
import {
    intersectionCurveLocation,
    prepareIntersectionCurve,
    type IntersectionCurve,
} from './intersection-curve'
import {
    uniqueIntersections,
    type CurveIntersectionHit,
    type IntersectionEvent,
} from './intersection-events'
import { intersectPrimitiveParts } from './primitive-intersection'
import { mergeJointIntersections } from './intersection-joint-merge'
import { admitJointArcRoots } from './joint-root-admission'
import { createModelTolerance, type ModelTolerance } from './tolerance'

export type { CurveIntersectionHit } from './intersection-events'

export interface CurveIntersectionQuery {
    readonly first: Curve
    readonly second: Curve
    readonly angularTolerance: number
    readonly modelTolerance: ModelTolerance
}

export interface CoincidentCurveParts {
    readonly firstSegmentIndex?: number
    readonly secondSegmentIndex?: number
}

export interface CurveIntersections {
    readonly hits: readonly CurveIntersectionHit[]
    // Candidate supporting curves only; overlap intervals are not extracted.
    readonly coincident: readonly CoincidentCurveParts[]
}

interface PreparedQuery {
    readonly first: IntersectionCurve
    readonly second: IntersectionCurve
    readonly candidates: Iterable<IntersectionCandidate>
    readonly modelTolerance: ModelTolerance
}

interface IndexedCurve {
    readonly curve: IntersectionCurve
    readonly index: number
}

function coincidentEntry(
    first: IndexedCurve,
    second: IndexedCurve,
): CoincidentCurveParts {
    return {
        ...(first.curve.polyline ? { firstSegmentIndex: first.index } : {}),
        ...(second.curve.polyline ? { secondSegmentIndex: second.index } : {}),
    }
}

export function collectCurveIntersections({
    first: inputFirst,
    second: inputSecond,
    candidates,
    modelTolerance,
}: PreparedQuery): CurveIntersections {
    const tolerance = createModelTolerance(modelTolerance?.distance ?? NaN)
    const first = admitJointArcRoots(inputFirst, tolerance)
    const second = admitJointArcRoots(inputSecond, tolerance)
    const events: IntersectionEvent[] = []
    const coincident: CoincidentCurveParts[] = []

    for (const { firstIndex, secondIndex } of candidates) {
        const result = intersectPrimitiveParts(
            first.parts[firstIndex]!,
            second.parts[secondIndex]!,
        )

        if (result.coincident) {
            coincident.push(
                coincidentEntry(
                    { curve: first, index: firstIndex },
                    { curve: second, index: secondIndex },
                ),
            )
        }

        for (const hit of result.hits) {
            const firstLocation = intersectionCurveLocation(first, {
                partIndex: firstIndex,
                root: hit.first,
                point: hit.point,
            })
            const secondLocation = intersectionCurveLocation(second, {
                partIndex: secondIndex,
                root: hit.second,
                point: hit.point,
            })

            events.push({
                firstPart: firstIndex,
                secondPart: secondIndex,
                firstEndpoint: firstLocation.endpoint,
                secondEndpoint: secondLocation.endpoint,
                hit: {
                    point: hit.point,
                    first: firstLocation.location,
                    second: secondLocation.location,
                },
            })
        }
    }

    return {
        hits: uniqueIntersections(
            mergeJointIntersections({ events, first, second }, tolerance),
        ),
        coincident,
    }
}

export function intersectCurves({
    first,
    second,
    angularTolerance,
    modelTolerance,
}: CurveIntersectionQuery): CurveIntersections {
    const tolerance = createModelTolerance(modelTolerance?.distance ?? NaN)
    const a = prepareIntersectionCurve(first, angularTolerance)
    const b = prepareIntersectionCurve(second, angularTolerance)

    return collectCurveIntersections({
        first: a,
        second: b,
        candidates: intersectionCandidates(a, b),
        modelTolerance: tolerance,
    })
}
