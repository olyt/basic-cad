import { bulgeToSegment } from '../geometry/bulge'
import { createArc, type Polyline } from '../geometry/curve'
import { createPolyline } from '../geometry/polyline'
import { type TestRandom } from './random'

export function scallopedPath(
    count: number,
    offset: { readonly x: number; readonly y: number },
): Polyline {
    const segments = Array.from({ length: count }, (_, index) =>
        createArc({
            center: { x: offset.x + 2 * index + 1, y: offset.y },
            radius: 1,
            startAngle: Math.PI,
            sweep: -Math.PI,
        }),
    )

    return createPolyline({ segments, closed: false }, { distance: 0 })
}

export function randomIntersectionPath(
    random: TestRandom,
    translation: number,
): Polyline {
    const count = Math.floor(random.between(3, 7))
    const vertices = Array.from({ length: count }, () => ({
        x: translation + random.between(-100, 100),
        y: random.between(-100, 100),
    }))
    const closed = random.sign() > 0
    const segmentCount = closed ? count : count - 1
    const segments = Array.from({ length: segmentCount }, (_, index) =>
        bulgeToSegment({
            start: vertices[index]!,
            end: vertices[(index + 1) % count]!,
            bulge:
                index % 2 === 0 ? 0 : random.sign() * random.between(0.25, 2),
        }),
    )

    return createPolyline({ segments, closed }, { distance: 1e-7 })
}
