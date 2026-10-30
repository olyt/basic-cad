import { createLine, type Line } from './curve'
import { type Vector2 } from './vector'

const LINE_DOMAINS = ['segment', 'infinite'] as const

export type LineDomain = (typeof LINE_DOMAINS)[number]
export type LineIntersectionKind = 'point' | 'none' | 'parallel' | 'coincident'

export interface LineOperand {
    readonly line: Line
    readonly domain: LineDomain
}

export type LineIntersection =
    | {
          readonly kind: Extract<LineIntersectionKind, 'point'>
          readonly point: Vector2
      }
    | { readonly kind: Exclude<LineIntersectionKind, 'point'> }

interface IntegerPoint {
    readonly x: bigint
    readonly y: bigint
}

interface IntegerLine {
    readonly start: IntegerPoint
    readonly direction: IntegerPoint
}

const coordinateBits = new DataView(new ArrayBuffer(8))

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

function integerPoint(point: Vector2): IntegerPoint {
    return { x: integerCoordinate(point.x), y: integerCoordinate(point.y) }
}

function difference(first: IntegerPoint, second: IntegerPoint): IntegerPoint {
    return { x: first.x - second.x, y: first.y - second.y }
}

function determinant(first: IntegerPoint, second: IntegerPoint): bigint {
    return first.x * second.y - first.y * second.x
}

function isLineDomain(value: unknown): value is LineDomain {
    return LINE_DOMAINS.some((domain) => domain === value)
}

function integerLine({ line, domain }: LineOperand): IntegerLine {
    if (!isLineDomain(domain)) {
        throw new RangeError(`Unsupported line domain: ${String(domain)}.`)
    }

    const checked = createLine(line.start, line.end)
    const start = integerPoint(checked.start)

    return { start, direction: difference(integerPoint(checked.end), start) }
}

// The denominator is positive; classification happens before any rounding.
function outsideSegment(numerator: bigint, denominator: bigint): boolean {
    return numerator < 0n || numerator > denominator
}

function roundedCoordinate(numerator: bigint, denominator: bigint): number {
    const magnitude = numerator < 0n ? -numerator : numerator
    const integer = magnitude / denominator
    const shift = Math.max(0, integer.toString(2).length - 53)
    const divisor = denominator << BigInt(shift)
    let rounded = magnitude / divisor
    const twiceRemainder = (magnitude % divisor) * 2n
    const roundUp =
        twiceRemainder > divisor ||
        (twiceRemainder === divisor && (rounded & 1n) !== 0n)

    if (roundUp) {
        rounded += 1n
    }

    // Round the exact rational once, including subnormal ties to even.
    const result = Number(rounded) * 2 ** (shift - 1074)

    if (!Number.isFinite(result)) {
        throw new RangeError(
            'Line intersection exceeds the finite number range.',
        )
    }

    if (result === 0) {
        return 0
    }

    return numerator < 0n ? -result : result
}

// Coincidence describes supporting lines, regardless of segment overlap.
export function intersectLines(
    first: LineOperand,
    second: LineOperand,
): LineIntersection {
    const a = integerLine(first)
    const b = integerLine(second)
    const offset = difference(b.start, a.start)
    let denominator = determinant(a.direction, b.direction)
    let firstNumerator = determinant(offset, b.direction)
    let secondNumerator = determinant(offset, a.direction)

    if (denominator === 0n) {
        return { kind: firstNumerator === 0n ? 'coincident' : 'parallel' }
    }

    if (denominator < 0n) {
        denominator = -denominator
        firstNumerator = -firstNumerator
        secondNumerator = -secondNumerator
    }

    if (
        first.domain === 'segment' &&
        outsideSegment(firstNumerator, denominator)
    ) {
        return { kind: 'none' }
    }

    if (
        second.domain === 'segment' &&
        outsideSegment(secondNumerator, denominator)
    ) {
        return { kind: 'none' }
    }

    const x = a.start.x * denominator + a.direction.x * firstNumerator
    const y = a.start.y * denominator + a.direction.y * firstNumerator

    return {
        kind: 'point',
        point: {
            x: roundedCoordinate(x, denominator),
            y: roundedCoordinate(y, denominator),
        },
    }
}
