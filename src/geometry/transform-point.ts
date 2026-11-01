import { FULL_TURN } from './angle'
import { createLine, type Line } from './curve'
import { integerCoordinates, roundRational } from './exact'
import { add, assertFiniteVector2, createVector2, type Vector2 } from './vector'

export type TransformType = 'move' | 'rotate' | 'scale' | 'mirror'

interface TransformOf<T extends TransformType> {
    readonly type: T
}

export interface MoveTransform extends TransformOf<'move'> {
    readonly offset: Vector2
}

export interface RotateTransform extends TransformOf<'rotate'> {
    readonly center: Vector2
    readonly angle: number
}

export interface ScaleTransform extends TransformOf<'scale'> {
    readonly center: Vector2
    readonly factor: number
}

export interface MirrorTransform extends TransformOf<'mirror'> {
    readonly axis: Line
}

export type CurveTransform =
    MoveTransform | RotateTransform | ScaleTransform | MirrorTransform

export interface PreparedTransform {
    readonly scale: number
    readonly angleOffset: number
    readonly reflected: boolean
    point(point: Vector2): Vector2
}

interface LinearMap {
    readonly origin: Vector2
    readonly xx: bigint
    readonly xy: bigint
    readonly yx: bigint
    readonly yy: bigint
    readonly denominator: bigint
    readonly exponent: number
}

function linearPoint(map: LinearMap, point: Vector2): Vector2 {
    assertFiniteVector2(point)

    const {
        exponent,
        values: [x, y, originX, originY],
    } = integerCoordinates([point.x, point.y, map.origin.x, map.origin.y])
    const xOffset = x - originX
    const yOffset = y - originY
    const denominator = map.denominator << BigInt(Math.max(0, -map.exponent))
    const coefficientScale = BigInt(Math.max(0, map.exponent))
    const coordinate = (origin: bigint, offset: bigint) =>
        roundRational(
            {
                numerator: origin * denominator + (offset << coefficientScale),
                denominator,
            },
            exponent,
        )

    return createVector2(
        coordinate(originX, map.xx * xOffset + map.xy * yOffset),
        coordinate(originY, map.yx * xOffset + map.yy * yOffset),
    )
}

function binaryMap(
    origin: Vector2,
    coefficients: readonly [number, number, number, number],
): LinearMap {
    const {
        exponent,
        values: [xx, xy, yx, yy],
    } = integerCoordinates(coefficients)

    return {
        origin: createVector2(origin.x, origin.y),
        xx,
        xy,
        yx,
        yy,
        denominator: 1n,
        exponent,
    }
}

function reflectionMap(axis: Line): LinearMap {
    const {
        values: [startX, startY, endX, endY],
    } = integerCoordinates([axis.start.x, axis.start.y, axis.end.x, axis.end.y])
    const x = endX - startX
    const y = endY - startY
    const diagonal = x * x - y * y
    const cross = 2n * x * y

    return {
        origin: axis.start,
        xx: diagonal,
        xy: cross,
        yx: cross,
        yy: -diagonal,
        denominator: x * x + y * y,
        exponent: 0,
    }
}

function quarterDirection(quarter: number): { cosine: bigint; sine: bigint } {
    switch (((quarter % 4) + 4) % 4) {
        case 0:
            return { cosine: 1n, sine: 0n }
        case 1:
            return { cosine: 0n, sine: 1n }
        case 2:
            return { cosine: -1n, sine: 0n }
        default:
            return { cosine: 0n, sine: -1n }
    }
}

function rotationMap(origin: Vector2, angle: number): LinearMap {
    const quarter = Math.round(angle / (Math.PI / 2))
    const residual = angle - quarter * (Math.PI / 2)
    const { cosine, sine } = quarterDirection(quarter)
    const {
        values: [halfSine, fullSine, unit],
    } = integerCoordinates([Math.sin(residual / 2), Math.sin(residual), 1])
    const denominator = unit * unit
    // Retain cos(residual) - 1 before it can round away at a distant pivot.
    const residualCosine = denominator - 2n * halfSine * halfSine
    const residualSine = fullSine * unit
    const xx = cosine * residualCosine - sine * residualSine
    const yx = sine * residualCosine + cosine * residualSine

    return {
        origin: createVector2(origin.x, origin.y),
        xx,
        xy: -yx,
        yx,
        yy: xx,
        denominator,
        exponent: 0,
    }
}

function linearTransform(
    map: LinearMap,
    properties: Omit<PreparedTransform, 'point'>,
): PreparedTransform {
    return { ...properties, point: (point) => linearPoint(map, point) }
}

function rotation(input: RotateTransform): PreparedTransform {
    if (!Number.isFinite(input.angle)) {
        throw new RangeError('Rotation angle must be finite.')
    }

    const remainder = input.angle % FULL_TURN
    const angle =
        Math.abs(remainder) > Math.PI
            ? remainder - Math.sign(remainder) * FULL_TURN
            : remainder
    const map = rotationMap(input.center, angle)

    return linearTransform(map, {
        scale: 1,
        angleOffset: angle,
        reflected: false,
    })
}

function scaling(input: ScaleTransform): PreparedTransform {
    if (!Number.isFinite(input.factor) || input.factor <= 0) {
        throw new RangeError(
            'Uniform scale factor must be positive and finite.',
        )
    }

    const map = binaryMap(input.center, [input.factor, 0, 0, input.factor])

    return linearTransform(map, {
        scale: input.factor,
        angleOffset: 0,
        reflected: false,
    })
}

function reflection(input: MirrorTransform): PreparedTransform {
    const axis = createLine(input.axis.start, input.axis.end)
    const angleOffset =
        2 * Math.atan2(axis.end.y - axis.start.y, axis.end.x - axis.start.x)

    return linearTransform(reflectionMap(axis), {
        scale: 1,
        angleOffset,
        reflected: true,
    })
}

export function prepareTransform(transform: CurveTransform): PreparedTransform {
    switch (transform.type) {
        case 'move': {
            const offset = createVector2(transform.offset.x, transform.offset.y)

            return {
                point: (point) => add(point, offset),
                scale: 1,
                angleOffset: 0,
                reflected: false,
            }
        }

        case 'rotate':
            return rotation(transform)
        case 'scale':
            return scaling(transform)
        case 'mirror':
            return reflection(transform)

        default: {
            const unsupported: never = transform

            throw new RangeError(
                `Unsupported transform type: ${String((unsupported as { type?: unknown }).type)}.`,
            )
        }
    }
}
