import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import {
    MAX_COORDINATE,
    createArc,
    createCircle,
    createLine,
    type Curve,
    type CurveType,
} from './curve'
import { dot, length, subtract } from './vector'
import { createPolyline } from './polyline'

const origin = { x: 0, y: 0 }
const quarterTurn = FULL_TURN / 4

const samples: Record<CurveType, () => Curve> = {
    line: () => createLine({ x: 1, y: 2 }, { x: 3, y: 4 }),
    circle: () => createCircle({ x: 5, y: 6 }, 7),
    arc: () => createArc({ x: 8, y: 9 }, 10, quarterTurn, -quarterTurn),
    polyline: () =>
        createPolyline([createLine(origin, { x: 1, y: 0 })], false, {
            distance: 0,
        }),
}

describe('curve types', () => {
    it.each(Object.entries(samples))(
        'creates a %s tagged with its type',
        (type, create) => {
            expect(create().type).toBe(type)
        },
    )
})

describe('exact curve constructors', () => {
    it('stores tagged line, circle and arc geometry', () => {
        const curves: Curve[] = [
            createLine({ x: 1, y: 2 }, { x: 3, y: 4 }),
            createCircle({ x: 5, y: 6 }, 7),
            createArc({ x: 8, y: 9 }, 10, quarterTurn, -quarterTurn),
        ]

        expect(curves).toEqual([
            { type: 'line', start: { x: 1, y: 2 }, end: { x: 3, y: 4 } },
            { type: 'circle', center: { x: 5, y: 6 }, radius: 7 },
            {
                type: 'arc',
                center: { x: 8, y: 9 },
                radius: 10,
                startAngle: quarterTurn,
                sweep: -quarterTurn,
            },
        ])
    })

    it.each([quarterTurn, -quarterTurn, 3 * quarterTurn, -3 * quarterTurn])(
        'normalizes the start while preserving signed sweep %s',
        (sweep) => {
            const arc = createArc(origin, 1, -3 * quarterTurn, sweep)

            expect(arc.startAngle).toBe(quarterTurn)
            expect(arc.sweep).toBe(sweep)
        },
    )

    it.each([-0, FULL_TURN, -FULL_TURN])(
        'normalizes equivalent arc start %s to positive zero',
        (startAngle) => {
            expect(
                createArc(origin, 1, startAngle, quarterTurn).startAngle,
            ).toBe(0)
        },
    )

    it('copies all caller coordinates', () => {
        const start = { x: 1, y: 2 }
        const end = { x: 3, y: 4 }
        const center = { x: 5, y: 6 }
        const line = createLine(start, end)
        const circle = createCircle(center, 7)
        const arc = createArc(center, 8, 0, quarterTurn)

        expect(line.start).not.toBe(start)
        expect(line.end).not.toBe(end)
        expect(circle.center).not.toBe(center)
        expect(arc.center).not.toBe(center)
        expect(arc.center).not.toBe(circle.center)

        start.x = 100
        end.y = 100
        center.x = 100

        expect(line.start).toEqual({ x: 1, y: 2 })
        expect(line.end).toEqual({ x: 3, y: 4 })
        expect(circle.center).toEqual({ x: 5, y: 6 })
        expect(arc.center).toEqual({ x: 5, y: 6 })
    })

    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite coordinate components %s',
        (value) => {
            for (const point of [
                { x: value, y: 0 },
                { x: 0, y: value },
            ]) {
                expect(() => createLine(point, origin)).toThrow(RangeError)
                expect(() => createLine(origin, point)).toThrow(RangeError)
                expect(() => createCircle(point, 1)).toThrow(RangeError)
                expect(() => createArc(point, 1, 0, quarterTurn)).toThrow(
                    RangeError,
                )
            }
        },
    )

    it.each([
        0,
        -0,
        -1,
        MAX_COORDINATE + 1,
        Number.MAX_VALUE,
        NaN,
        Infinity,
        -Infinity,
    ])('rejects invalid radius %s', (radius) => {
        expect(() => createCircle(origin, radius)).toThrow(RangeError)
        expect(() => createArc(origin, radius, 0, quarterTurn)).toThrow(
            RangeError,
        )
    })

    it.each([Number.MIN_VALUE, MAX_COORDINATE])(
        'retains supported radius %s',
        (radius) => {
            const center = { x: MAX_COORDINATE, y: -MAX_COORDINATE }

            expect(createCircle(center, radius).radius).toBe(radius)
            expect(createArc(center, radius, 0, quarterTurn).radius).toBe(
                radius,
            )
        },
    )

    it.each([MAX_COORDINATE + 1, -(MAX_COORDINATE + 1), Number.MAX_VALUE])(
        'rejects coordinate component %s outside the supported range',
        (value) => {
            for (const point of [
                { x: value, y: 0 },
                { x: 0, y: value },
            ]) {
                expect(() => createLine(point, origin)).toThrow(
                    'Coordinates must be within',
                )
                expect(() => createLine(origin, point)).toThrow(
                    'Coordinates must be within',
                )
                expect(() => createCircle(point, 1)).toThrow(
                    'Coordinates must be within',
                )
                expect(() => createArc(point, 1, 0, quarterTurn)).toThrow(
                    'Coordinates must be within',
                )
            }
        },
    )

    it('keeps later geometry finite at the supported limits', () => {
        const corner = { x: MAX_COORDINATE, y: MAX_COORDINATE }
        const line = createLine({ x: -corner.x, y: -corner.y }, corner)
        const circle = createCircle(corner, MAX_COORDINATE)
        const span = subtract(line.end, line.start)

        expect(Number.isFinite(length(span))).toBe(true)
        expect(Number.isFinite(dot(span, span))).toBe(true)
        expect(Number.isFinite(dot(circle.center, circle.center))).toBe(true)
        expect(Number.isFinite(circle.radius ** 4)).toBe(true)
    })

    it('rejects exactly coincident line endpoints, including signed zero', () => {
        expect(() => createLine({ x: 1, y: 2 }, { x: 1, y: 2 })).toThrow(
            RangeError,
        )
        expect(() => createLine(origin, { x: -0, y: -0 })).toThrow(RangeError)
    })

    it('retains distinct line endpoints at tiny and extreme supported scales', () => {
        const tiny = { x: Number.MIN_VALUE, y: 0 }
        const huge = { x: MAX_COORDINATE, y: 0 }

        expect(createLine(origin, tiny).end).toEqual(tiny)
        expect(createLine(origin, { x: 0, y: Number.MIN_VALUE }).end.y).toBe(
            Number.MIN_VALUE,
        )
        expect(createLine(huge, { x: -MAX_COORDINATE, y: 0 }).start).toEqual(
            huge,
        )
    })

    it.each([
        0,
        -0,
        FULL_TURN,
        -FULL_TURN,
        2 * FULL_TURN,
        -2 * FULL_TURN,
        Number.MAX_VALUE,
        NaN,
        Infinity,
        -Infinity,
    ])('rejects zero, full, oversized or non-finite sweep %s', (sweep) => {
        expect(() => createArc(origin, 1, 0, sweep)).toThrow(RangeError)
    })

    it.each([Number.MIN_VALUE, -Number.MIN_VALUE, FULL_TURN - 2 ** -50])(
        'retains nonzero partial sweep %s',
        (sweep) => {
            expect(createArc(origin, 1, 0, sweep).sweep).toBe(sweep)
        },
    )

    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite arc start angle %s',
        (startAngle) => {
            expect(() => createArc(origin, 1, startAngle, quarterTurn)).toThrow(
                RangeError,
            )
        },
    )
})
