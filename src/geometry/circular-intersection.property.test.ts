import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN } from './angle'
import {
    intersectCircles,
    type CircularIntersection,
} from './circle-intersection'
import { intersectCircularCurves } from './circular-intersection'
import { createArc, createCircle, type Arc, type Circle } from './curve'
import { type Vector2 } from './vector'

// Independent distance/chord construction for well-conditioned circles.
function referencePoints(first: Circle, second: Circle): Vector2[] {
    const dx = second.center.x - first.center.x
    const dy = second.center.y - first.center.y
    const distance = Math.hypot(dx, dy)

    if (
        distance > first.radius + second.radius ||
        distance < Math.abs(first.radius - second.radius)
    ) {
        return []
    }

    const along =
        (first.radius ** 2 - second.radius ** 2 + distance ** 2) /
        (2 * distance)
    const height = Math.sqrt(
        Math.max(0, (first.radius - along) * (first.radius + along)),
    )

    return [-1, 1].map((sign) => ({
        x: first.center.x + (dx * along - sign * dy * height) / distance,
        y: first.center.y + (dy * along + sign * dx * height) / distance,
    }))
}

function inside(curve: Circle | Arc, point: Vector2): boolean {
    if (curve.type === 'circle') {
        return true
    }

    const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x)
    const offset = Math.sign(curve.sweep) * (angle - curve.startAngle)
    const travel = ((offset % FULL_TURN) + FULL_TURN) % FULL_TURN

    return travel <= Math.abs(curve.sweep)
}

function assertPoints(result: CircularIntersection, expected: Vector2[]): void {
    expect(result.kind).toBe(expected.length === 0 ? 'none' : 'points')

    if (result.kind === 'points') {
        expect(result.points).toHaveLength(expected.length)

        for (const [index, point] of result.points.entries()) {
            const target = expected[index]!

            expect(
                Math.hypot(point.x - target.x, point.y - target.y),
            ).toBeLessThan(1e-7)
        }
    }
}

describe('circular pair properties (fixed seed)', () => {
    it('matches independent chord geometry and signed angular filtering', () => {
        const random = seededRandom(20261031)
        const arcOn = (circle: Circle): Arc =>
            createArc({
                center: circle.center,
                radius: circle.radius,
                startAngle: random.between(0, FULL_TURN),
                sweep: random.sign() * random.between(0.1, FULL_TURN - 0.1),
            })

        for (let index = 0; index < 400; index++) {
            const translation = index % 3 === 0 ? 1e6 : 0
            const center = {
                x: translation + random.between(-1000, 1000),
                y: random.between(-1000, 1000),
            }
            const firstCircle = createCircle(center, random.between(50, 400))
            const secondCircle = createCircle(
                {
                    x: center.x + random.between(30, 300),
                    y: center.y + random.between(-200, 200),
                },
                random.between(50, 400),
            )
            const expected = referencePoints(firstCircle, secondCircle)
            const direct = intersectCircles(firstCircle, secondCircle)

            assertPoints(direct, expected)

            if (direct.kind === 'points') {
                expect(intersectCircles(secondCircle, firstCircle)).toEqual({
                    kind: 'points',
                    points: direct.points.toReversed(),
                })
            }

            const first = index % 2 === 0 ? firstCircle : arcOn(firstCircle)
            const second = index % 4 < 2 ? secondCircle : arcOn(secondCircle)
            const filtered = expected.filter(
                (point) => inside(first, point) && inside(second, point),
            )

            assertPoints(
                intersectCircularCurves({ first, second, angularTolerance: 0 }),
                filtered,
            )
        }
    })
})
