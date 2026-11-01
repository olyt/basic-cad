import { describe, expect, it } from 'vitest'
import {
    randomIntersectionPath,
    scallopedPath,
} from '../test-support/intersection-paths'
import { seededRandom } from '../test-support/random'
import { createCircle, createLine } from './curve'
import {
    collectCurveIntersections,
    intersectCurves,
    type CurveIntersectionHit,
    type CurveIntersectionQuery,
} from './curve-intersection'
import { evaluateCurve } from './evaluation'
import {
    intersectionCandidates,
    type IntersectionCandidate,
} from './intersection-candidates'
import {
    prepareIntersectionCurve,
    type IntersectionCurve,
} from './intersection-curve'

function* allPairs(
    first: IntersectionCurve,
    second: IntersectionCurve,
): Generator<IntersectionCandidate> {
    for (let firstIndex = 0; firstIndex < first.parts.length; firstIndex++) {
        for (
            let secondIndex = 0;
            secondIndex < second.parts.length;
            secondIndex++
        ) {
            yield { firstIndex, secondIndex }
        }
    }
}

function hitKeys(hits: readonly CurveIntersectionHit[]): string[] {
    return hits
        .map(({ point, first, second }) =>
            JSON.stringify([
                point.x,
                point.y,
                first.segmentIndex,
                first.parameter,
                second.segmentIndex,
                second.parameter,
            ]),
        )
        .sort()
}

describe('polyline intersection properties (fixed seed)', () => {
    const random = seededRandom(20261101)
    const cases = Array.from(
        { length: 150 },
        (_, index): CurveIntersectionQuery => {
            const translation = index % 4 === 0 ? 1e5 : 0
            const first = randomIntersectionPath(random, translation)
            const center = {
                x: translation + random.between(-50, 50),
                y: random.between(-50, 50),
            }
            const second =
                index % 3 === 0
                    ? createCircle(center, random.between(20, 80))
                    : randomIntersectionPath(random, translation)

            return {
                first,
                second:
                    index % 3 === 1
                        ? createLine(center, { x: translation + 100, y: -100 })
                        : second,
                modelTolerance: { distance: 1e-7 },
                angularTolerance: index % 2 === 0 ? 0 : 1e-10,
            }
        },
    )

    it('keeps every hit produced without bounds rejection', () => {
        for (const query of cases) {
            const first = prepareIntersectionCurve(
                query.first,
                query.angularTolerance,
            )
            const second = prepareIntersectionCurve(
                query.second,
                query.angularTolerance,
            )
            const brute = collectCurveIntersections({
                first,
                second,
                candidates: allPairs(first, second),
                modelTolerance: query.modelTolerance,
            })

            expect(intersectCurves(query).hits).toStrictEqual(brute.hits)
        }
    })

    it('swaps operand locations and evaluates them back onto both curves', () => {
        for (const query of cases) {
            const result = intersectCurves(query)
            const reverse = intersectCurves({
                ...query,
                first: query.second,
                second: query.first,
            })

            expect(hitKeys(result.hits)).toEqual(
                hitKeys(
                    reverse.hits.map(({ point, first, second }) => ({
                        point,
                        first: second,
                        second: first,
                    })),
                ),
            )

            for (const hit of result.hits) {
                for (const [curve, location] of [
                    [query.first, hit.first],
                    [query.second, hit.second],
                ] as const) {
                    const point = evaluateCurve(curve, location).point

                    expect(
                        Math.hypot(
                            point.x - hit.point.x,
                            point.y - hit.point.y,
                        ),
                    ).toBeLessThan(1e-7)
                }
            }
        }
    })

    it('reduces a 30-by-30 arc query to 59 candidate pairs without changing hits', () => {
        const query = {
            first: scallopedPath(30, { x: 0, y: 0 }),
            second: scallopedPath(30, { x: 0.5, y: 0.5 }),
            modelTolerance: { distance: 1e-7 },
            angularTolerance: 0,
        }
        const first = prepareIntersectionCurve(query.first, 0)
        const second = prepareIntersectionCurve(query.second, 0)
        const candidates = [...intersectionCandidates(first, second)]
        const result = intersectCurves(query)

        expect(candidates).toHaveLength(59)
        expect(result.hits).toHaveLength(59)
        expect(result).toEqual(
            collectCurveIntersections({
                first,
                second,
                candidates: allPairs(first, second),
                modelTolerance: query.modelTolerance,
            }),
        )
    })
})
