import { circleIntersections } from './circle-intersection'
import { type Line } from './curve'
import { type ParameterLocation } from './intersection-location'
import { directionLocation, type IntersectionPart } from './intersection-part'
import { locatedLineCircleIntersections } from './line-circle-intersection'
import { intersectLineSegments } from './line-intersection'
import { type Vector2 } from './vector'

export interface PrimitiveHit {
    readonly point: Vector2
    readonly first: ParameterLocation
    readonly second: ParameterLocation
}

export interface PrimitiveIntersections {
    readonly hits: readonly PrimitiveHit[]
    readonly coincident: boolean
}

function linePair(first: Line, second: Line): PrimitiveIntersections {
    const result = intersectLineSegments(first, second)

    return result.kind === 'point'
        ? {
              hits: [
                  {
                      point: result.point,
                      first: result.first,
                      second: result.second,
                  },
              ],
              coincident: false,
          }
        : { hits: [], coincident: result.kind === 'coincident' }
}

function lineCircularPair(
    first: Line,
    second: IntersectionPart,
): PrimitiveIntersections {
    const hits = locatedLineCircleIntersections(first, second.circle!).flatMap(
        (hit) => {
            const location = directionLocation(second, hit.direction)

            return location
                ? [{ point: hit.point, first: hit.line, second: location }]
                : []
        },
    )

    return { hits, coincident: false }
}

function circularPair(
    first: IntersectionPart,
    second: IntersectionPart,
): PrimitiveIntersections {
    const result = circleIntersections(first.circle!, second.circle!)

    if (result.kind !== 'points') {
        return { hits: [], coincident: result.kind === 'coincident' }
    }

    const hits: PrimitiveHit[] = []

    for (const hit of result.hits) {
        const firstLocation = directionLocation(first, hit.firstDirection)
        const secondLocation = directionLocation(second, hit.secondDirection)

        if (firstLocation && secondLocation) {
            hits.push({
                point: hit.point,
                first: firstLocation,
                second: secondLocation,
            })
        }
    }

    return { hits, coincident: false }
}

export function intersectPrimitiveParts(
    first: IntersectionPart,
    second: IntersectionPart,
): PrimitiveIntersections {
    if (first.curve.type === 'line') {
        return second.curve.type === 'line'
            ? linePair(first.curve, second.curve)
            : lineCircularPair(first.curve, second)
    }

    if (second.curve.type === 'line') {
        const result = lineCircularPair(second.curve, first)

        return {
            coincident: result.coincident,
            hits: result.hits.map(({ point, first, second }) => ({
                point,
                first: second,
                second: first,
            })),
        }
    }

    return circularPair(first, second)
}
