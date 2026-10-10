import { describe, expect, it } from 'vitest'
import { createModelTolerance, numbersEqual, pointsCoincide } from './tolerance'
import {
    add,
    cross,
    distance,
    dot,
    length,
    normalize,
    perpendicular,
    scale,
    subtract,
    createVector2,
} from './vector'

describe('2D vectors', () => {
    it('adds, subtracts and scales without changing input coordinates', () => {
        const a = Object.freeze(createVector2(3, 4))
        const b = Object.freeze(createVector2(-2, 5))

        expect(add(a, b)).toEqual(createVector2(1, 9))
        expect(subtract(a, b)).toEqual(createVector2(5, -1))
        expect(subtract(add(a, b), b)).toEqual(a)
        expect(scale(a, -2)).toEqual(createVector2(-6, -8))
        expect(scale(a, 0)).toEqual(createVector2(0, 0))
    })

    it('preserves orientation and orthogonality', () => {
        const a = createVector2(3, 4)
        const normal = perpendicular(a)

        expect(normal).toEqual(createVector2(-4, 3))
        expect(dot(a, normal)).toBe(0)
        expect(dot(a, a)).toBe(25)
        expect(cross(a, normal)).toBe(25)
        expect(cross(normal, a)).toBe(-25)
        expect(cross(a, scale(a, 2))).toBe(0)
        expect(length(normal)).toBe(length(a))
        expect(distance(a, createVector2(6, 8))).toBe(5)
    })

    it.each([1e200, 1e-200])(
        'measures lengths safely at scale %s',
        (factor) => {
            expect(
                length(createVector2(3 * factor, 4 * factor)) / factor,
            ).toBeCloseTo(5, 14)
            expect(
                distance(
                    createVector2(0, 0),
                    createVector2(3 * factor, 4 * factor),
                ) / factor,
            ).toBeCloseTo(5, 14)
        },
    )

    it.each([1, Number.MAX_VALUE, Number.MIN_VALUE])(
        'normalizes diagonal vectors at scale %s',
        (factor) => {
            const unit = normalize(createVector2(factor, -factor))

            expect(length(unit)).toBeCloseTo(1, 14)
            expect(unit.x).toBeCloseTo(Math.SQRT1_2, 14)
            expect(unit.y).toBeCloseTo(-Math.SQRT1_2, 14)
        },
    )

    it('rejects zero-vector normalization', () => {
        expect(() => normalize(createVector2(0, -0))).toThrow(RangeError)
    })

    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite input %s in all operations',
        (value) => {
            const good = createVector2(1, 2)

            expect(() => createVector2(value, 0)).toThrow(RangeError)
            expect(() => createVector2(0, value)).toThrow(RangeError)
            expect(() => scale(good, value)).toThrow(RangeError)

            for (const bad of [
                { x: value, y: 0 },
                { x: 0, y: value },
            ]) {
                for (const operation of [add, subtract, dot, cross, distance]) {
                    expect(() => operation(good, bad)).toThrow(RangeError)
                    expect(() => operation(bad, good)).toThrow(RangeError)
                }

                for (const operation of [length, normalize, perpendicular]) {
                    expect(() => operation(bad)).toThrow(RangeError)
                }

                expect(() => scale(bad, 0)).toThrow(RangeError)
            }
        },
    )

    it('rejects results that cannot be represented as finite numbers', () => {
        const huge = createVector2(Number.MAX_VALUE, 0)

        for (const operation of [
            () => add(huge, huge),
            () => subtract(huge, scale(huge, -1)),
            () => scale(huge, 2),
            () => dot(huge, createVector2(2, 0)),
            () => cross(huge, createVector2(0, 2)),
            () => length(createVector2(Number.MAX_VALUE, Number.MAX_VALUE)),
            () => distance(huge, scale(huge, -1)),
        ]) {
            expect(operation).toThrow(RangeError)
        }
    })
})

describe('model-space tolerance', () => {
    it('uses inclusive absolute drawing distances and an explicit setting', () => {
        const tolerance = createModelTolerance(0.5)

        expect(numbersEqual(2, 2.5, tolerance)).toBe(true)
        expect(numbersEqual(2, 2.50001, tolerance)).toBe(false)
        expect(numbersEqual(2.5, 2, tolerance)).toBe(true)

        const a = createVector2(0, 0)
        const b = createVector2(0.375, 0.5)

        expect(pointsCoincide(a, b, tolerance)).toBe(false)
        expect(pointsCoincide(a, b, createModelTolerance(0.625))).toBe(true)
        expect(pointsCoincide(b, a, createModelTolerance(0.625))).toBe(true)
        expect(
            pointsCoincide(
                createVector2(1e12, 0),
                createVector2(1e12 + 1, 0),
                tolerance,
            ),
        ).toBe(false)
        expect(numbersEqual(1e12, 1e12 + 1, tolerance)).toBe(false)
    })

    it('allows exact equality and handles separations beyond the number range', () => {
        const exact = createModelTolerance(0)

        expect(numbersEqual(0, -0, exact)).toBe(true)
        expect(
            pointsCoincide(createVector2(1, 2), createVector2(1, 2), exact),
        ).toBe(true)
        expect(numbersEqual(0, Number.MIN_VALUE, exact)).toBe(false)
        expect(
            pointsCoincide(
                createVector2(0, 0),
                createVector2(Number.MIN_VALUE, 0),
                exact,
            ),
        ).toBe(false)

        const huge = Number.MAX_VALUE
        const tolerance = createModelTolerance(huge)

        expect(numbersEqual(huge, -huge, tolerance)).toBe(false)
        expect(
            pointsCoincide(
                createVector2(huge, 0),
                createVector2(-huge, 0),
                tolerance,
            ),
        ).toBe(false)
    })

    it.each([-1, NaN, Infinity, -Infinity])(
        'rejects invalid tolerance %s even without the factory',
        (value) => {
            expect(() => createModelTolerance(value)).toThrow(RangeError)
            expect(() => numbersEqual(1, 1, { distance: value })).toThrow(
                RangeError,
            )
            expect(() =>
                pointsCoincide(createVector2(0, 0), createVector2(0, 0), {
                    distance: value,
                }),
            ).toThrow(RangeError)
        },
    )

    it.each([NaN, Infinity, -Infinity])(
        'rejects invalid comparison input %s',
        (value) => {
            const tolerance = createModelTolerance(1e-9)

            expect(() => numbersEqual(value, 0, tolerance)).toThrow(RangeError)
            expect(() => numbersEqual(0, value, tolerance)).toThrow(RangeError)

            for (const bad of [
                { x: value, y: 0 },
                { x: 0, y: value },
            ]) {
                expect(() =>
                    pointsCoincide(bad, createVector2(0, 0), tolerance),
                ).toThrow(RangeError)
                expect(() =>
                    pointsCoincide(createVector2(0, 0), bad, tolerance),
                ).toThrow(RangeError)
            }
        },
    )
})
