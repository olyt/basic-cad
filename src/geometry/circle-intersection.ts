import { createCircle, type Circle } from './curve'
import { integerCoordinates, roundSurd } from './exact'
import { type Vector2 } from './vector'

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
    readonly exponent: number
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

function circleEquation(first: Circle, second: Circle): CircleEquation {
    const a = createCircle(first.center, first.radius)
    const b = createCircle(second.center, second.radius)
    const {
        exponent,
        values: [ax, ay, bx, by, firstRadius, secondRadius],
    } = integerCoordinates([
        a.center.x,
        a.center.y,
        b.center.x,
        b.center.y,
        a.radius,
        b.radius,
    ])
    const center = { x: ax, y: ay }
    const delta = { x: bx - ax, y: by - ay }
    const squaredDistance = delta.x ** 2n + delta.y ** 2n
    const projection = squaredDistance + firstRadius ** 2n - secondRadius ** 2n
    const radicand = 4n * squaredDistance * firstRadius ** 2n - projection ** 2n

    return {
        exponent,
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
        exponent,
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
        roundSurd(
            {
                base: center[axis] * denominator + delta[axis] * projection,
                coefficient: normal[axis],
                radicand,
                denominator,
            },
            exponent,
        )
    const direction = (localProjection: bigint, radius: bigint): Vector2 => {
        const component = (axis: keyof Vector2): number =>
            roundSurd(
                {
                    base: delta[axis] * localProjection,
                    coefficient: normal[axis],
                    radicand,
                    denominator: denominator * radius,
                },
                0,
            )

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
