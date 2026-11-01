import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN } from './angle'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type Circle,
    type Line,
} from './curve'
import { intersectCurves } from './curve-intersection'
import { extractCurve } from './curve-piece'
import { splitCurve } from './curve-split'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { type Vector2 } from './vector'

const modelTolerance = { distance: 1e-7 }
const random = seededRandom(20261101)

function analyticPoint(curve: Line | Arc | Circle, parameter: number): Vector2 {
    if (curve.type === 'line') {
        return {
            x: curve.start.x + (curve.end.x - curve.start.x) * parameter,
            y: curve.start.y + (curve.end.y - curve.start.y) * parameter,
        }
    }

    const angle =
        curve.type === 'circle'
            ? FULL_TURN * parameter
            : curve.startAngle + curve.sweep * parameter

    return {
        x: curve.center.x + curve.radius * Math.cos(angle),
        y: curve.center.y + curve.radius * Math.sin(angle),
    }
}

function expectPoint(actual: Vector2, expected: Vector2): void {
    expect(
        Math.hypot(actual.x - expected.x, actual.y - expected.y),
    ).toBeLessThan(1e-7)
}

const cases = Array.from({ length: 160 }, () => {
    const radius = random.magnitude(0, 3)
    const arc = createArc({
        center: { x: random.between(-1e6, 1e6), y: random.between(-1e6, 1e6) },
        radius,
        startAngle: random.between(0, FULL_TURN),
        sweep: random.sign() * random.between(0.1, FULL_TURN - 0.1),
    })
    const start = analyticPoint(arc, 0)
    const end = analyticPoint(arc, 1)
    const line = createLine({ x: start.x - radius, y: start.y - radius }, start)
    const following = createLine(end, { x: end.x + radius, y: end.y - radius })
    const open = createPolyline(
        { segments: [line, arc, following], closed: false },
        modelTolerance,
    )
    const closed = createPolyline(
        { segments: [arc, createLine(end, start)], closed: true },
        modelTolerance,
    )

    return {
        arc,
        line,
        open,
        closed,
        first: random.between(0.1, 0.4),
        second: random.between(0.6, 0.9),
    }
})

function checkPrimitivePieces(fixture: (typeof cases)[number]): void {
    const { arc, line, first, second } = fixture

    for (const source of [line, arc]) {
        const pieces = splitCurve(source, {
            locations: [{ parameter: second }, { parameter: first }],
            modelTolerance,
        })
        const parameters = [0, first, second, 1]

        expect(
            pieces.reduce((total, piece) => total + curveLength(piece), 0) /
                curveLength(source),
        ).toBeCloseTo(1, 11)

        for (const [index, piece] of pieces.entries()) {
            const start = parameters[index]!
            const end = parameters[index + 1]!

            expect(curveLength(piece)).toBeGreaterThan(0)
            expectPoint(
                evaluateCurve(piece, { parameter: 0.37 }).point,
                analyticPoint(source, start + 0.37 * (end - start)),
            )
        }
    }
}

describe('seeded curve pieces', () => {
    it('matches analytic evaluation and conserves primitive length on 160 signed fixtures', () => {
        cases.forEach(checkPrimitivePieces)
    })

    it('conserves mixed polyline length and retains the closed complement', () => {
        for (const { open, closed, first, second } of cases) {
            const locations = [
                { segmentIndex: 0, parameter: first },
                { segmentIndex: 1, parameter: second },
                { segmentIndex: 2, parameter: first },
            ]
            const pieces = splitCurve(open, { locations, modelTolerance })
            const interval = {
                start: { segmentIndex: 0, parameter: first },
                end: { segmentIndex: 0, parameter: second },
                modelTolerance,
            }
            const removed = extractCurve(closed, interval)
            const retained = extractCurve(closed, {
                ...interval,
                start: interval.end,
                end: interval.start,
            })

            expect(pieces).toHaveLength(4)
            expect(
                pieces.reduce((total, piece) => total + curveLength(piece), 0) /
                    curveLength(open),
            ).toBeCloseTo(1, 11)
            expect(retained).toMatchObject({ type: 'polyline', closed: false })
            expect(
                (curveLength(removed) + curveLength(retained)) /
                    curveLength(closed),
            ).toBeCloseTo(1, 11)
        }
    })

    it('extracts complementary circle arcs with analytic endpoints', () => {
        for (const { arc, first, second } of cases) {
            const circle = createCircle(arc.center, arc.radius)
            const forward = extractCurve(circle, {
                start: { parameter: first },
                end: { parameter: second },
                modelTolerance,
            })
            const wrapped = extractCurve(circle, {
                start: { parameter: second },
                end: { parameter: first },
                modelTolerance,
            })

            expect(
                (curveLength(forward) + curveLength(wrapped)) /
                    curveLength(circle),
            ).toBeCloseTo(1, 13)
            expectPoint(
                evaluateCurve(wrapped, { parameter: 0.37 }).point,
                analyticPoint(circle, second + 0.37 * (1 - second + first)),
            )
        }
    })

    it('consumes joint-owned intersections without adding or snapping geometry', () => {
        for (const { open, line, arc } of cases) {
            const probe = createLine(
                { x: line.end.x, y: line.end.y - 2 * arc.radius },
                { x: line.end.x, y: line.end.y + 2 * arc.radius },
            )
            const hits = intersectCurves({
                first: open,
                second: probe,
                angularTolerance: 1e-10,
                modelTolerance,
            }).hits
            const joint = hits.find(
                (hit) =>
                    hit.first.segmentIndex === 0 && hit.first.parameter === 1,
            )

            expect(joint).toBeDefined()

            const pieces = splitCurve(open, {
                locations: [joint!.first],
                modelTolerance,
            })

            expect(pieces).toEqual([
                createPolyline(
                    { segments: [line], closed: false },
                    modelTolerance,
                ),
                createPolyline(
                    { segments: open.segments.slice(1), closed: false },
                    modelTolerance,
                ),
            ])
        }
    })
})
