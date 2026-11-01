import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { bulgeToSegment } from './bulge'
import { createLine } from './curve'
import { intersectCurves } from './curve-intersection'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

describe('bulge-built joint intersections (fixed seed)', () => {
    it('coalesces noncardinal line/arc joins without changing the exact line representative', () => {
        const random = seededRandom(20261102)
        const modelTolerance = { distance: 1e-7 }
        let nonShared = 0
        let duplicateStrict = 0

        for (let index = 0; index < 120; index++) {
            const translation = index % 3 === 0 ? 1e5 : 0
            const joint = {
                x: translation + random.between(-10, 10),
                y: translation + random.between(-10, 10),
            }
            const arc = bulgeToSegment({
                start: joint,
                end: {
                    x: joint.x + random.between(50, 150),
                    y: joint.y + random.between(50, 150),
                },
                bulge: random.between(0.3, 0.8),
            })
            const start = segmentEndpoints(arc).start
            const line = createLine({ x: joint.x - 50, y: joint.y }, joint)
            const first = createPolyline(
                { segments: [line, arc], closed: false },
                modelTolerance,
            )
            const second = createLine(
                { x: joint.x, y: joint.y - 1000 },
                { x: joint.x, y: joint.y + 1000 },
            )
            const query = {
                first,
                second,
                modelTolerance,
                angularTolerance: 1e-10,
            }
            const strict = intersectCurves({
                ...query,
                modelTolerance: { distance: 0 },
            })
            const result = intersectCurves(query)
            const near = result.hits.filter(
                ({ point }) =>
                    Math.hypot(point.x - joint.x, point.y - joint.y) <= 1e-7,
            )
            const lineHit = strict.hits.find(
                ({ first }) => first.segmentIndex === 0,
            )!

            nonShared += Number(start.x !== joint.x || start.y !== joint.y)
            duplicateStrict += Number(strict.hits.length > 1)
            expect(near).toStrictEqual([lineHit])

            const reversed = intersectCurves({
                ...query,
                first: second,
                second: first,
            })

            expect(
                reversed.hits.map(({ point, first, second }) => ({
                    point,
                    first: second,
                    second: first,
                })),
            ).toEqual(result.hits)
        }

        expect(nonShared).toBeGreaterThan(40)
        expect(duplicateStrict).toBeGreaterThan(40)
    })
})
