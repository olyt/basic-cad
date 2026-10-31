// All angles are in radians, measured counterclockwise from the positive X axis.
export const FULL_TURN = 2 * Math.PI

export type AngleDirection = 'clockwise' | 'counterclockwise'

export interface AngleEndpoints {
    readonly startAngle: number
    readonly endAngle: number
}

export interface ArcAngleQuery {
    readonly angle: number
    readonly startAngle: number
    readonly sweep: number
    readonly angularTolerance: number
}

export function normalizeAngle(angle: number): number {
    if (!Number.isFinite(angle)) {
        throw new RangeError('Angle must be finite.')
    }

    const remainder = angle % FULL_TURN
    const normalized = remainder < 0 ? remainder + FULL_TURN : remainder

    // Adding a turn to a tiny negative value can round up to a full turn.
    if (normalized === 0 || normalized === FULL_TURN) {
        return 0
    }

    return normalized
}

const LARGEST_PARTIAL_TURN = FULL_TURN - 2 ** -50

function unsupportedDirection(direction: never): never {
    throw new RangeError(
        `Angle direction must be clockwise or counterclockwise, not ${String(direction)}.`,
    )
}

function directionSign(direction: AngleDirection): 1 | -1 {
    switch (direction) {
        case 'counterclockwise':
            return 1
        case 'clockwise':
            return -1
        default:
            return unsupportedDirection(direction)
    }
}

// Equal normalized endpoints give zero; full circles need an explicit ±FULL_TURN.
export function signedSweep(
    { startAngle, endAngle }: AngleEndpoints,
    direction: AngleDirection,
): number {
    const sign = directionSign(direction)
    const start = normalizeAngle(startAngle)
    const end = normalizeAngle(endAngle)

    if (start === end) {
        return 0
    }

    const turn = normalizeAngle(sign * (end - start))

    return sign * (turn === 0 ? LARGEST_PARTIAL_TURN : turn)
}

// Delta is the signed angle from the start ray in the sweep direction, in [-π, π].
// Magnitude is the absolute sweep, in [0, 2π].
export function isDeltaInsideSweep(delta: number, magnitude: number): boolean {
    if (!Number.isFinite(delta) || Math.abs(delta) > Math.PI) {
        throw new RangeError('Sweep delta must be finite and within [-π, π].')
    }

    if (!Number.isFinite(magnitude)) {
        throw new RangeError('Sweep magnitude must be finite.')
    }

    if (magnitude < 0 || magnitude > FULL_TURN) {
        throw new RangeError('Sweep magnitude must be within [0, 2π].')
    }

    // Both signs of π describe the same endpoint ray.
    const angle = delta === -Math.PI ? Math.PI : delta

    if (magnitude <= Math.PI) {
        return angle >= 0 && angle <= magnitude
    }

    // Preserve the tiny excluded gap without adding a full turn to delta.
    return angle >= 0 || -angle >= FULL_TURN - magnitude
}

function angularDistance(first: number, second: number): number {
    const gap = Math.abs(first - second)

    return Math.min(gap, FULL_TURN - gap)
}

function counterclockwiseDistance(start: number, end: number): number {
    // Add the small pieces of a wrapped gap before rounding away either one.
    return end >= start ? end - start : FULL_TURN - start + end
}

function isInsideMajorArc(query: ArcAngleQuery): boolean {
    const { angle, startAngle, sweep, angularTolerance } = query
    const gap = FULL_TURN - Math.abs(sweep)
    const distance =
        sweep < 0
            ? counterclockwiseDistance(startAngle, angle)
            : counterclockwiseDistance(angle, startAngle)

    // The complementary gap is open; tolerance includes either nearby boundary.
    return distance <= angularTolerance || gap - distance <= angularTolerance
}

// Includes both endpoints, widened by the tolerance (radians; 0 only for exact checks).
// A zero sweep includes only its start; a signed full turn includes every angle.
export function isAngleInsideArc(query: ArcAngleQuery): boolean {
    const { angle, startAngle, sweep, angularTolerance } = query
    const normalizedAngle = normalizeAngle(angle)
    const normalizedStart = normalizeAngle(startAngle)

    if (!Number.isFinite(sweep) || Math.abs(sweep) > FULL_TURN) {
        throw new RangeError(
            'Arc sweep must be finite and at most one full turn.',
        )
    }

    if (!Number.isFinite(angularTolerance) || angularTolerance < 0) {
        throw new RangeError(
            'Angular tolerance must be finite and nonnegative.',
        )
    }

    const magnitude = Math.abs(sweep)

    if (magnitude === FULL_TURN) {
        return true
    }

    if (magnitude > Math.PI) {
        return isInsideMajorArc({
            angle: normalizedAngle,
            startAngle: normalizedStart,
            sweep,
            angularTolerance,
        })
    }

    const normalizedEnd = normalizeAngle(normalizedStart + sweep)

    if (
        angularDistance(normalizedAngle, normalizedStart) <= angularTolerance ||
        angularDistance(normalizedAngle, normalizedEnd) <= angularTolerance
    ) {
        return true
    }

    const offset =
        sweep < 0
            ? normalizedStart - normalizedAngle
            : normalizedAngle - normalizedStart
    const distance = offset < 0 ? offset + FULL_TURN : offset

    return distance <= magnitude
}
