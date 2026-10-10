export interface Vector2 {
    readonly x: number
    readonly y: number
}

export function assertFiniteVector2(value: Vector2): void {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
        throw new RangeError('Vector components must be finite.')
    }
}

function finiteResult(value: number): number {
    if (!Number.isFinite(value)) {
        throw new RangeError('Geometry result exceeds the finite number range.')
    }

    return value
}

export function createVector2(x: number, y: number): Vector2 {
    const value = { x, y }

    assertFiniteVector2(value)

    return value
}

export function add(a: Vector2, b: Vector2): Vector2 {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    return createVector2(a.x + b.x, a.y + b.y)
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    return createVector2(a.x - b.x, a.y - b.y)
}

export function scale(value: Vector2, factor: number): Vector2 {
    assertFiniteVector2(value)

    if (!Number.isFinite(factor)) {
        throw new RangeError('Scale factor must be finite.')
    }

    return createVector2(value.x * factor, value.y * factor)
}

export function dot(a: Vector2, b: Vector2): number {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    return finiteResult(a.x * b.x + a.y * b.y)
}

// Positive for a counterclockwise turn from a to b.
export function cross(a: Vector2, b: Vector2): number {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    return finiteResult(a.x * b.y - a.y * b.x)
}

export function length(value: Vector2): number {
    assertFiniteVector2(value)

    return finiteResult(Math.hypot(value.x, value.y))
}

export function distance(a: Vector2, b: Vector2): number {
    assertFiniteVector2(a)
    assertFiniteVector2(b)

    return finiteResult(Math.hypot(a.x - b.x, a.y - b.y))
}

export function normalize(value: Vector2): Vector2 {
    assertFiniteVector2(value)

    const largest = Math.max(Math.abs(value.x), Math.abs(value.y))

    if (largest === 0) {
        throw new RangeError('Cannot normalize a zero vector.')
    }

    // Scaling first avoids overflow and loss of direction for subnormal values.
    const x = value.x / largest
    const y = value.y / largest
    const magnitude = Math.hypot(x, y)

    return createVector2(x / magnitude, y / magnitude)
}

export function perpendicular(value: Vector2): Vector2 {
    assertFiniteVector2(value)

    return createVector2(-value.y, value.x)
}
