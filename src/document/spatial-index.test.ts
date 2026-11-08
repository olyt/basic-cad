import { describe, expect, it } from 'vitest'
import { type BoundingBox } from '../geometry/bounds'
import { createCircle, MAX_COORDINATE } from '../geometry/curve'
import {
    all,
    brute,
    document,
    empty,
    freeze,
    pointQuery,
    queries,
} from '../test-support/spatial-cases'
import { createSpatialIndex } from './spatial-index'

describe('snapshot spatial index', () => {
    it('copies the source and returns every layer once in document order with fresh result arrays', () => {
        const index = createSpatialIndex(freeze(document))
        const ids = index.query(all)

        expect(index.document).toEqual(document)
        expect(index.document).not.toBe(document)
        expect(index.document.entities).not.toBe(document.entities)
        expect(ids).toEqual(document.entities.map(({ id }) => id))
        ids.reverse()
        ids.length = 0
        expect(index.query(all)).toEqual(document.entities.map(({ id }) => id))
        expect(createSpatialIndex(empty).query(all)).toEqual([])

        for (const query of queries) {
            expect(index.query(query)).toEqual(brute(document, query))
        }
    })

    it('includes edge/corner and degenerate queries as bounds candidates beyond the stored coordinate cap', () => {
        const limit = MAX_COORDINATE
        const geometry = createCircle({ x: limit, y: 0 }, limit)
        const index = createSpatialIndex({
            ...document,
            entities: [{ ...document.entities[0]!, geometry }],
        })
        const boxes = [
            pointQuery(limit, 0),
            pointQuery(limit * 2, limit),
            {
                min: { x: limit * 2, y: -limit },
                max: { x: limit * 2, y: limit },
            },
            { min: { x: 0, y: limit }, max: { x: limit * 2, y: limit } },
        ]

        for (const box of boxes) {
            expect(index.query(box)).toEqual([document.entities[0]!.id])
        }

        expect(index.query(pointQuery(limit * 2 + 1, 0))).toEqual([])
    })

    it('rejects malformed, nonfinite and reversed boxes even for an empty index', () => {
        const invalid: unknown[] = [
            null,
            {},
            { min: { x: 0, y: 0 } },
            { min: { x: 2, y: 0 }, max: { x: 1, y: 1 } },
            { min: { x: 0, y: 2 }, max: { x: 1, y: 1 } },
        ]

        for (const edge of ['min', 'max']) {
            for (const axis of ['x', 'y']) {
                for (const value of [
                    NaN,
                    Infinity,
                    -Infinity,
                    undefined,
                    '0',
                ]) {
                    invalid.push({
                        ...pointQuery(0, 0),
                        [edge]: { x: 0, y: 0, [axis]: value },
                    })
                }
            }
        }

        for (const index of [
            createSpatialIndex(empty),
            createSpatialIndex(document),
        ]) {
            for (const query of invalid) {
                expect(() => index.query(query as BoundingBox)).toThrow(
                    RangeError,
                )
            }
        }
    })
})
