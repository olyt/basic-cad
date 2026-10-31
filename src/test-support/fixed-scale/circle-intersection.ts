// Frozen reference generated before operand-based scaling.
// Keep independent of the optimized arithmetic and its callers.
import { createCircle, type Circle } from '../../geometry/curve'
import { integerCoordinate, roundSurd } from './exact'
import { type Vector2 } from '../../geometry/vector'

export type CircularIntersectionKind =
    'points' | 'none' | 'concentric' | 'coincident'

export type CircularIntersection =
    | {
          readonly kind: Extract<CircularIntersectionKind, 'points'>
          readonly points: readonly Vector2[]
      }
    | { readonly kind: Exclude<CircularIntersectionKind, 'points'> }

export interface CirclePairHit {
    readonly point: Vector2
    readonly firstDirection: Vector2
    readonly secondDirection: Vector2
}

export type CirclePairIntersections =
    | {
          readonly kind: Extract<CircularIntersectionKind, 'points'>
          readonly hits: readonly CirclePairHit[]
      }
    | { readonly kind: Exclude<CircularIntersectionKind, 'points'> }

interface IntegerVector {
    readonly x: bigint
    readonly y: bigint
}

interface CircleEquation {
    readonly center: IntegerVector
    readonly delta: IntegerVector
    readonly firstRadius: bigint
    readonly secondRadius: bigint
    readonly squaredDistance: bigint
    readonly projection: bigint
    readonly radicand: bigint
}

const ROOT_SIGNS = [-1, 1] as const

type RootSign = (typeof ROOT_SIGNS)[number]

function integerVector(point: Vector2): IntegerVector {
    return { x: integerCoordinate(point.x), y: integerCoordinate(point.y) }
}

function circleEquation(first: Circle, second: Circle): CircleEquation {
    const a = createCircle(first.center, first.radius)
    const b = createCircle(second.center, second.radius)
    const center = integerVector(a.center)
    const other = integerVector(b.center)
    const delta = { x: other.x - center.x, y: other.y - center.y }
    const firstRadius = integerCoordinate(a.radius)
    const secondRadius = integerCoordinate(b.radius)
    const squaredDistance = delta.x ** 2n + delta.y ** 2n
    const projection = squaredDistance + firstRadius ** 2n - secondRadius ** 2n
    const radicand = 4n * squaredDistance * firstRadius ** 2n - projection ** 2n

    return {
        center,
        delta,
        firstRadius,
        secondRadius,
        squaredDistance,
        projection,
        radicand,
    }
}

function circleHit(equation: CircleEquation, side: RootSign): CirclePairHit {
    const {
        center,
        delta,
        firstRadius,
        secondRadius,
        squaredDistance,
        projection,
        radicand,
    } = equation
    const denominator = 2n * squaredDistance
    const normal = { x: -delta.y * BigInt(side), y: delta.x * BigInt(side) }
    const coordinate = (axis: keyof Vector2): number =>
        roundSurd({
            base: center[axis] * denominator + delta[axis] * projection,
            coefficient: normal[axis],
            radicand,
            denominator,
        })
    const direction = (localProjection: bigint, radius: bigint): Vector2 => {
        const component = (axis: keyof Vector2): number =>
            roundSurd({
                base: (delta[axis] * localProjection) << 1074n,
                coefficient: normal[axis] << 1074n,
                radicand,
                denominator: denominator * radius,
            })

        return { x: component('x'), y: component('y') }
    }

    return {
        point: { x: coordinate('x'), y: coordinate('y') },
        firstDirection: direction(projection, firstRadius),
        secondDirection: direction(projection - denominator, secondRadius),
    }
}

// Roots follow the negative then positive side of the first-to-second center ray.
export function circleIntersections(
    first: Circle,
    second: Circle,
): CirclePairIntersections {
    const equation = circleEquation(first, second)

    if (equation.squaredDistance === 0n) {
        return {
            kind:
                equation.firstRadius === equation.secondRadius
                    ? 'coincident'
                    : 'concentric',
        }
    }

    if (equation.radicand < 0n) {
        return { kind: 'none' }
    }

    const signs = equation.radicand === 0n ? ROOT_SIGNS.slice(1) : ROOT_SIGNS

    return {
        kind: 'points',
        hits: signs.map((side) => circleHit(equation, side)),
    }
}

export function intersectCircles(
    first: Circle,
    second: Circle,
): CircularIntersection {
    const result = circleIntersections(first, second)

    if (result.kind !== 'points') {
        return result
    }

    return { kind: 'points', points: result.hits.map(({ point }) => point) }
}
