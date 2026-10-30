import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN } from './angle'
import { closestPoint } from './closest'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Circle,
    type Curve,
    type Line,
    type PolylineSegment,
} from './curve'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import type { Vector2 } from './vector'

type Primitive = Line | Circle | Arc

function separation(first: Vector2, second: Vector2): number {
    return Math.hypot(first.x - second.x, first.y - second.y)
}

function analyticSample(curve: Primitive, parameter: number) {
    if (curve.type === 'line') {
        const x = curve.end.x - curve.start.x
        const y = curve.end.y - curve.start.y
        const length = Math.hypot(x, y)

        return {
            point: {
                x: curve.start.x + x * parameter,
                y: curve.start.y + y * parameter,
            },
            tangent: { x: x / length, y: y / length },
        }
    }

    const angle =
        curve.type === 'circle'
            ? FULL_TURN * parameter
            : curve.startAngle + curve.sweep * parameter
    const sign = curve.type === 'circle' ? 1 : Math.sign(curve.sweep)

    return {
        point: {
            x: curve.center.x + curve.radius * Math.cos(angle),
            y: curve.center.y + curve.radius * Math.sin(angle),
        },
        tangent: { x: -sign * Math.sin(angle), y: sign * Math.cos(angle) },
    }
}

const random = seededRandom(20261025)
const cases = Array.from({ length: 180 }, (_, index) => {
    const size = random.magnitude(-2, 3)
    const center = {
        x: size * random.between(-10, 10),
        y: size * random.between(-10, 10),
    }
    const arc = createArc({
        center,
        radius: size * random.between(0.2, 3),
        startAngle: random.between(-10, 10),
        sweep: random.sign() * random.between(0.05, FULL_TURN - 0.05),
    })
    const start = analyticSample(arc, 0).point
    const end = analyticSample(arc, 1).point
    const line = createLine({ x: start.x - size, y: start.y - size / 2 }, start)
    const gap = size / 1000
    const following = createLine(
        { x: end.x + gap, y: end.y },
        { x: end.x + size, y: end.y + size },
    )
    const closed = index % 2 === 0
    const segments = closed
        ? [arc, createLine(end, start)]
        : [line, arc, following]
    const polyline = createPolyline(
        { segments, closed },
        { distance: gap * 1.01 },
    )

    return {
        primitives: [line, createCircle(center, arc.radius), arc] as const,
        polyline,
        parameter: random.between(0, 1),
        turns: random.between(-4, 4),
        query: {
            x: center.x + size * random.between(-4, 4),
            y: center.y + size * random.between(-4, 4),
        },
        factor: random.magnitude(-2, 2),
        budget: size * 1e-10,
    }
})

function analyticLength(curve: Curve): number {
    if (curve.type === 'line') {
        return separation(curve.start, curve.end)
    }

    if (curve.type === 'polyline') {
        return curve.segments.reduce(
            (sum, segment) => sum + analyticLength(segment),
            0,
        )
    }

    return (
        curve.radius *
        (curve.type === 'circle' ? FULL_TURN : Math.abs(curve.sweep))
    )
}

function scaledCurve(curve: PolylineSegment, factor: number): PolylineSegment
function scaledCurve(curve: Curve, factor: number): Curve

function scaledCurve(curve: Curve, factor: number): Curve {
    const point = (value: Vector2) => ({
        x: value.x * factor,
        y: value.y * factor,
    })

    if (curve.type === 'line') {
        return { ...curve, start: point(curve.start), end: point(curve.end) }
    }

    if (curve.type === 'polyline') {
        return {
            ...curve,
            segments: curve.segments.map((segment) =>
                scaledCurve(segment, factor),
            ),
        }
    }

    return {
        ...curve,
        center: point(curve.center),
        radius: curve.radius * factor,
    }
}

function sampledDistance(curve: Curve, query: Vector2): number {
    const segments = curve.type === 'polyline' ? curve.segments : [curve]
    let nearest = Infinity

    for (const segment of segments) {
        for (let step = 0; step <= 256; step++) {
            const point = analyticSample(segment, step / 256).point

            nearest = Math.min(nearest, separation(point, query))
        }
    }

    return nearest
}

describe('curve query properties (fixed seed)', () => {
    it('matches independent evaluation formulas and oriented unit tangents', () => {
        for (const fixture of cases) {
            for (const curve of fixture.primitives) {
                const parameter =
                    curve.type === 'circle' ? fixture.turns : fixture.parameter
                const expected = analyticSample(curve, parameter)
                const actual = evaluateCurve(curve, { parameter })

                expect(
                    separation(actual.point, expected.point),
                ).toBeLessThanOrEqual(fixture.budget)
                expect(
                    separation(actual.tangent, expected.tangent),
                ).toBeLessThan(1e-12)
                expect(
                    Math.hypot(actual.tangent.x, actual.tangent.y),
                ).toBeCloseTo(1, 13)
            }

            const circle = fixture.primitives[1]
            const periodic = evaluateCurve(circle, {
                parameter: fixture.turns + 3,
            }).point
            const original = evaluateCurve(circle, {
                parameter: fixture.turns,
            }).point

            expect(separation(periodic, original)).toBeLessThanOrEqual(
                fixture.budget,
            )
        }
    })

    it('measures actual segments and scales lengths linearly', () => {
        for (const fixture of cases) {
            for (const curve of [...fixture.primitives, fixture.polyline]) {
                const length = curveLength(curve)
                const scaled = curveLength(scaledCurve(curve, fixture.factor))

                expect(
                    Math.abs(length - analyticLength(curve)),
                ).toBeLessThanOrEqual(fixture.budget)
                expect(
                    Math.abs(scaled - fixture.factor * length),
                ).toBeLessThanOrEqual(fixture.budget * fixture.factor)
            }
        }
    })

    it('returns on-curve locations no worse than independently sampled geometry', () => {
        for (const fixture of cases) {
            for (const curve of [...fixture.primitives, fixture.polyline]) {
                const result = closestPoint(curve, fixture.query)
                const selected =
                    curve.type === 'polyline'
                        ? curve.segments[result.location.segmentIndex ?? -1]
                        : curve

                if (!selected) {
                    throw new Error(
                        `Invalid closest location: ${JSON.stringify(result.location)}`,
                    )
                }

                const expected = analyticSample(
                    selected,
                    result.location.parameter,
                ).point

                expect(separation(result.point, expected)).toBeLessThanOrEqual(
                    fixture.budget,
                )
                expect(evaluateCurve(curve, result.location).point).toEqual(
                    result.point,
                )
                expect(result.distance).toBe(
                    separation(result.point, fixture.query),
                )
                expect(result.distance).toBeLessThanOrEqual(
                    sampledDistance(curve, fixture.query) + fixture.budget,
                )
            }
        }
    })
})
