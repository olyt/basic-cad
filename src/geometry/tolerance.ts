import { assertFiniteVector2, type Vector2 } from './vector'

export interface ModelTolerance {
    // Absolute distance in drawing units.
    readonly distance: number
}

function toleranceDistance(tolerance: ModelTolerance): number {
    if (!Number.isFinite(tolerance.distance) || tolerance.distance < 0) {
        throw new RangeError('Model tolerance must be finite and nonnegative.')
    }

    return tolerance.distance
}

export function createModelTolerance(distance: number): ModelTolerance {
    const tolerance = { distance }

    toleranceDistance(tolerance)

    return tolerance
}

export function numbersEqual(
    a: number,
    b: number,
    tolerance: ModelTolerance,
): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new RangeError('Compared values must be finite.')
    }

    return Math.abs(a - b) <= toleranceDistance(tolerance)
}

export function pointsCoincide(
    a: Vector2,
    b: Vector2,
    tolerance: ModelTolerance,
): boolean {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    // An overflowing separation is larger than any finite tolerance.
    return Math.hypot(a.x - b.x, a.y - b.y) <= toleranceDistance(tolerance)
}
