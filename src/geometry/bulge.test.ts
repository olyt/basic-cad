import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { bulgeToSegment, segmentToBulge } from './bulge'
import { MAX_COORDINATE, createArc, createLine } from './curve'
import { segmentEndpoints } from './segment'
import type { Vector2 } from './vector'
import { seededRandom } from '../test-support/random'

const start = { x: 0, y: 0 }
const end = { x: 2, y: 0 }

function expectPoint(actual: Vector2, expected: Vector2): void {
    expect(actual.x).toBeCloseTo(expected.x, 12)
    expect(actual.y).toBeCloseTo(expected.y, 12)
}

describe('bulge conversion', () => {
    it.each([0, -0])('keeps straight segments for bulge %s', (bulge) => {
        const line = bulgeToSegment({ start, end, bulge })

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
        const arc = bulgeToSegment({ start, end, bulge })
        const converted = segmentToBulge(arc)
        const reverse = bulgeToSegment({
            start: end,
            end: start,
            bulge: -bulge,
        })

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
            const arc = createArc({
                center: { x: 3, y: -4 },
                radius: 2,
                startAngle: (7 * Math.PI) / 4,
                sweep,
            })
            const converted = segmentToBulge(arc)
            const restored = bulgeToSegment(converted)

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
            const arc = createArc({
                center: start,
                radius: 1,
                startAngle: 0,
                sweep: sign * (FULL_TURN - gap),
            })
            const points = segmentEndpoints(arc)
            const converted = segmentToBulge(arc)
            const restored = bulgeToSegment(converted)

            expect(points.start).toEqual({ x: 1, y: 0 })
            expect(points.end.y).toBeCloseTo(-sign * gap, 28)
            expect(points.end).not.toEqual(points.start)
            expect(converted.bulge * sign).toBeGreaterThan(1)
            expect(restored).toMatchObject({ type: 'arc', radius: 1 })
        },
    )

    it.each([
        [{ x: 2, y: 0 }, 2e-8],
        [{ x: 2, y: 0 }, -2e-8],
        [{ x: 1000, y: 0 }, 1e-8],
        [{ x: 1000, y: 0 }, -1e-8],
        [{ x: 1e7, y: 0 }, 2e-8],
        [{ x: 1e7, y: 0 }, -2e-8],
    ])('preserves shallow arc curvature: end %o, bulge %s', (arcEnd, bulge) => {
        const arc = bulgeToSegment({ start, end: arcEnd, bulge })

        expect(arc.type).toBe('arc')
        expect(segmentToBulge(arc).bulge / bulge).toBeCloseTo(1, 14)

        if (arc.type === 'arc') {
            const sagitta = 2 * arc.radius * Math.sin(arc.sweep / 4) ** 2

            expect(sagitta / ((arcEnd.x * Math.abs(bulge)) / 2)).toBeCloseTo(
                1,
                14,
            )
        }
    })

    it.each([4e-8, -4e-8, 4e-12, -4e-12])(
        'round-trips a small sweep %s without flattening',
        (sweep) => {
            const original = createArc({
                center: start,
                radius: 1,
                startAngle: 0,
                sweep,
            })
            const converted = segmentToBulge(original)
            const restored = bulgeToSegment(converted)

            expect(restored.type).toBe('arc')

            if (restored.type === 'arc') {
                expect(restored.radius).toBeCloseTo(original.radius, 12)
                expect(restored.sweep / sweep).toBeCloseTo(1, 14)
            }
        },
    )

    it('converts shallow arcs across chord lengths and directions', () => {
        for (const chord of [1e-3, 1, 1e3, 1e5]) {
            for (const angle of [0, 0.7, 2.9]) {
                const chordEnd = {
                    x: chord * Math.cos(angle),
                    y: chord * Math.sin(angle),
                }

                for (const bulge of [2.0000001e-8, 1e-7, 1e-6]) {
                    for (const sign of [1, -1]) {
                        const arc = bulgeToSegment({
                            start,
                            end: chordEnd,
                            bulge: sign * bulge,
                        })

                        expect(arc.type).toBe('arc')
                    }
                }
            }
        }
    })

    it.each([NaN, Infinity, -Infinity])(
        'rejects non-finite bulge %s',
        (bulge) => {
            expect(() => bulgeToSegment({ start, end, bulge })).toThrow(
                RangeError,
            )
        },
    )

    it.each([
        () => bulgeToSegment({ start, end: start, bulge: 1 }),
        () => bulgeToSegment({ start, end, bulge: 1e300 }),
        () => bulgeToSegment({ start, end: { x: 1, y: 0 }, bulge: 1e-12 }),
        () => bulgeToSegment({ start, end: { x: 1, y: 0 }, bulge: 1e-16 }),
        () => bulgeToSegment({ start, end: { x: 1000, y: 0 }, bulge: 1e-10 }),
        () => bulgeToSegment({ start, end, bulge: 1e-300 }),
        () =>
            bulgeToSegment({ start, end: { x: 1e-300, y: 0 }, bulge: 1e-300 }),
        () =>
            bulgeToSegment({
                start: { x: MAX_COORDINATE, y: 0 },
                end: { x: MAX_COORDINATE, y: 2 },
                bulge: -0.5,
            }),
        () =>
            segmentToBulge(
                createArc({
                    center: { x: MAX_COORDINATE, y: 0 },
                    radius: 1,
                    startAngle: 0,
                    sweep: Math.PI,
                }),
            ),
        () =>
            segmentToBulge(
                createArc({
                    center: { x: MAX_COORDINATE, y: MAX_COORDINATE },
                    radius: 1,
                    startAngle: 0,
                    sweep: 1e-18,
                }),
            ),
        () =>
            segmentToBulge(
                createArc({
                    center: start,
                    radius: 1,
                    startAngle: 0,
                    sweep: Number.MIN_VALUE,
                }),
            ),
    ])('rejects unrepresentable conversion %#', (convert) => {
        expect(convert).toThrow(RangeError)
    })
})

