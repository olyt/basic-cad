import {
    createArc,
    type Circle,
    type Line,
    type Polyline,
} from '../geometry/curve'
import {
    type LineDomain,
    type LineOperand,
} from '../geometry/line-intersection'
import { segmentEndpoints } from '../geometry/segment'
import { type Vector2 } from '../geometry/vector'
import { seededRandom } from './random'

export interface ScalingCase {
    readonly first: Circle
    readonly second: Circle
    readonly firstLine: LineOperand
    readonly secondLine: LineOperand
}

function circle(center: Vector2, radius: number): Circle {
    return { type: 'circle', center, radius }
}

function line(start: Vector2, end: Vector2): Line {
    return { type: 'line', start, end }
}

function operand(input: Line, domain: LineDomain = 'infinite'): LineOperand {
    return { line: input, domain }
}

export function scalingCases(): ScalingCase[] {
    const random = seededRandom(20261031)
    const cases = Array.from({ length: 600 }, (_, index): ScalingCase => {
        const scale = index % 3 === 0 ? 1 : random.magnitude(-300, 13)
        const translation = index % 4 === 0 ? 1e12 : 0
        const point = (): Vector2 => ({
            x: translation + random.between(-10, 10) * scale,
            y: translation + random.between(-10, 10) * scale,
        })

        return {
            first: circle(point(), random.between(0.1, 5) * scale),
            second: circle(point(), random.between(0.1, 5) * scale),
            firstLine: operand(
                line(point(), point()),
                index % 2 === 0 ? 'segment' : 'infinite',
            ),
            secondLine: operand(
                line(point(), point()),
                index % 5 === 0 ? 'segment' : 'infinite',
            ),
        }
    })
    const origin = { x: 0, y: 0 }
    const unit = circle(origin, 1)
    const horizontal = operand(line({ x: -2, y: 0 }, { x: 2, y: 0 }))
    const vertical = operand(line({ x: 0, y: -2 }, { x: 0, y: 2 }))
    const base = {
        first: unit,
        second: circle({ x: 1, y: 0 }, 1),
        firstLine: horizontal,
        secondLine: vertical,
    }
    const m = Number.MIN_VALUE
    const e = Number.EPSILON

    cases.push(
        base,
        { ...base, second: circle({ x: 2, y: 0 }, 1) },
        { ...base, second: circle({ x: 2, y: m }, 1) },
        { ...base, second: circle({ x: m, y: 0 }, 1) },
        {
            ...base,
            first: circle(origin, m),
            second: circle({ x: m, y: 0 }, m),
        },
        {
            ...base,
            first: circle({ x: 6e11, y: 8e11 }, m),
            second: circle(origin, 1e12),
        },
        {
            ...base,
            first: circle({ x: 1e15, y: 0 }, 1e15),
            second: circle({ x: 1e15, y: 1e15 }, 1e15),
        },
        {
            ...base,
            first: circle({ x: 0, y: 1 }, 1),
            firstLine: operand(line(origin, { x: 1, y: m }), 'segment'),
        },
        {
            ...base,
            firstLine: operand(line(origin, { x: 1, y: 1 + e }), 'segment'),
            secondLine: operand(
                line({ x: 0, y: (-e * e) / 2 }, { x: 1 - e, y: 1 }),
                'segment',
            ),
        },
        {
            ...base,
            firstLine: operand(line(origin, { x: 1, y: 0 }), 'segment'),
            secondLine: operand(
                line({ x: 1, y: -m }, { x: 1 + e, y: 1 }),
                'segment',
            ),
        },
        {
            ...base,
            firstLine: operand(line(origin, { x: 1, y: m })),
            secondLine: operand(line({ x: 0, y: 1 }, { x: 1, y: 1 })),
        },
    )

    for (const radius of [0, -1, NaN, Infinity, 1e15 + 1]) {
        cases.push(
            { ...base, first: circle(origin, radius) },
            { ...base, second: circle(origin, radius) },
        )
    }

    for (const domain of ['ray', undefined] as unknown as LineDomain[]) {
        cases.push(
            { ...base, firstLine: { ...horizontal, domain } },
            { ...base, secondLine: { ...vertical, domain } },
        )
    }

    return cases
}

function polygon(points: readonly Vector2[]): Polyline {
    return {
        type: 'polyline',
        closed: true,
        segments: points.map((start, index) =>
            line(start, points[(index + 1) % points.length]!),
        ),
    }
}

export function scalingAreaCases(): Polyline[] {
    const random = seededRandom(20261101)
    const cases = Array.from({ length: 300 }, (_, index): Polyline => {
        const scale = index % 3 === 0 ? 1 : random.magnitude(-180, 12)
        const translation = index % 4 === 0 ? 1e12 : 0
        const center = {
            x: translation + random.between(-3, 3) * scale,
            y: translation + random.between(-3, 3) * scale,
        }

        if (index % 2 === 0) {
            const x = center.x + 5.3 * scale
            const y = center.y + 2.7 * scale

            return polygon([
                center,
                { x, y: center.y },
                { x, y },
                { x: center.x, y },
            ])
        }

        const arc = createArc({
            center,
            radius: 4.1 * scale,
            startAngle: random.between(0, 6),
            sweep: random.sign() * random.between(0.1, 5.9),
        })
        const { start, end } = segmentEndpoints(arc)

        return {
            type: 'polyline',
            closed: true,
            segments: [arc, line(end, center), line(center, start)],
        }
    })

    cases.push(
        polygon([
            { x: 0, y: 0 },
            { x: 1e15, y: Number.MIN_VALUE },
            { x: 1, y: Number.MIN_VALUE },
        ]),
        polygon([
            { x: 0, y: 0 },
            { x: 1e-200, y: 0 },
            { x: 0, y: 1e-200 },
        ]),
        polygon([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]),
        polygon([
            { x: 1e15 - 2, y: 1e15 - 0.125 },
            { x: 1e15 - 1, y: 1e15 },
            { x: 1e15, y: 1e15 },
        ]),
        {
            type: 'polyline',
            closed: true,
            segments: [
                line({ x: 0, y: 0 }, { x: 2, y: 0 }),
                line({ x: 2, y: 0.125 }, { x: 2, y: 2 }),
                line({ x: 2, y: 2 }, { x: 0, y: 2 }),
                line({ x: 0, y: 2 }, { x: 0, y: 0 }),
            ],
        },
    )

    return cases
}
