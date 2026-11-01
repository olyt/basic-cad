import { FULL_TURN } from './angle'
import {
    createArc,
    createCircle,
    createLine,
    type Arc,
    type ArcInput,
    type Circle,
    type Line,
    type PolylineSegment,
} from './curve'
import { integerCoordinates, roundRational } from './exact'
import { curveLength } from './length'
import { copySegment } from './segment'
import { createModelTolerance, type ModelTolerance } from './tolerance'

export interface ParameterInterval {
    readonly start: number
    readonly end: number
}

interface PrimitiveInterval extends ParameterInterval {
    readonly modelTolerance: ModelTolerance
}

interface ExactArcInterval {
    readonly start: bigint
    readonly sweep: bigint
    readonly turn: bigint
    readonly exponent: number
}

function magnitude(value: bigint): bigint {
    return value < 0n ? -value : value
}

function modulo(value: bigint, period: bigint): bigint {
    const remainder = value % period

    return remainder < 0n ? remainder + period : remainder
}

function assertInterval(interval: ParameterInterval, periodic: boolean): void {
    const { start, end } = interval

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new RangeError('Curve interval parameters must be finite.')
    }

    const outsideSegment = start < 0 || end > 1

    if (!periodic && outsideSegment) {
        throw new RangeError('Segment interval must be within [0, 1].')
    }

    if (!periodic && start >= end) {
        throw new RangeError(
            'Open curve interval must run forward and be nonempty.',
        )
    }
}

function linePoint(line: Line, parameter: number) {
    const {
        exponent,
        values: [x, y, endX, endY, fraction, unit],
    } = integerCoordinates([
        line.start.x,
        line.start.y,
        line.end.x,
        line.end.y,
        parameter,
        1,
    ])
    const coordinate = (start: bigint, end: bigint) =>
        roundRational(
            {
                numerator: start * unit + (end - start) * fraction,
                denominator: 1n,
            },
            2 * exponent,
        )

    return { x: coordinate(x, endX), y: coordinate(y, endY) }
}

function exactArcInterval(
    traversal: ArcInput,
    interval: ParameterInterval,
): ExactArcInterval {
    const periodic = traversal.sweep === FULL_TURN
    const {
        exponent,
        values: [angle, sweep, start, end, turn, unit],
    } = integerCoordinates([
        traversal.startAngle,
        traversal.sweep,
        periodic ? interval.start % 1 : interval.start,
        periodic ? interval.end % 1 : interval.end,
        FULL_TURN,
        1,
    ])
    const first = periodic ? modulo(start, unit) : start
    const span = periodic ? modulo(end - start, unit) : end - start

    if (span === 0n) {
        throw new RangeError('Curve interval endpoints must be distinct.')
    }

    return {
        start: modulo(angle * unit + sweep * first, turn * unit),
        sweep: sweep * span,
        turn: turn * unit,
        exponent: 2 * exponent,
    }
}

function withinPositionBudget(input: {
    readonly radius: number
    readonly error: bigint
    readonly exponent: number
    readonly modelTolerance: ModelTolerance
}): boolean {
    const {
        values: [radius, distance],
    } = integerCoordinates([input.radius, input.modelTolerance.distance])
    const errorScale = BigInt(Math.max(0, input.exponent))
    const budgetScale = BigInt(Math.max(0, -input.exponent))

    return (4n * input.error * radius) << errorScale <= distance << budgetScale
}

function assertArcPrecision(
    arc: Arc,
    input: {
        readonly exact: ExactArcInterval
        readonly modelTolerance: ModelTolerance
    },
): void {
    const { exact, modelTolerance } = input
    const {
        exponent,
        values: [start, sweep],
    } = integerCoordinates([arc.startAngle, arc.sweep])
    const common = Math.min(exponent, exact.exponent)
    const outputScale = BigInt(exponent - common)
    const inputScale = BigInt(exact.exponent - common)
    const turn = exact.turn << inputScale
    const difference =
        magnitude((start << outputScale) - (exact.start << inputScale)) % turn
    const startError =
        difference < turn - difference ? difference : turn - difference
    const sweepError = magnitude(
        (sweep << outputScale) - (exact.sweep << inputScale),
    )
    const budget = magnitude(exact.sweep) << inputScale
    // Bound both angular errors to 1e-8 of the retained span, even for subnormals.
    const exceedsBudget = (error: bigint) => error * 100_000_000n > budget

    const withinRelativeBudget =
        !exceedsBudget(startError) && !exceedsBudget(sweepError)

    if (withinRelativeBudget) {
        return
    }

    if (
        withinPositionBudget({
            radius: arc.radius,
            error: startError + sweepError,
            exponent: common,
            modelTolerance,
        })
    ) {
        return
    }

    throw new RangeError('Arc interval cannot preserve its geometry.')
}

function circularPiece(traversal: ArcInput, interval: PrimitiveInterval): Arc {
    const exact = exactArcInterval(traversal, interval)
    const rounded = (numerator: bigint) =>
        roundRational({ numerator, denominator: 1n }, exact.exponent)
    const arc = createArc({
        center: traversal.center,
        radius: traversal.radius,
        startAngle: rounded(exact.start),
        sweep: rounded(exact.sweep),
    })

    assertArcPrecision(arc, { exact, modelTolerance: interval.modelTolerance })

    return arc
}

export function primitivePiece(
    curve: Line | Arc | Circle,
    interval: PrimitiveInterval,
): PolylineSegment {
    createModelTolerance(interval.modelTolerance?.distance ?? NaN)
    assertInterval(interval, curve.type === 'circle')

    if (curve.type === 'circle') {
        const circle = createCircle(curve.center, curve.radius)
        const arc = circularPiece(
            { ...circle, startAngle: 0, sweep: FULL_TURN },
            interval,
        )

        curveLength(arc)

        return arc
    }

    const segment = copySegment(curve)
    const piece =
        segment.type === 'line'
            ? createLine(
                  linePoint(segment, interval.start),
                  linePoint(segment, interval.end),
              )
            : circularPiece(segment, interval)

    curveLength(piece)

    return piece
}
