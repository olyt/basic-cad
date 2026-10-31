import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN, isAngleInsideArc } from './angle'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Line,
} from './curve'
import { intersectLineArc } from './line-arc-intersection'
import { lineCircleIntersections } from './line-circle-intersection'
import {
    intersectLines,
    type LineDomain,
    type LineIntersection,
    type LineOperand,
} from './line-intersection'
import type { Vector2 } from './vector'

const span = 1e4
const random = seededRandom(20261030)

interface LinePair {
    readonly first: LineOperand
    readonly second: LineOperand
}

function randomPoint(): Vector2 {
    return { x: random.between(-span, span), y: random.between(-span, span) }
}

function randomOperand(): LineOperand {
    const domain: LineDomain = random.sign() > 0 ? 'segment' : 'infinite'

    return { line: createLine(randomPoint(), randomPoint()), domain }
}

function distanceToLine(point: Vector2, line: Line): number {
    const x = line.end.x - line.start.x
    const y = line.end.y - line.start.y

    return (
        Math.abs(x * (point.y - line.start.y) - y * (point.x - line.start.x)) /
        Math.hypot(x, y)
    )
}

function sameIntersection(
    first: LineIntersection,
    second: LineIntersection,
): boolean {
    if (first.kind !== 'point' || second.kind !== 'point') {
        return first.kind === second.kind
    }

    return first.point.x === second.point.x && first.point.y === second.point.y
}

// Plain floating-point parameters along each line; only clear-cut cases are compared.
function floatParameters({ first, second }: LinePair): number[] {
    const a = first.line
    const b = second.line
    const ax = a.end.x - a.start.x
    const ay = a.end.y - a.start.y
    const bx = b.end.x - b.start.x
    const by = b.end.y - b.start.y
    const ox = b.start.x - a.start.x
    const oy = b.start.y - a.start.y
    const denominator = ax * by - ay * bx

    return [
        (ox * by - oy * bx) / denominator,
        (ox * ay - oy * ax) / denominator,
    ]
}

function expectedKind(pair: LinePair): LineIntersection['kind'] | undefined {
    const margin = 1e-9
    const operands = [pair.first, pair.second]
    const parameters = floatParameters(pair)
    const segments = parameters.filter(
        (_, index) => operands[index]?.domain === 'segment',
    )

    if (segments.some((t) => t < -margin || t > 1 + margin)) {
        return 'none'
    }

    const clearlyInside = segments.every((t) => t > margin && t < 1 - margin)

    return clearlyInside ? 'point' : undefined
}

const linePairs: LinePair[] = Array.from({ length: 2000 }, () => ({
    first: randomOperand(),
    second: randomOperand(),
}))

describe('line intersection properties (fixed seed)', () => {
    it('gives the same result for either operand order', () => {
        const failures = linePairs.filter(
            ({ first, second }) =>
                !sameIntersection(
                    intersectLines(first, second),
                    intersectLines(second, first),
                ),
        )

        expect(failures).toEqual([])
    })

    it('places every intersection point on both supporting lines', () => {
        const failures = linePairs.filter(({ first, second }) => {
            const result = intersectLines(first, second)

            return (
                result.kind === 'point' &&
                Math.max(
                    distanceToLine(result.point, first.line),
                    distanceToLine(result.point, second.line),
                ) >
                    1e-9 * span
            )
        })

        expect(failures).toEqual([])
    })

    it('agrees with floating point wherever segment membership is clear', () => {
        const failures = linePairs.filter((pair) => {
            const expected = expectedKind(pair)
            const { kind } = intersectLines(pair.first, pair.second)

            return expected !== undefined && kind !== expected
        })

        expect(failures).toEqual([])
    })
})

const circleCases = Array.from({ length: 2000 }, () => ({
    line: createLine(randomPoint(), randomPoint()),
    circle: createCircle(randomPoint(), random.magnitude(-1, 4)),
}))

describe('line-circle intersection properties (fixed seed)', () => {
    it('finds two hits for clear secants and none for clear misses', () => {
        const failures = circleCases.filter(({ line, circle }) => {
            const gap = distanceToLine(circle.center, line) / circle.radius
            const hits = lineCircleIntersections(
                { line, domain: 'infinite' },
                circle,
            ).length

            return (
                (gap < 1 - 1e-9 && hits !== 2) || (gap > 1 + 1e-9 && hits !== 0)
            )
        })

        expect(failures).toEqual([])
    })

    it('puts every hit on the circle and the line, with direction (P - C) / R', () => {
        const failures = circleCases.flatMap(({ line, circle }) => {
            const scale =
                Math.max(Math.abs(circle.center.x), Math.abs(circle.center.y)) +
                circle.radius
            const hits = lineCircleIntersections(
                { line, domain: 'infinite' },
                circle,
            )

            return hits.filter(({ point, direction }) => {
                const x = point.x - circle.center.x
                const y = point.y - circle.center.y
                const offCircle = Math.abs(Math.hypot(x, y) - circle.radius)
                const directionError = Math.hypot(
                    direction.x - x / circle.radius,
                    direction.y - y / circle.radius,
                )

                return (
                    offCircle > 1e-12 * scale ||
                    distanceToLine(point, line) >
                        1e-12 * Math.max(scale, span) ||
                    directionError > (1e-9 * scale) / circle.radius
                )
            })
        })

        expect(failures).toEqual([])
    })
})

function isNearArcEndpoint(arc: Arc, angle: number): boolean {
    return [arc.startAngle, arc.startAngle + arc.sweep].some((endpoint) =>
        isAngleInsideArc({
            angle,
            startAngle: endpoint,
            sweep: 0,
            angularTolerance: 1e-6,
        }),
    )
}

const arcCases = Array.from({ length: 2000 }, () => ({
    line: createLine(randomPoint(), randomPoint()),
    arc: createArc({
        center: randomPoint(),
        radius: random.magnitude(0, 4),
        startAngle: random.between(-10, 10),
        sweep: random.sign() * random.between(1e-3, FULL_TURN - 1e-3),
    }),
}))

describe('line-arc intersection properties (fixed seed)', () => {
    it('returns exactly the circle hits inside the sweep, away from its endpoints', () => {
        const failures = arcCases.flatMap(({ line, arc }) => {
            const operand: LineOperand = { line, domain: 'infinite' }
            const arcHits = intersectLineArc(operand, {
                arc,
                angularTolerance: 1e-9,
            })
            const circleHits = lineCircleIntersections(
                operand,
                createCircle(arc.center, arc.radius),
            )

            return circleHits.filter(({ point, direction }) => {
                const angle = Math.atan2(direction.y, direction.x)
                const inside = isAngleInsideArc({
                    angle,
                    startAngle: arc.startAngle,
                    sweep: arc.sweep,
                    angularTolerance: 0,
                })
                const returned = arcHits.some(
                    (hit) => hit.x === point.x && hit.y === point.y,
                )

                return !isNearArcEndpoint(arc, angle) && inside !== returned
            })
        })

        expect(failures).toEqual([])
    })
})
