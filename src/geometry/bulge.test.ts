import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { bulgeToSegment, segmentToBulge } from './bulge'
import { MAX_COORDINATE, createArc, createLine } from './curve'
import { segmentEndpoints } from './segment'
import type { Vector2 } from './vector'

const start = { x: 0, y: 0 }
const end = { x: 2, y: 0 }

function expectPoint(actual: Vector2, expected: Vector2): void {
    expect(actual.x).toBeCloseTo(expected.x, 12)
    expect(actual.y).toBeCloseTo(expected.y, 12)
}

describe('bulge conversion', () => {
    it.each([0, -0])('keeps straight segments for bulge %s', (bulge) => {
        const line = bulgeToSegment(start, end, bulge)

        expect(line).toEqual(createLine(start, end))
        expect(segmentToBulge(line)).toEqual({ start, end, bulge: 0 })
    })

    it.each([
        [-2, 0.75],
        [-1, 0],
        [-0.5, -0.75],
        [0.5, 0.75],
        [1, 0],
        [2, -0.75],
    ])('converts signed minor, semicircle and major bulge %s', (bulge, y) => {
        const arc = bulgeToSegment(start, end, bulge)
        const converted = segmentToBulge(arc)
        const reverse = bulgeToSegment(end, start, -bulge)

        expect(arc).toMatchObject({
            type: 'arc',
            center: { x: 1, y },
            radius: Math.abs(bulge) === 1 ? 1 : 1.25,
            sweep: 4 * Math.atan(bulge),
        })
        expectPoint(converted.start, start)
        expectPoint(converted.end, end)
        expect(converted.bulge).toBeCloseTo(bulge, 12)
        expect(reverse).toMatchObject({
            ...arc,
            startAngle: expect.any(Number),
            sweep: -4 * Math.atan(bulge),
        })
        expectPoint(segmentToBulge(reverse).start, end)
        expectPoint(segmentToBulge(reverse).end, start)
    })

    it.each([Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 2, (-3 * Math.PI) / 2])(
        'round-trips wraparound arcs with sweep %s',
        (sweep) => {
            const arc = createArc({ x: 3, y: -4 }, 2, (7 * Math.PI) / 4, sweep)
            const converted = segmentToBulge(arc)
            const restored = bulgeToSegment(
                converted.start,
                converted.end,
                converted.bulge,
            )

            expect(restored.type).toBe('arc')

            if (restored.type === 'arc') {
                expectPoint(restored.center, arc.center)
                expect(restored.radius).toBeCloseTo(arc.radius, 12)
                expect(restored.startAngle).toBeCloseTo(arc.startAngle, 12)
                expect(restored.sweep).toBeCloseTo(sweep, 12)
            }
        },
    )

    it.each([1, -1])(
        'keeps the missing gap of a near-full sweep %s',
        (sign) => {
            const gap = 2 ** -50
            const arc = createArc(start, 1, 0, sign * (FULL_TURN - gap))
            const points = segmentEndpoints(arc)
            const converted = segmentToBulge(arc)
            const restored = bulgeToSegment(
                converted.start,
                converted.end,
                converted.bulge,
            )

            expect(points.start).toEqual({ x: 1, y: 0 })
            expect(points.end.y).toBeCloseTo(-sign * gap, 28)
            expect(points.end).not.toEqual(points.start)
            expect(converted.bulge * sign).toBeGreaterThan(1)
            expect(restored).toMatchObject({ type: 'arc', radius: 1 })
        },
    )

    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite bulge %s',
        (bulge) => {
            expect(() => bulgeToSegment(start, end, bulge)).toThrow(RangeError)
        },
    )

    it.each([
        () => bulgeToSegment(start, start, 1),
        () => bulgeToSegment(start, end, 1e300),
        () => bulgeToSegment(start, end, 1e-300),
        () => bulgeToSegment(start, { x: 1e-300, y: 0 }, 1e-300),
        () =>
            bulgeToSegment(
                { x: MAX_COORDINATE, y: 0 },
                { x: MAX_COORDINATE, y: 2 },
                -0.5,
            ),
        () =>
            segmentToBulge(
                createArc({ x: MAX_COORDINATE, y: 0 }, 1, 0, Math.PI),
            ),
        () =>
            segmentToBulge(
                createArc(
                    { x: MAX_COORDINATE, y: MAX_COORDINATE },
                    1,
                    0,
                    1e-18,
                ),
            ),
        () => segmentToBulge(createArc(start, 1, 0, Number.MIN_VALUE)),
    ])('rejects unrepresentable conversion %#', (convert) => {
        expect(convert).toThrow(RangeError)
    })
})
