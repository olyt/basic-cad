import { FULL_TURN } from './angle'
import {
    createArc,
    createLine,
    type Arc,
    type Line,
    type PolylineSegment,
} from './curve'
import { copySegment, segmentEndpoints } from './segment'
import { pointsCoincide } from './tolerance'
import { type Vector2 } from './vector'

export interface BulgeSegment {
    readonly start: Vector2
    readonly end: Vector2
    readonly bulge: number
}

// Reconstruction must retain arc geometry relative to its radius, in addition
// to the input endpoint/chord budget. Neither budget permits flattening an arc.
const RELATIVE_BUDGET = 1e-8

export function segmentToBulge(segment: PolylineSegment): BulgeSegment {
    const copy = copySegment(segment)
    const { start, end } = segmentEndpoints(copy)

    // DXF vertices must remain distinct and within the supported coordinate range.
    const chord = createLine(start, end)

    const bulge = copy.type === 'line' ? 0 : sweepToBulge(copy.sweep)
    // An arc whose bulge rounds to zero would come back as a straight line.
    const representable =
        Number.isFinite(bulge) && (copy.type === 'line' || bulge !== 0)

    if (!representable) {
        throw new RangeError(
            'Arc bulge cannot be represented without losing geometry.',
        )
    }

    if (copy.type === 'arc') {
        assertArcPreserved(copy, arcFromBulge(chord, bulge))
    }

    return { start, end, bulge }
}

export function bulgeToSegment({
    start,
    end,
    bulge,
}: BulgeSegment): PolylineSegment {
    if (!Number.isFinite(bulge)) {
        throw new RangeError('Bulge must be finite.')
    }

    const line = createLine(start, end)

    if (bulge === 0) {
        return line
    }

    const arc = arcFromBulge(line, bulge)
    const reconstructed = segmentToBulge(arc)
    const scale = Math.max(
        Math.hypot(end.x - start.x, end.y - start.y),
        Math.abs(start.x),
        Math.abs(start.y),
        Math.abs(end.x),
        Math.abs(end.y),
    )
    const tolerance = { distance: scale * RELATIVE_BUDGET }

    if (
        !pointsCoincide(reconstructed.start, line.start, tolerance) ||
        !pointsCoincide(reconstructed.end, line.end, tolerance)
    ) {
        throw new RangeError('Arc conversion cannot preserve its endpoints.')
    }

    return arc
}

function arcFromBulge(line: Line, bulge: number): Arc {
    const x = line.end.x - line.start.x
    const y = line.end.y - line.start.y
    const chord = Math.hypot(x, y)
    const magnitude = Math.abs(bulge)
    // Avoid squaring bulge or taking its reciprocal before multiplying the chord.
    const small = chord / magnitude
    const large = chord * magnitude
    const radius = (small + large) / 4
    const offset = (Math.sign(bulge) * (small - large)) / 4
    const center = {
        x: line.start.x + x / 2 - (y / chord) * offset,
        y: line.start.y + y / 2 + (x / chord) * offset,
    }

    return createArc({
        center,
        radius,
        startAngle: Math.atan2(
            line.start.y - center.y,
            line.start.x - center.x,
        ),
        sweep: bulgeToSweep(bulge),
    })
}

function assertArcPreserved(original: Arc, restored: Arc): void {
    const radiusBudget = original.radius * RELATIVE_BUDGET
    const centerError = Math.hypot(
        original.center.x - restored.center.x,
        original.center.y - restored.center.y,
    )

    assertWithinBudget(centerError, radiusBudget)
    assertWithinBudget(
        Math.abs(original.radius - restored.radius),
        radiusBudget,
    )

    const angleDifference = Math.abs(original.startAngle - restored.startAngle)
    const startAngleError = Math.min(
        angleDifference,
        FULL_TURN - angleDifference,
    )

    assertWithinBudget(startAngleError, RELATIVE_BUDGET)
    assertWithinBudget(
        Math.abs(original.sweep - restored.sweep),
        Math.abs(original.sweep) * RELATIVE_BUDGET,
    )
}

function assertWithinBudget(error: number, budget: number): void {
    if (error > budget) {
        throw new RangeError('Arc bulge cannot preserve its geometry.')
    }
}

function sweepToBulge(sweep: number): number {
    if (Math.abs(sweep) <= Math.PI) {
        return Math.tan(sweep / 4)
    }

    return Math.sign(sweep) / Math.tan((FULL_TURN - Math.abs(sweep)) / 4)
}

function bulgeToSweep(bulge: number): number {
    if (Math.abs(bulge) <= 1) {
        return 4 * Math.atan(bulge)
    }

    return Math.sign(bulge) * (FULL_TURN - 4 * Math.atan(1 / Math.abs(bulge)))
}
