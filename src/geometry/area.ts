import { type Arc, type Polyline, type PolylineSegment } from './curve'
import { integerCoordinates, roundRational } from './exact'
import { copyPolylineSegments } from './polyline'
import { segmentEndpoints } from './segment'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from './tolerance'
import { type Vector2 } from './vector'

function samePoint(first: Vector2, second: Vector2): boolean {
    return first.x === second.x && first.y === second.y
}

function checkedProduct(first: number, second: number): number {
    const product = first * second
    const underFlowed = product === 0 && first !== 0 && second !== 0

    if (!Number.isFinite(product) || underFlowed) {
        throw new RangeError(
            'Area contribution is outside the finite number range.',
        )
    }

    return product
}

function polygonArea(numerator: bigint, exponent: number): number {
    if (numerator === 0n) {
        return 0
    }

    // Shoelace products square the input unit; signed area adds division by two.
    const area = roundRational({ numerator, denominator: 1n }, 2 * exponent - 1)

    if (!Number.isFinite(area) || area === 0) {
        throw new RangeError(
            'Area contribution is outside the finite number range.',
        )
    }

    return area
}

function arcCorrection(arc: Arc): number {
    const { radius, sweep } = arc

    if (Math.abs(sweep) >= 0.1) {
        return checkedProduct(
            radius,
            checkedProduct(radius, (sweep - Math.sin(sweep)) / 2),
        )
    }

    // Taylor form avoids cancellation in sweep - sin(sweep).
    const square = sweep * sweep
    const series =
        1 -
        square *
            (1 / 20 -
                square * (1 / 840 - square * (1 / 60480 - square / 6652800)))
    const scaledRadius = checkedProduct(radius, sweep)
    const factor = checkedProduct(sweep, series / 12)

    return checkedProduct(scaledRadius, checkedProduct(scaledRadius, factor))
}

function* areaContributions(
    segments: readonly [PolylineSegment, ...PolylineSegment[]],
    tolerance: ModelTolerance,
): Generator<number> {
    const endpoints = segments.map(segmentEndpoints)
    const first = endpoints[0]!.start
    const { exponent, values } = integerCoordinates(
        endpoints.flatMap(({ start }) => [start.x, start.y]),
    )
    let previous = first
    const firstX = values[0]!
    const firstY = values[1]!
    let previousX = firstX
    let previousY = firstY
    let polygon = 0n

    for (const [index, segment] of segments.entries()) {
        const { start, end } = endpoints[index]!

        if (!pointsCoincide(previous, start, tolerance)) {
            throw new RangeError(
                'Area endpoints must connect within the model tolerance.',
            )
        }

        if (segment.type === 'arc' && samePoint(start, end)) {
            throw new RangeError(
                'Arc endpoints cannot resolve an area boundary.',
            )
        }

        const startX = values[2 * index]!
        const startY = values[2 * index + 1]!

        polygon += previousX * startY - previousY * startX

        if (segment.type === 'arc') {
            yield arcCorrection(segment)
        }

        previous = end
        previousX = startX
        previousY = startY
    }

    if (!pointsCoincide(previous, first, tolerance)) {
        throw new RangeError(
            'Area endpoints must connect within the model tolerance.',
        )
    }

    polygon += previousX * firstY - previousY * firstX

    yield polygonArea(polygon, exponent)
}

function compensatedSum(contributions: Iterable<number>): number {
    let total = 0
    let correction = 0

    for (const contribution of contributions) {
        const next = total + contribution

        correction +=
            Math.abs(total) >= Math.abs(contribution)
                ? total - next + contribution
                : contribution - next + total
        total = next
    }

    const area = total + correction

    if (!Number.isFinite(area)) {
        throw new RangeError('Area is outside the finite number range.')
    }

    return area === 0 ? 0 : area
}

// Uses the cyclic start-vertex polygon; counterclockwise area is positive.
export function polylineSignedArea(
    polyline: Polyline,
    tolerance: ModelTolerance,
): number {
    const checkedTolerance = createModelTolerance(tolerance.distance)
    const segments = copyPolylineSegments(polyline)

    if (!polyline.closed) {
        throw new RangeError('Area needs a closed polyline.')
    }

    return compensatedSum(areaContributions(segments, checkedTolerance))
}
