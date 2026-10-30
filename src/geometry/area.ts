import { type Arc, type Polyline, type PolylineSegment } from './curve'
import { copyPolylineSegments } from './polyline'
import { segmentEndpoints } from './segment'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from './tolerance'
import { type Vector2 } from './vector'

const coordinateBits = new DataView(new ArrayBuffer(8))

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

// Every finite double is an integer multiple of 2^-1074.
function integerCoordinate(value: number): bigint {
    coordinateBits.setFloat64(0, value)

    const bits = coordinateBits.getBigUint64(0)
    const exponent = Number((bits >> 52n) & 0x7ffn)
    let coefficient = bits & ((1n << 52n) - 1n)

    if (exponent !== 0) {
        coefficient = (coefficient | (1n << 52n)) << BigInt(exponent - 1)
    }

    return bits >> 63n === 0n ? coefficient : -coefficient
}

function polygonArea(numerator: bigint): number {
    if (numerator === 0n) {
        return 0
    }

    const magnitude = numerator < 0n ? -numerator : numerator
    const shift = Math.max(1075, magnitude.toString(2).length - 53)
    let rounded = magnitude >> BigInt(shift)

    const remainder = magnitude - (rounded << BigInt(shift))
    const halfway = 1n << BigInt(shift - 1)
    const roundUp =
        remainder > halfway || (remainder === halfway && (rounded & 1n) !== 0n)

    if (roundUp) {
        rounded += 1n
    }

    // Shoelace products have scale 2^-2148; signed area adds division by two.
    const area = Number(rounded) * 2 ** (shift - 2149)

    if (!Number.isFinite(area) || area === 0) {
        throw new RangeError(
            'Area contribution is outside the finite number range.',
        )
    }

    return numerator < 0n ? -area : area
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
    const first = segmentEndpoints(segments[0]).start
    let previous = first
    const firstX = integerCoordinate(first.x)
    const firstY = integerCoordinate(first.y)
    let previousX = firstX
    let previousY = firstY
    let polygon = 0n

    for (const segment of segments) {
        const { start, end } = segmentEndpoints(segment)

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

        const startX = integerCoordinate(start.x)
        const startY = integerCoordinate(start.y)

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

    yield polygonArea(polygon)
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
