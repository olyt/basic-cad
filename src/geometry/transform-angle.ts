import { FULL_TURN, normalizeAngle } from './angle'
import { type Arc } from './curve'
import { integerCoordinates, roundRational } from './exact'
import { type ModelTolerance } from './tolerance'
import { type PreparedTransform } from './transform-point'

interface ArcPhaseQuery {
    readonly transform: PreparedTransform
    readonly radius: number
    readonly modelTolerance: ModelTolerance
}

function modulo(value: bigint, period: bigint): bigint {
    const remainder = value % period

    return remainder < 0n ? remainder + period : remainder
}

function phaseAngle(arc: Arc, transform: PreparedTransform): number {
    const {
        exponent,
        values: [start, offset, turn],
    } = integerCoordinates([arc.startAngle, transform.angleOffset, FULL_TURN])
    const target = modulo((transform.reflected ? -start : start) + offset, turn)

    return normalizeAngle(
        roundRational({ numerator: target, denominator: 1n }, exponent),
    )
}

export function transformArcAngle(arc: Arc, input: ArcPhaseQuery): number {
    const { transform, radius, modelTolerance } = input
    const result = phaseAngle(arc, transform)
    const {
        values: [
            stored,
            start,
            offset,
            turn,
            sweep,
            scaledRadius,
            distance,
            unit,
        ],
    } = integerCoordinates([
        result,
        arc.startAngle,
        transform.angleOffset,
        FULL_TURN,
        Math.abs(arc.sweep),
        radius,
        modelTolerance.distance,
        1,
    ])
    const target = modulo((transform.reflected ? -start : start) + offset, turn)
    const difference = stored > target ? stored - target : target - stored
    const error =
        difference < turn - difference ? difference : turn - difference
    const withinRelativeBudget = error * 100_000_000n <= sweep
    const withinModelBudget = 4n * error * scaledRadius <= distance * unit

    if (!withinRelativeBudget && !withinModelBudget) {
        throw new RangeError('Transform cannot preserve the arc start angle.')
    }

    return result
}
