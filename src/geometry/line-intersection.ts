import { createLine, type Line } from './curve'
import { integerCoordinates, roundRational } from './exact'
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

// Coincidence describes supporting lines, regardless of segment overlap.
export function intersectLines(
    first: LineOperand,
    second: LineOperand,
): LineIntersection {
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
        point: {
            x: roundRational({ numerator: x, denominator }, exponent),
            y: roundRational({ numerator: y, denominator }, exponent),
        },
    }
}
