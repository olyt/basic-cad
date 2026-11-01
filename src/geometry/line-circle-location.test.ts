import { describe, expect, it } from 'vitest'
import { createCircle, createLine } from './curve'
import { locatedLineCircleIntersections } from './line-circle-intersection'

describe('located line-circle roots', () => {
    it('reports parameters and distinguishes exact endpoints from interior roots', () => {
        const circle = createCircle({ x: 0, y: 0 }, 1)
        const line = createLine({ x: -1, y: 0 }, { x: 3, y: 0 })
        const hits = locatedLineCircleIntersections(line, circle)

        expect(hits.map(({ line }) => line)).toEqual([
            { parameter: 0, endpoint: 'start' },
            { parameter: 0.5 },
        ])
        expect(
            locatedLineCircleIntersections(
                createLine(line.end, line.start),
                circle,
            ).map(({ line }) => line),
        ).toEqual([{ parameter: 0.5 }, { parameter: 1, endpoint: 'end' }])
    })

    it('keeps two distinct roots when world points and line parameters round identically', () => {
        const circle = createCircle({ x: 1e12, y: 1 }, 1)
        const line = createLine(
            { x: 1e12 - 1, y: Number.MIN_VALUE },
            { x: 1e12 + 1, y: Number.MIN_VALUE },
        )
        const hits = locatedLineCircleIntersections(line, circle)

        expect(hits).toHaveLength(2)
        expect(hits.map(({ line }) => line)).toEqual([
            { parameter: 0.5 },
            { parameter: 0.5 },
        ])
        expect(hits[0]!.point).toEqual(hits[1]!.point)
        expect(hits[0]!.direction.x).toBeLessThan(0)
        expect(hits[1]!.direction.x).toBeGreaterThan(0)
    })

    it('does not claim a start endpoint for an underflowed interior parameter', () => {
        const circle = createCircle({ x: 0, y: 1 }, 1)
        const line = createLine(
            { x: 0, y: 0 },
            { x: 1e15, y: Number.MIN_VALUE },
        )

        expect(
            locatedLineCircleIntersections(line, circle).map(
                ({ line }) => line,
            ),
        ).toEqual([{ parameter: 0, endpoint: 'start' }, { parameter: 0 }])
    })

    it('includes tangency only once and rejects roots outside the finite line', () => {
        const circle = createCircle({ x: 0, y: 0 }, 1)

        expect(
            locatedLineCircleIntersections(
                createLine({ x: -2, y: 1 }, { x: 2, y: 1 }),
                circle,
            ).map(({ line }) => line),
        ).toEqual([{ parameter: 0.5 }])
        expect(
            locatedLineCircleIntersections(
                createLine({ x: 2, y: 0 }, { x: 3, y: 0 }),
                circle,
            ),
        ).toEqual([])
    })
})