describe('bulge conversion properties (fixed seed)', () => {
    function attempt<T>(convert: () => T): T | string {
        try {
            return convert()
        } catch (error) {
            return (error as Error).message
        }
    }

    it('round-trips random arcs through their bulge, keeping the sweep', () => {
        const random = seededRandom(1)
        const failures = Array.from({ length: 5000 }, () => {
            const arc = createArc({
                center: {
                    x: random.between(-1e6, 1e6),
                    y: random.between(-1e6, 1e6),
                },
                radius: random.magnitude(-3, 6),
                startAngle: random.between(-10, 10),
                sweep: random.sign() * random.between(1e-6, FULL_TURN - 1e-6),
            })
            const { start: from, end: to, bulge } = segmentToBulge(arc)
            const restored = attempt(() =>
                bulgeToSegment({ start: from, end: to, bulge }),
            )

            return { arc, restored }
        }).filter(
            ({ arc, restored }) =>
                typeof restored === 'string' ||
                restored.type !== 'arc' ||
                Math.abs(restored.sweep - arc.sweep) > 1e-12,
        )

        expect(failures).toEqual([])
    })

    it('never flattens a random bulge, and converts every bulge from 1e-7 to an arc', () => {
        const random = seededRandom(2)
        const outcome = (convert: () => { type: string }): string => {
            try {
                return convert().type
            } catch (error) {
                return error instanceof RangeError ? 'rejected' : 'other error'
            }
        }
        const failures = Array.from({ length: 20_000 }, () => {
            const from = {
                x: random.sign() * random.magnitude(-3, 6),
                y: random.sign() * random.magnitude(-3, 6),
            }
            const chord = random.magnitude(-3, 5)
            const direction = random.between(0, FULL_TURN)
            const to = {
                x: from.x + chord * Math.cos(direction),
                y: from.y + chord * Math.sin(direction),
            }
            const bulge = random.sign() * random.magnitude(-15, -3)
            const actual = outcome(() =>
                bulgeToSegment({ start: from, end: to, bulge }),
            )
            const allowed =
                Math.abs(bulge) >= 1e-7 ? ['arc'] : ['arc', 'rejected']

            return { from, to, bulge, actual, allowed }
        }).filter(({ actual, allowed }) => !allowed.includes(actual))

        expect(failures).toEqual([])
    })
})
