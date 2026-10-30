import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { polylineSignedArea } from './area'
import { bulgeToSegment } from './bulge'
import type { Polyline, PolylineSegment } from './curve'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'
import type { ModelTolerance } from './tolerance'
import type { Vector2 } from './vector'
import { seededRandom } from '../test-support/random'

interface BoundaryInput {
    readonly vertices: readonly Vector2[]
    readonly bulges: readonly number[]
}

function edges({ vertices, bulges }: BoundaryInput): PolylineSegment[] {
    return vertices.map((start, index) => {
        const end = vertices[(index + 1) % vertices.length]
        const bulge = bulges[index]

        if (!end || bulge === undefined) {
            throw new RangeError('Test boundary needs one bulge per vertex.')
        }

        return bulgeToSegment({ start, end, bulge })
    })
}

function boundary(input: BoundaryInput, tolerance: ModelTolerance): Polyline {
    return createPolyline({ segments: edges(input), closed: true }, tolerance)
}

// Independent vertex/bulge oracle: the circular-segment formula is expressed
// directly in chord length and bulge, without production arc parameters.
function referenceArea({ vertices, bulges }: BoundaryInput): number {
    const anchor = vertices[0]

    if (!anchor) {
        throw new RangeError('Test boundary cannot be empty.')
    }

    let total = 0

    for (const [index, start] of vertices.entries()) {
        const end = vertices[(index + 1) % vertices.length]
        const bulge = bulges[index]

        if (!end || bulge === undefined) {
            throw new RangeError('Test boundary needs one bulge per vertex.')
        }

        const chordArea =
            ((start.x - anchor.x) * (end.y - anchor.y) -
                (start.y - anchor.y) * (end.x - anchor.x)) /
            2

        if (bulge === 0) {
            total += chordArea

            continue
        }

        const squared = bulge * bulge
        const factor =
            ((1 + squared) ** 2 * Math.atan(bulge) - bulge * (1 - squared)) /
            (8 * squared)
        const chord = Math.hypot(end.x - start.x, end.y - start.y)

        total += chordArea + chord * chord * factor
    }

    return total
}

describe('mixed polyline area properties (fixed seed)', () => {
    it.each([
        { sign: 1, translation: { x: 0, y: 0 } },
        { sign: -1, translation: { x: 0, y: 0 } },
        { sign: 1, translation: { x: 1e6, y: -1e6 } },
        { sign: -1, translation: { x: -1e6, y: 1e6 } },
    ])(
        'measures every admitted boundary: sign $sign, translation $translation',
        ({ sign, translation }) => {
            const random = seededRandom(20261101)
            let arcCount = 0

            for (let sample = 0; sample < 500; sample += 1) {
                const count = Math.floor(random.between(5, 10))
                const scale = random.magnitude(1, 4)
                const phase = random.between(0, FULL_TURN)
                const vertices = Array.from({ length: count }, (_, index) => {
                    const angle =
                        phase +
                        (sign *
                            FULL_TURN *
                            (index + random.between(-0.1, 0.1))) /
                            count
                    const radius = scale * random.between(0.65, 1.25)

                    return {
                        x: translation.x + radius * Math.cos(angle),
                        y: translation.y + radius * Math.sin(angle),
                    }
                })
                const bulges = vertices.map((_, index) =>
                    index % 3 === 0 ? 0 : sign * random.between(0.15, 0.6),
                )
                const input = { vertices, bulges }
                const tolerance = { distance: 1e-7 }
                const polyline = boundary(input, tolerance)
                const expected = referenceArea(input)
                const chordPerimeter = polyline.segments.reduce(
                    (sum, segment) => {
                        const { start, end } = segmentEndpoints(segment)

                        return (
                            sum + Math.hypot(end.x - start.x, end.y - start.y)
                        )
                    },
                    0,
                )
                const budget =
                    chordPerimeter * tolerance.distance + scale * scale * 1e-12
                const actual = polylineSignedArea(polyline, tolerance)

                arcCount += polyline.segments.filter(
                    (segment) => segment.type === 'arc',
                ).length

                expect(Math.abs(actual - expected)).toBeLessThanOrEqual(budget)
                expect(Math.sign(actual)).toBe(sign)
                expect(
                    polyline.segments.some(
                        (segment) =>
                            segment.type === 'arc' &&
                            segment.startAngle % (Math.PI / 2) !== 0,
                    ),
                ).toBe(true)
                expect(
                    polyline.segments.some(
                        (segment) => segment.type === 'line',
                    ),
                ).toBe(true)
            }

            expect(arcCount).toBeGreaterThan(1000)
        },
    )

    it('measures a rounded rectangle generated from vertices and bulges', () => {
        const quarter = Math.tan(Math.PI / 8)
        const input = {
            vertices: [
                { x: 1, y: 0 },
                { x: 9, y: 0 },
                { x: 10, y: 1 },
                { x: 10, y: 5 },
                { x: 9, y: 6 },
                { x: 1, y: 6 },
                { x: 0, y: 5 },
                { x: 0, y: 1 },
            ],
            bulges: [0, quarter, 0, quarter, 0, quarter, 0, quarter],
        }
        const tolerance = { distance: 1e-12 }

        expect(
            polylineSignedArea(boundary(input, tolerance), tolerance),
        ).toBeCloseTo(56 + Math.PI, 11)
    })

    it('uses model tolerance for two rounded noncardinal semicircle endpoints', () => {
        const point = { x: Math.cos(0.1), y: Math.sin(0.1) }
        const input = {
            vertices: [point, { x: -point.x, y: -point.y }],
            bulges: [1, 1],
        }
        const tolerance = { distance: 1e-12 }
        const polyline = boundary(input, tolerance)

        expect(() => polylineSignedArea(polyline, { distance: 0 })).toThrow(
            RangeError,
        )
        expect(polylineSignedArea(polyline, tolerance)).toBeCloseTo(Math.PI, 12)
    })

    it.each([-1, NaN, Infinity])(
        'rejects invalid model tolerance %s',
        (distance) => {
            const input = {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0, y: 1 },
                ],
                bulges: [0, 0, 0],
            }
            const polyline = boundary(input, { distance: 0 })

            expect(() => polylineSignedArea(polyline, { distance })).toThrow(
                RangeError,
            )
        },
    )
})
