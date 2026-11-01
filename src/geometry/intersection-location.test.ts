import { describe, expect, it } from 'vitest'
import { createLine } from './curve'
import { rationalLocation } from './intersection-location'
import { intersectLineSegments } from './line-intersection'

describe('located finite-line intersections', () => {
    it('reports both parameters and exact endpoint identities', () => {
        const first = createLine({ x: 0, y: 0 }, { x: 4, y: 0 })
        const second = createLine({ x: 1, y: -2 }, { x: 1, y: 2 })

        expect(intersectLineSegments(first, second)).toEqual({
            kind: 'point',
            point: { x: 1, y: 0 },
            first: { parameter: 0.25 },
            second: { parameter: 0.5 },
        })
        expect(
            intersectLineSegments(
                first,
                createLine({ x: 4, y: 0 }, { x: 4, y: 1 }),
            ),
        ).toEqual({
            kind: 'point',
            point: { x: 4, y: 0 },
            first: { parameter: 1, endpoint: 'end' },
            second: { parameter: 0, endpoint: 'start' },
        })
    })

    it('retains an interior identity when point and parameter round to the start', () => {
        const first = createLine({ x: 0, y: 0 }, { x: 1e15, y: 0 })
        const second = createLine(
            { x: 0, y: -Number.MIN_VALUE },
            { x: 1, y: 2 },
        )

        expect(intersectLineSegments(first, second)).toEqual({
            kind: 'point',
            point: { x: 0, y: 0 },
            first: { parameter: 0 },
            second: { parameter: 0 },
        })
    })

    it('preserves misses and coincident-support flags', () => {
        const first = createLine({ x: 0, y: 0 }, { x: 1, y: 0 })

        expect(
            intersectLineSegments(
                first,
                createLine({ x: 2, y: -1 }, { x: 2, y: 1 }),
            ),
        ).toEqual({ kind: 'none' })
        expect(
            intersectLineSegments(
                first,
                createLine({ x: 2, y: 0 }, { x: 3, y: 0 }),
            ),
        ).toEqual({ kind: 'coincident' })
    })

    it('validates the exact rational before identifying an endpoint', () => {
        expect(rationalLocation({ numerator: 1n, denominator: 3n })).toEqual({
            parameter: 1 / 3,
        })

        for (const input of [
            { numerator: -1n, denominator: 2n },
            { numerator: 3n, denominator: 2n },
            { numerator: 1n, denominator: 0n },
        ]) {
            expect(() => rationalLocation(input)).toThrow(RangeError)
        }
    })
})
