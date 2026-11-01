import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { bulgeToSegment } from './bulge'
import { createArc, createLine } from './curve'
import { intersectCurves } from './curve-intersection'
import { extractCurve } from './curve-piece'
import { splitCurve } from './curve-split'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

const modelTolerance = { distance: 1e-7 }
const arc = createArc({
    center: { x: 0, y: 0 },
    radius: 10,
    startAngle: 0.7,
    sweep: 1,
})
const { start, end } = segmentEndpoints(arc)
const line = createLine(end, { x: end.x + 5, y: end.y })

describe('cuts near free endpoints', () => {
    it('resolves the endpoint-snapped arc/line example on both operands', () => {
        const { hits } = intersectCurves({
            first: arc,
            second: line,
            angularTolerance: 1e-10,
            modelTolerance,
        })
        const shared = hits.find(({ first }) => first.parameter > 0.99)!

        expect(shared.first.parameter).toBeLessThan(1)
        expect(shared.second.parameter).toBeGreaterThan(0)
        expect(
            splitCurve(arc, { locations: [shared.first], modelTolerance }),
        ).toEqual([arc])
        expect(
            splitCurve(line, { locations: [shared.second], modelTolerance }),
        ).toEqual([line])

        for (const [source, locations] of [
            [arc, hits.map((hit) => hit.first)],
            [line, hits.map((hit) => hit.second)],
        ] as const) {
            const pieces = splitCurve(source, { locations, modelTolerance })

            expect(pieces).toHaveLength(2)
            expect(
                pieces.every(
                    (piece) => curveLength(piece) > modelTolerance.distance,
                ),
            ).toBe(true)
        }
    })

    it('handles an arc at a polyline free end without changing its geometry', () => {
        const path = createPolyline(
            {
                segments: [
                    createLine({ x: start.x - 5, y: start.y }, start),
                    arc,
                ],
                closed: false,
            },
            modelTolerance,
        )
        const { hits } = intersectCurves({
            first: path,
            second: line,
            angularTolerance: 1e-10,
            modelTolerance,
        })
        const shared = hits.find(
            ({ first }) => first.segmentIndex === 1 && first.parameter > 0.99,
        )!

        expect(
            splitCurve(path, { locations: [shared.first], modelTolerance }),
        ).toEqual([path])
    })

    it('uses an inclusive traversal-distance budget and preserves zero-tolerance cuts', () => {
        const source = createLine({ x: 0, y: 0 }, { x: 8, y: 0 })
        const tolerance = { distance: 0.125 }

        expect(
            splitCurve(source, {
                locations: [{ parameter: 1 / 64 }, { parameter: 63 / 64 }],
                modelTolerance: tolerance,
            }),
        ).toEqual([source])
        expect(
            splitCurve(source, {
                locations: [{ parameter: 1 / 64 + Number.EPSILON }],
                modelTolerance: tolerance,
            }),
        ).toHaveLength(2)
        expect(
            splitCurve(source, {
                locations: [{ parameter: 1e-10 }],
                modelTolerance: { distance: 0 },
            }),
        ).toHaveLength(2)
    })

    it('does not confuse the spatially close ends of a near-full arc', () => {
        const source = createArc({
            center: { x: 0, y: 0 },
            radius: 1,
            startAngle: 0,
            sweep: FULL_TURN - 1e-9,
        })

        expect(
            splitCurve(source, {
                locations: [{ parameter: 0.5 }],
                modelTolerance,
            }),
        ).toHaveLength(2)
        expect(
            splitCurve(source, {
                locations: [{ parameter: 1 - 1e-10 }],
                modelTolerance,
            }),
        ).toEqual([source])
    })

    it('keeps ambiguous short sources and close interior cuts strict', () => {
        const source = createLine({ x: 0, y: 0 }, { x: 1e-8, y: 0 })
        const pieces = splitCurve(source, {
            locations: [{ parameter: 0.25 }, { parameter: 0.25001 }],
            modelTolerance,
        })

        expect(pieces).toHaveLength(3)
        expect(curveLength(pieces[1]!)).toBeGreaterThan(0)
    })

    it('applies the same endpoint policy when extracting an open interval', () => {
        expect(
            extractCurve(arc, {
                start: { parameter: 0 },
                end: { parameter: 1 - 1e-15 },
                modelTolerance,
            }),
        ).toEqual(arc)
        expect(() =>
            extractCurve(arc, {
                start: { parameter: 1 - 1e-15 },
                end: { parameter: 1 },
                modelTolerance,
            }),
        ).toThrow('nonempty')
    })

    it('ignores multiple cuts resolved to the same free endpoint', () => {
        expect(
            splitCurve(line, {
                locations: [
                    { parameter: 0 },
                    { parameter: 1e-15 },
                    { parameter: 1e-15 },
                ],
                modelTolerance,
            }),
        ).toEqual([line])
    })

    it('rejects a near-limit joint if rounded arc reconstruction exceeds admission tolerance', () => {
        const source = createArc({
            center: { x: 0, y: 0 },
            radius: 602686.3584294915,
            startAngle: 1.8478675112128258,
            sweep: 0.7611071344465017,
        })
        const lineStart = { x: -519202.6206826397, y: 306038.3722887976 }
        const path = createPolyline(
            {
                segments: [
                    source,
                    createLine(lineStart, {
                        x: lineStart.x + 10,
                        y: lineStart.y + 10,
                    }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const original = structuredClone(path)

        expect(() =>
            splitCurve(path, {
                locations: [{ segmentIndex: 0, parameter: 0.5 }],
                modelTolerance,
            }),
        ).toThrow('connect')
        expect(path).toEqual(original)
    })
})

describe('lines snapped to internal polyline vertices', () => {
    const bulged = bulgeToSegment({
        start: { x: 10, y: 0 },
        end: { x: 20, y: 0 },
        bulge: 0.3,
    })
    const vertices = segmentEndpoints(bulged)
    const path = createPolyline(
        {
            segments: [
                createLine({ x: 0, y: 0 }, { x: 10, y: 0 }),
                bulged,
                createLine({ x: 20, y: 0 }, { x: 30, y: 5 }),
            ],
            closed: false,
        },
        modelTolerance,
    )

    it.each([
        {
            joint: 'arc start',
            vertex: vertices.start,
            angle: -Math.PI / 4,
            owner: 0,
        },
        {
            joint: 'arc end',
            vertex: vertices.end,
            angle: Math.PI / 6,
            owner: 1,
        },
    ] as const)(
        'cuts at the $joint joint instead of a rounded fragment',
        ({ vertex, angle, owner }) => {
            const query = {
                first: path,
                second: createLine(vertex, {
                    x: vertex.x + 5 * Math.cos(angle),
                    y: vertex.y + 5 * Math.sin(angle),
                }),
                angularTolerance: 1e-10,
                modelTolerance,
            }
            const strict = intersectCurves({
                ...query,
                modelTolerance: { distance: 0 },
            }).hits
            const { hits } = intersectCurves(query)

            expect(strict).toHaveLength(1)
            expect(strict[0]!.first.parameter).toBeGreaterThan(0)
            expect(strict[0]!.first.parameter).toBeLessThan(1)
            expect(hits).toEqual([
                {
                    ...strict[0]!,
                    first: { segmentIndex: owner, parameter: 1 },
                },
            ])
            expect(
                splitCurve(path, {
                    locations: [hits[0]!.first],
                    modelTolerance,
                }),
            ).toEqual([
                createPolyline(
                    {
                        segments: path.segments.slice(0, owner + 1),
                        closed: false,
                    },
                    modelTolerance,
                ),
                createPolyline(
                    { segments: path.segments.slice(owner + 1), closed: false },
                    modelTolerance,
                ),
            ])
        },
    )
})
