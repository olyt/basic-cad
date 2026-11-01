import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN } from './angle'
import { createArc, createLine } from './curve'
import { intersectCurves } from './curve-intersection'
import { splitCurve } from './curve-split'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

const modelTolerance = { distance: 1e-7 }

describe('endpoint-snapped cuts (fixed seed)', () => {
    it('splits 4,000 arc/line queries without numerical endpoint fragments', () => {
        const random = seededRandom(20261103)
        let sharedHits = 0
        let interiorEndpointHits = 0

        for (let index = 0; index < 4000; index++) {
            const arc = createArc({
                center: {
                    x: random.between(-100, 100),
                    y: random.between(-100, 100),
                },
                radius: random.magnitude(-1, 5),
                startAngle: random.between(0, FULL_TURN),
                sweep: random.sign() * random.between(0.1, FULL_TURN - 0.1),
            })
            const { end } = segmentEndpoints(arc)
            const line = createLine(end, {
                x: end.x + random.magnitude(-1, 3),
                y: end.y,
            })
            const hits = intersectCurves({
                first: arc,
                second: line,
                angularTolerance: 1e-10,
                modelTolerance,
            }).hits
            const nearEndpoint = hits.filter(
                (hit) =>
                    curveLength(arc) * (1 - hit.first.parameter) <=
                    modelTolerance.distance,
            )

            sharedHits += nearEndpoint.length
            interiorEndpointHits += nearEndpoint.filter(
                (hit) => hit.first.parameter < 1,
            ).length

            for (const [source, locations] of [
                [arc, hits.map((hit) => hit.first)],
                [line, hits.map((hit) => hit.second)],
            ] as const) {
                const pieces = splitCurve(source, { locations, modelTolerance })

                expect(
                    pieces.reduce((sum, piece) => sum + curveLength(piece), 0) /
                        curveLength(source),
                ).toBeCloseTo(1, 9)
                expect(
                    pieces.every(
                        (piece) => curveLength(piece) > modelTolerance.distance,
                    ),
                ).toBe(true)
            }
        }

        expect(sharedHits).toBeGreaterThan(1500)
        expect(interiorEndpointHits).toBeGreaterThan(300)
    })

    it('resolves both polyline free ends in 400 translated signed arc queries', () => {
        const random = seededRandom(20261104)
        let endpointHits = 0

        for (let index = 0; index < 400; index++) {
            const arc = createArc({
                center: { x: 1e5, y: -1e5 },
                radius: random.between(1, 100),
                startAngle: random.between(0, FULL_TURN),
                sweep: random.sign() * random.between(0.2, 3),
            })
            const { start, end } = segmentEndpoints(arc)
            const path = createPolyline(
                { segments: [arc], closed: false },
                modelTolerance,
            )
            const endpoint = index % 2 === 0 ? start : end
            const probe = createLine(endpoint, {
                x: endpoint.x + 10,
                y: endpoint.y,
            })
            const hits = intersectCurves({
                first: path,
                second: probe,
                angularTolerance: 1e-10,
                modelTolerance,
            }).hits
            const near = hits.filter(
                (hit) =>
                    Math.min(hit.first.parameter, 1 - hit.first.parameter) *
                        curveLength(arc) <=
                    modelTolerance.distance,
            )

            endpointHits += near.length
            expect(
                splitCurve(path, {
                    locations: near.map((hit) => hit.first),
                    modelTolerance,
                }),
            ).toEqual([path])
        }

        expect(endpointHits).toBeGreaterThan(100)
    })
})
