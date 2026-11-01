import { createLine, type Line } from './curve'
import { integerCoordinates, roundRational } from './exact'
import {
    rationalLocation,
    type ParameterLocation,
} from './intersection-location'
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

export type LocatedLineIntersection =
    | {
          readonly kind: Extract<LineIntersectionKind, 'point'>
          readonly point: Vector2
          readonly first: ParameterLocation
          readonly second: ParameterLocation
      }
    | { readonly kind: Exclude<LineIntersectionKind, 'point'> }

type ExactLineIntersection =
    | {
          readonly kind: Extract<LineIntersectionKind, 'point'>
          readonly point: Vector2
          readonly firstNumerator: bigint
          readonly secondNumerator: bigint
          readonly denominator: bigint
      }
    | { readonly kind: Exclude<LineIntersectionKind, 'point'> }

interface IntegerPoint {
    readonly x: bigint
    readonly y: bigint
}

function difference(first: IntegerPoint, second: IntegerPoint): IntegerPoint {
    return { x: first.x - second.x, y: first.y - second.y }
}

function determinant(first: IntegerPoint, second: IntegerPoint): bigint {
    return first.x * second.y - first.y * second.x
}

export function isLineDomain(value: unknown): value is LineDomain {
    return LINE_DOMAINS.some((domain) => domain === value)
}

function checkedLine({ line, domain }: LineOperand): Line {
    if (!isLineDomain(domain)) {
        throw new RangeError(`Unsupported line domain: ${String(domain)}.`)
    }

    return createLine(line.start, line.end)
}

// The denominator is positive; classification happens before any rounding.
function outsideSegment(numerator: bigint, denominator: bigint): boolean {
    return numerator < 0n || numerator > denominator
}

function exactIntersection(
    first: LineOperand,
    second: LineOperand,
): ExactLineIntersection {
    const firstLine = checkedLine(first)
    const secondLine = checkedLine(second)
    const {
        exponent,
        values: [ax, ay, bx, by, cx, cy, dx, dy],
    } = integerCoordinates([
        firstLine.start.x,
        firstLine.start.y,
        firstLine.end.x,
        firstLine.end.y,
        secondLine.start.x,
        secondLine.start.y,
        secondLine.end.x,
        secondLine.end.y,
    ])
    const a = { start: { x: ax, y: ay }, direction: { x: bx - ax, y: by - ay } }
    const b = { start: { x: cx, y: cy }, direction: { x: dx - cx, y: dy - cy } }
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
        firstNumerator,
        secondNumerator,
        denominator,
        point: {
            x: roundRational({ numerator: x, denominator }, exponent),
            y: roundRational({ numerator: y, denominator }, exponent),
        },
    }
}

// Coincidence describes supporting lines, regardless of segment overlap.
export function intersectLines(
    first: LineOperand,
    second: LineOperand,
): LineIntersection {
    const result = exactIntersection(first, second)

    if (result.kind !== 'point') {
        return result
    }

    return { kind: 'point', point: result.point }
}

export function intersectLineSegments(
    first: Line,
    second: Line,
): LocatedLineIntersection {
    const result = exactIntersection(
        { line: first, domain: 'segment' },
        { line: second, domain: 'segment' },
    )

    if (result.kind !== 'point') {
        return result
    }

    return {
        kind: 'point',
        point: result.point,
        first: rationalLocation({
            numerator: result.firstNumerator,
            denominator: result.denominator,
        }),
        second: rationalLocation({
            numerator: result.secondNumerator,
            denominator: result.denominator,
        }),
    }
}
