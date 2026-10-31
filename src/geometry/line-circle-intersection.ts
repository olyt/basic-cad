import { createCircle, createLine, type Circle } from './curve'
import { integerCoordinates, roundSurd } from './exact'
import { isLineDomain, type LineOperand } from './line-intersection'
import { type Vector2 } from './vector'

const ROOT_SIGNS = [-1, 1] as const

type RootSign = (typeof ROOT_SIGNS)[number]

interface IntegerVector {
    readonly x: bigint
    readonly y: bigint
}

interface CircleEquation {
    readonly exponent: number
    readonly start: IntegerVector
    readonly direction: IntegerVector
    readonly offset: IntegerVector
    readonly radius: bigint
    readonly squaredLength: bigint
    readonly projection: bigint
    readonly radicand: bigint
}

interface Root {
    readonly sign: RootSign
    readonly radicand: bigint
}

export interface CircleIntersection {
    readonly point: Vector2
    // Relative to the circle center, independently of rounded world coordinates.
    readonly direction: Vector2
}

function circleEquation(operand: LineOperand, circle: Circle): CircleEquation {
    if (!isLineDomain(operand.domain)) {
        throw new RangeError(
            `Unsupported line domain: ${String(operand.domain)}.`,
        )
    }

    const line = createLine(operand.line.start, operand.line.end)
    const checked = createCircle(circle.center, circle.radius)
    const {
        exponent,
        values: [sx, sy, ex, ey, cx, cy, radius],
    } = integerCoordinates([
        line.start.x,
        line.start.y,
        line.end.x,
        line.end.y,
        checked.center.x,
        checked.center.y,
        checked.radius,
    ])
    const start = { x: sx, y: sy }
    const direction = { x: ex - sx, y: ey - sy }
    const offset = { x: sx - cx, y: sy - cy }
    const squaredLength = direction.x ** 2n + direction.y ** 2n
    const projection = -(offset.x * direction.x + offset.y * direction.y)
    const cross = offset.x * direction.y - offset.y * direction.x
    const radicand = squaredLength * radius ** 2n - cross ** 2n

    return {
        exponent,
        start,
        direction,
        offset,
        radius,
        squaredLength,
        projection,
        radicand,
    }
}

function rootSide(base: bigint, root: Root): number {
    if (base === 0n) {
        return root.radicand === 0n ? 0 : root.sign
    }

    const sign = base < 0n ? -1 : 1

    if (sign === root.sign) {
        return sign
    }

    const square = base ** 2n

    if (square === root.radicand) {
        return 0
    }

    return square > root.radicand ? sign : root.sign
}

function isOnSegment(equation: CircleEquation, root: Root): boolean {
    return (
        rootSide(equation.projection, root) >= 0 &&
        rootSide(equation.projection - equation.squaredLength, root) <= 0
    )
}

function circleHit(equation: CircleEquation, root: Root): CircleIntersection {
    const {
        exponent,
        start,
        direction,
        offset,
        radius,
        squaredLength,
        projection,
        radicand,
    } = equation
    const sign = BigInt(root.sign)
    const coordinate = (axis: keyof Vector2): number =>
        roundSurd(
            {
                base:
                    start[axis] * squaredLength + direction[axis] * projection,
                coefficient: direction[axis] * sign,
                radicand,
                denominator: squaredLength,
            },
            exponent,
        )
    // Directions are dimensionless, independent of the world-coordinate scale.
    const unit = (axis: keyof Vector2): number =>
        roundSurd(
            {
                base:
                    offset[axis] * squaredLength + direction[axis] * projection,
                coefficient: direction[axis] * sign,
                radicand,
                denominator: squaredLength * radius,
            },
            0,
        )

    return {
        point: { x: coordinate('x'), y: coordinate('y') },
        direction: { x: unit('x'), y: unit('y') },
    }
}

// Roots stay distinct even when their world coordinates round to the same point.
export function lineCircleIntersections(
    operand: LineOperand,
    circle: Circle,
): readonly CircleIntersection[] {
    const equation = circleEquation(operand, circle)

    if (equation.radicand < 0n) {
        return []
    }

    const signs = equation.radicand === 0n ? [1 as RootSign] : ROOT_SIGNS
    const hits: CircleIntersection[] = []

    for (const sign of signs) {
        const root = { sign, radicand: equation.radicand }

        if (operand.domain === 'infinite' || isOnSegment(equation, root)) {
            hits.push(circleHit(equation, root))
        }
    }

    return hits
}

// Results follow the line's start-to-end direction; no model tolerance is applied.
export function intersectLineCircle(
    operand: LineOperand,
    circle: Circle,
): readonly Vector2[] {
    return lineCircleIntersections(operand, circle).map((hit) => hit.point)
}
