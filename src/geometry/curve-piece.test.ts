import { describe, expect, it } from 'vitest'
import { createArc, createCircle, createLine, type Polyline } from './curve'
import { extractCurve } from './curve-piece'
import { type CurveLocation } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

const modelTolerance = { distance: 0.01 }
const location = (segmentIndex: number, parameter: number) => ({
    segmentIndex,
    parameter,
})
const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
]
const segments = points
    .slice(1)
    .map((point, index) => createLine(points[index]!, point))
const square = createPolyline({ segments, closed: true }, modelTolerance)
const piece = (
    polyline: Polyline,
    [start, end]: readonly [CurveLocation, CurveLocation],
) => extractCurve(polyline, { start, end, modelTolerance })

describe('curve interval extraction', () => {
    it('exposes primitive pieces with strict location validation', () => {
        expect(
            extractCurve(segments[0]!, {
                start: { parameter: 0.25 },
                end: { parameter: 0.75 },
                modelTolerance,
            }),
        ).toEqual(createLine({ x: 2.5, y: 0 }, { x: 7.5, y: 0 }))
        expect(
            extractCurve(createCircle(points[0]!, 1), {
                start: { parameter: -0.25 },
                end: { parameter: 0.25 },
                modelTolerance,
            }),
        ).toMatchObject({ type: 'arc', sweep: Math.PI })
        expect(() =>
            extractCurve(segments[0]!, {
                start: location(0, 0),
                end: { parameter: 1 },
                modelTolerance,
            }),
        ).toThrow('segment index')
    })

    it('extracts a mixed open path without changing untouched segments', () => {
        const arc = createArc({
            center: { x: 10, y: 5 },
            radius: 5,
            startAngle: -Math.PI / 2,
            sweep: Math.PI / 2,
        })
        const end = segmentEndpoints(arc).end
        const following = createLine(end, { x: 20, y: 5 })
        const path = createPolyline(
            { segments: [segments[0]!, arc, following], closed: false },
            modelTolerance,
        )
        const result = piece(path, [location(0, 0.5), location(2, 0.5)])

        expect(result).toEqual(
            createPolyline(
                {
                    segments: [
                        createLine({ x: 5, y: 0 }, { x: 10, y: 0 }),
                        arc,
                        createLine(end, { x: 17.5, y: 5 }),
                    ],
                    closed: false,
                },
                modelTolerance,
            ),
        )
        expect(path.segments[0]).toEqual(segments[0])
    })

    it('preserves admitted gaps and treats the two joint locations as aliases', () => {
        const following = createLine({ x: 10.005, y: 0 }, { x: 20, y: 0 })
        const path = createPolyline(
            { segments: [segments[0]!, following], closed: false },
            modelTolerance,
        )

        expect(piece(path, [location(0, 1), location(1, 1)])).toEqual(
            createPolyline(
                { segments: [following], closed: false },
                modelTolerance,
            ),
        )
        expect(piece(path, [location(1, 0), location(1, 1)])).toEqual(
            piece(path, [location(0, 1), location(1, 1)]),
        )
        expect(
            curveLength(piece(path, [location(0, 0), location(1, 1)])),
        ).toBeCloseTo(19.995, 12)
        expect(() => piece(path, [location(0, 1), location(1, 0)])).toThrow(
            'nonempty',
        )
    })

    it('keeps a closed path outside a gap as one open polyline across the seam', () => {
        const result = piece(square, [location(1, 0.75), location(1, 0.25)])

        expect(result).toEqual(
            createPolyline(
                {
                    segments: [
                        createLine({ x: 10, y: 7.5 }, { x: 10, y: 10 }),
                        segments[2]!,
                        segments[3]!,
                        segments[0]!,
                        createLine({ x: 10, y: 0 }, { x: 10, y: 2.5 }),
                    ],
                    closed: false,
                },
                modelTolerance,
            ),
        )
        expect(curveLength(result)).toBe(35)
    })

    it('recognizes both closed-seam aliases and rejects a full loop as an interval', () => {
        expect(piece(square, [location(3, 1), location(1, 1)])).toEqual(
            piece(square, [location(0, 0), location(1, 1)]),
        )
        expect(piece(square, [location(2, 0), location(0, 0)])).toEqual(
            piece(square, [location(1, 1), location(3, 1)]),
        )
        expect(() => piece(square, [location(3, 1), location(0, 0)])).toThrow(
            'nonempty',
        )
    })

    it('retains a polyline type for a single extracted segment', () => {
        expect(
            piece(square, [location(2, 0.25), location(2, 0.75)]),
        ).toMatchObject({
            type: 'polyline',
            closed: false,
            segments: [expect.objectContaining({ type: 'line' })],
        })
    })

    it('validates the whole source before discarding any portion', () => {
        const disconnected = {
            ...square,
            segments: [segments[0]!, segments[2]!],
        }

        expect(() =>
            piece(disconnected, [location(0, 0), location(0, 0.5)]),
        ).toThrow('connect')
    })

    it.each([undefined, -1, 0.5, 4, NaN, Infinity])(
        'rejects polyline segment index %s',
        (segmentIndex) => {
            expect(() =>
                extractCurve(square, {
                    start: { segmentIndex, parameter: 0.5 },
                    end: location(2, 1),
                    modelTolerance,
                }),
            ).toThrow(RangeError)
        },
    )

    it('rejects an open reversed interval and a missing primitive index value', () => {
        const open = createPolyline({ segments, closed: false }, modelTolerance)

        expect(() => piece(open, [location(3, 0.5), location(0, 0.5)])).toThrow(
            'stored direction',
        )
        expect(() =>
            extractCurve(segments[0]!, {
                start: { segmentIndex: undefined, parameter: 0 },
                end: { parameter: 1 },
                modelTolerance,
            }),
        ).toThrow('segment index')
    })
})
