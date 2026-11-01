import { type BoundingBox } from './bounds'
import { type IntersectionCurve } from './intersection-curve'

export interface IntersectionCandidate {
    readonly firstIndex: number
    readonly secondIndex: number
}

function boundsOverlap(first: BoundingBox, second: BoundingBox): boolean {
    const separateX = first.max.x < second.min.x || second.max.x < first.min.x
    const separateY = first.max.y < second.min.y || second.max.y < first.min.y

    return !separateX && !separateY
}

export function* intersectionCandidates(
    first: IntersectionCurve,
    second: IntersectionCurve,
): Generator<IntersectionCandidate> {
    for (const [firstIndex, a] of first.parts.entries()) {
        for (const [secondIndex, b] of second.parts.entries()) {
            if (boundsOverlap(a.bounds, b.bounds)) {
                yield { firstIndex, secondIndex }
            }
        }
    }
}
