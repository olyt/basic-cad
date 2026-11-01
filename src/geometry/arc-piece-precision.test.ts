import { describe, expect, it } from 'vitest'
import { bulgeToSegment } from './bulge'
import { createArc, createCircle, MAX_COORDINATE } from './curve'
import { splitCurve } from './curve-split'
import { evaluateCurve } from './evaluation'
import { curveLength } from './length'
import { primitivePiece } from './primitive-piece'

const center = { x: 0, y: 0 }
const exact = { distance: 0 }

describe('arc-piece precision budgets', () => {
    it('pins the inclusive 1e-8 relative boundary using exact binary angles', () => {
        const source = createArc({ center, radius: 1, startAngle: 1, sweep: 1 })
        const step = 2 ** -54
        const interval = {
            start: step,
            end: 100_000_001 * step,
            modelTolerance: exact,
        }

        expect(primitivePiece(source, interval)).toMatchObject({
            startAngle: 1,
            sweep: 100_000_000 * step,
        })
        expect(() =>
            primitivePiece(source, { ...interval, end: 100_000_000 * step }),
        ).toThrow('cannot preserve')
    })

    it('pins the quarter-tolerance positional allowance independently of the relative budget', () => {
        const source = createArc({
            center,
            radius: 1e6,
            startAngle: 1,
            sweep: 1,
        })
        const step = 2 ** -54
        const interval = {
            start: step,
            end: 101 * step,
            modelTolerance: { distance: 4e6 * step },
        }

        expect(primitivePiece(source, interval)).toMatchObject({
            startAngle: 1,
            sweep: 100 * step,
        })
        expect(() =>
            primitivePiece(source, {
                ...interval,
                modelTolerance: {
                    distance:
                        interval.modelTolerance.distance * (1 - Number.EPSILON),
                },
            }),
        ).toThrow('cannot preserve')
        expect(() =>
            primitivePiece(source, { ...interval, modelTolerance: exact }),
        ).toThrow('cannot preserve')
    })

    it.each([-1, 1])(
        'splits a short large-radius arc with sweep sign %s',
        (sign) => {
            const source = createArc({
                center,
                radius: 1e6,
                startAngle: 0.7,
                sweep: sign * 2e-8,
            })
            const pieces = splitCurve(source, {
                locations: [{ parameter: 0.5 }],
                modelTolerance: { distance: 1e-7 },
            })

            expect(pieces).toHaveLength(2)
            expect(pieces.map(curveLength)).toEqual([0.01, 0.01])

            const actual = evaluateCurve(pieces[1]!, { parameter: 0 }).point
            const expected = evaluateCurve(source, { parameter: 0.5 }).point

            expect(
                Math.hypot(actual.x - expected.x, actual.y - expected.y),
            ).toBeLessThan(1e-9)
        },
    )

    it.each([1e-8, -1e-8, 1e-7, -1e-7])(
        'splits shallow bulge %s when its positional error fits',
        (bulge) => {
            const source = bulgeToSegment({
                start: center,
                end: { x: 0.01, y: 0.001 },
                bulge,
            })

            expect(source.type).toBe('arc')
            expect(
                splitCurve(source, {
                    locations: [{ parameter: 0.5 }],
                    modelTolerance: { distance: 1e-7 },
                }),
            ).toHaveLength(2)
        },
    )

    it('normalizes a rounded circle start from just below a full turn to zero', () => {
        expect(
            primitivePiece(createCircle(center, 1), {
                start: -1e-18,
                end: 0.25,
                modelTolerance: exact,
            }),
        ).toMatchObject({ startAngle: 0, sweep: Math.PI / 2 })
    })

    it('rejects subnormal sweep rounding beyond the relative budget', () => {
        const source = createArc({
            center,
            radius: MAX_COORDINATE,
            startAngle: 0,
            sweep: 3 * Number.MIN_VALUE,
        })

        expect(() =>
            primitivePiece(source, {
                start: 0,
                end: 0.5,
                modelTolerance: exact,
            }),
        ).toThrow('cannot preserve')
    })

    it('rejects an arc piece whose positive analytic length underflows', () => {
        const source = createArc({
            center,
            radius: Number.MIN_VALUE,
            startAngle: 0,
            sweep: 1,
        })

        expect(() =>
            primitivePiece(source, {
                start: 0,
                end: 0.5,
                modelTolerance: exact,
            }),
        ).toThrow('positive finite range')
    })

    it('charges start and sweep error together without underflowing the comparison', () => {
        const source = createArc({
            center,
            radius: 1,
            startAngle: 1,
            sweep: 3 * Number.MIN_VALUE,
        })
        const interval = {
            start: 0.5,
            end: 1,
            modelTolerance: { distance: 8 * Number.MIN_VALUE },
        }

        expect(primitivePiece(source, interval)).toMatchObject({
            startAngle: 1,
            sweep: 2 * Number.MIN_VALUE,
        })
        expect(() =>
            primitivePiece(source, {
                ...interval,
                modelTolerance: { distance: 7 * Number.MIN_VALUE },
            }),
        ).toThrow('cannot preserve')
    })
})
