import { FULL_TURN, normalizeAngle } from './angle'
import { createVector2, type Vector2 } from './vector'

// Every curve kind the geometry kernel supports.
export type CurveType = 'line' | 'circle' | 'arc'

// Restricts each curve's tag to the list above.
interface CurveOf<T extends CurveType> {
    readonly type: T
}

export interface Line extends CurveOf<'line'> {
    readonly start: Vector2
    readonly end: Vector2
}

export interface Circle extends CurveOf<'circle'> {
    readonly center: Vector2
    readonly radius: number
}

export interface Arc extends CurveOf<'arc'> {
    readonly center: Vector2
    readonly radius: number
    // Normalized radians in [0, 2π).
    readonly startAngle: number
    // Radians: positive counterclockwise, negative clockwise; excludes full turns.
    readonly sweep: number
}

export type Curve = Line | Circle | Arc

export const MAX_COORDINATE = 1e15

function supportedPoint(point: Vector2): Vector2 {
    const copy = createVector2(point.x, point.y)

    if (
        Math.abs(copy.x) > MAX_COORDINATE ||
        Math.abs(copy.y) > MAX_COORDINATE
    ) {
        throw new RangeError(
            `Coordinates must be within ±${MAX_COORDINATE.toExponential()} drawing units.`,
        )
    }

    return copy
}

function assertSupportedRadius(radius: number): void {
    if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_COORDINATE) {
        throw new RangeError(
            `Radius must be positive and at most ${MAX_COORDINATE.toExponential()} drawing units.`,
        )
    }
}

export function createLine(start: Vector2, end: Vector2): Line {
    const startPoint = supportedPoint(start)
    const endPoint = supportedPoint(end)

    if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) {
        throw new RangeError('Line endpoints must be distinct.')
    }

    return { type: 'line', start: startPoint, end: endPoint }
}

export function createCircle(center: Vector2, radius: number): Circle {
    assertSupportedRadius(radius)

    return {
        type: 'circle',
        center: supportedPoint(center),
        radius,
    }
}

export function createArc(
    center: Vector2,
    radius: number,
    startAngle: number,
    sweep: number,
): Arc {
    assertSupportedRadius(radius)

    if (
        !Number.isFinite(sweep) ||
        sweep === 0 ||
        Math.abs(sweep) >= FULL_TURN
    ) {
        throw new RangeError(
            'Arc sweep must be finite, nonzero and smaller than a full turn. Use a circle for a full turn.',
        )
    }

    return {
        type: 'arc',
        center: supportedPoint(center),
        radius,
        startAngle: normalizeAngle(startAngle),
        sweep,
    }
}
