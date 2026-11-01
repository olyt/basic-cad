import { describe, expect, it } from 'vitest'
import { createArc, createCircle, createLine, type Polyline } from './curve'
import { intersectCurves } from './curve-intersection'
import { extractCurve } from './curve-piece'
import { splitCurve } from './curve-split'
import { curveLength } from './length'
import { createPolyline } from './polyline'

const modelTolerance = { distance: 0.125 }
const line = createLine({ x: 0, y: 0 }, { x: 10, y: 0 })
const following = createLine({ x: 10.05, y: 0 }, { x: 20, y: 0 })
const path = createPolyline(
    { segments: [line, following], closed: false },
    modelTolerance,
)

describe('open curve splitting', () => {
    it('sorts cuts, ignores true endpoints and preserves the input array', () => {
        const locations = Object.freeze([
            { parameter: 0.75 },
            { parameter: 0 },
            { parameter: 0.25 },
            { parameter: 1 },
        ])
        const pieces = splitCurve(line, { locations, modelTolerance })

        expect(pieces).toEqual([
            createLine({ x: 0, y: 0 }, { x: 2.5, y: 0 }),
            createLine({ x: 2.5, y: 0 }, { x: 7.5, y: 0 }),
            createLine({ x: 7.5, y: 0 }, { x: 10, y: 0 }),
        ])
        expect(locations[0]!.parameter).toBe(0.75)
    })

    it.each([-1, 1])('keeps signed arc pieces with direction %s', (sign) => {
        const arc = createArc({
            center: { x: 0, y: 0 },
            radius: 2,
            startAngle: 5,
            sweep: sign * 4,
        })
        const pieces = splitCurve(arc, {
            locations: [{ parameter: 0.25 }, { parameter: 0.75 }],
            modelTolerance,
        })

        expect(pieces.map(curveLength)).toEqual([2, 4, 2])
        expect(pieces).toEqual([
            extractCurve(arc, {
                start: { parameter: 0 },
                end: { parameter: 0.25 },
                modelTolerance,
            }),
            extractCurve(arc, {
                start: { parameter: 0.25 },
                end: { parameter: 0.75 },
                modelTolerance,
            }),
            extractCurve(arc, {
                start: { parameter: 0.75 },
                end: { parameter: 1 },
                modelTolerance,
            }),
        ])
    })

    it('keeps every polyline piece open, retaining gaps and tiny local parameters', () => {
        const large = createPolyline(
            {
                segments: [
                    createLine({ x: -10, y: 0 }, { x: 0, y: 0 }),
                    createLine({ x: 0, y: 0 }, { x: 1e15, y: 0 }),
                ],
                closed: false,
            },
            modelTolerance,
        )
        const pieces = splitCurve(large, {
            locations: [
                { segmentIndex: 1, parameter: 1e-20 },
                { segmentIndex: 0, parameter: 1 },
            ],
            modelTolerance,
        })

        expect(pieces).toHaveLength(3)
        expect(pieces.map(curveLength)[1]).toBeCloseTo(1e-5, 18)
        expect(
            pieces.every((piece) => piece.type === 'polyline' && !piece.closed),
        ).toBe(true)
        expect(
            splitCurve(path, {
                locations: [{ segmentIndex: 1, parameter: 0 }],
                modelTolerance,
            }),
        ).toEqual([
            createPolyline({ segments: [line], closed: false }, modelTolerance),
            createPolyline(
                { segments: [following], closed: false },
                modelTolerance,
            ),
        ])
    })

    it('does not merge nearby interior cuts using the model distance', () => {
        const pieces = splitCurve(line, {
            locations: [{ parameter: 0.5 }, { parameter: 0.500001 }],
            modelTolerance: { distance: 100 },
        })

        expect(pieces).toHaveLength(3)
        expect(curveLength(pieces[1]!)).toBeCloseTo(1e-5, 13)
    })

    it('returns an independent copy when no interior cut is present', () => {
        const pieces = splitCurve(path, { locations: [], modelTolerance })

        expect(pieces).toEqual([path])
        expect(pieces[0]).not.toBe(path)
        expect((pieces[0] as Polyline).segments[0]).not.toBe(path.segments[0])
    })

    it('rejects duplicate numeric cuts and two aliases of one joint', () => {
        expect(() =>
            splitCurve(line, {
                locations: [{ parameter: 0.5 }, { parameter: 0.5 }],
                modelTolerance,
            }),
        ).toThrow('distinct')
        expect(() =>
            splitCurve(path, {
                locations: [
                    { segmentIndex: 0, parameter: 1 },
                    { segmentIndex: 1, parameter: 0 },
                ],
                modelTolerance,
            }),
        ).toThrow('distinct')
    })

    it('rejects distinct algebraic roots that have the same numeric location', () => {
        const source = createLine(
            { x: 1e12 - 1, y: Number.MIN_VALUE },
            { x: 1e12 + 1, y: Number.MIN_VALUE },
        )
        const { hits } = intersectCurves({
            first: source,
            second: createCircle({ x: 1e12, y: 1 }, 1),
            angularTolerance: 0,
            modelTolerance,
        })

        expect(hits).toHaveLength(2)
        expect(hits[0]!.first).toEqual(hits[1]!.first)
        expect(() =>
            splitCurve(source, {
                locations: hits.map((hit) => hit.first),
                modelTolerance,
            }),
        ).toThrow('unresolved')
    })

    it('fails atomically when a nonzero piece rounds to a zero-length line', () => {
        const source = createLine({ x: 1e15 - 1, y: 0 }, { x: 1e15, y: 0 })
        const original = structuredClone(source)

        expect(() =>
            splitCurve(source, {
                locations: [{ parameter: 0.5 }, { parameter: 0.5 + 1e-10 }],
                modelTolerance,
            }),
        ).toThrow('distinct')
        expect(source).toEqual(original)
    })

    it.each([-1, NaN, Infinity, undefined])(
        'requires a valid model tolerance: %s',
        (distance) => {
            const invalid = { distance: distance as number }

            expect(() =>
                splitCurve(line, { locations: [], modelTolerance: invalid }),
            ).toThrow(RangeError)
            expect(() =>
                extractCurve(line, {
                    start: { parameter: 0 },
                    end: { parameter: 1 },
                    modelTolerance: invalid,
                }),
            ).toThrow(RangeError)
        },
    )

    it('directs cyclic curves to interval extraction', () => {
        const closed = createPolyline(
            {
                segments: [line, createLine(line.end, line.start)],
                closed: true,
            },
            modelTolerance,
        )

        for (const source of [closed, createCircle(line.start, 1)]) {
            expect(() =>
                splitCurve(source, { locations: [], modelTolerance }),
            ).toThrow('extractCurve')
        }
    })

    it.each([-1, 1.1, NaN, Infinity])(
        'rejects an invalid cut %s',
        (parameter) => {
            expect(() =>
                splitCurve(line, {
                    locations: [{ parameter }],
                    modelTolerance,
                }),
            ).toThrow(RangeError)
        },
    )
})
