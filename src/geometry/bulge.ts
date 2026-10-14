import { FULL_TURN } from './angle'
import { createArc, createLine, type PolylineSegment } from './curve'
import { copySegment, segmentEndpoints } from './segment'
import { pointsCoincide } from './tolerance'
import { type Vector2 } from './vector'

export interface BulgeSegment {
    readonly start: Vector2
    readonly end: Vector2
    readonly bulge: number
}

export function segmentToBulge(segment: PolylineSegment): BulgeSegment {
    const copy = copySegment(segment)
    const { start, end } = segmentEndpoints(copy)

    // DXF vertices must remain distinct and within the supported coordinate range.
    createLine(start, end)

    const bulge = copy.type === 'line' ? 0 : sweepToBulge(copy.sweep)

    if (!Number.isFinite(bulge) || (copy.type === 'arc' && bulge === 0)) {
        throw new RangeError(
            'Arc bulge cannot be represented without losing geometry.',
        )
    }

    return { start, end, bulge }
}

export function bulgeToSegment(
    start: Vector2,
    end: Vector2,
    bulge: number,
): PolylineSegment {
    if (!Number.isFinite(bulge)) {
        throw new RangeError('Bulge must be finite.')
    }

    const line = createLine(start, end)

    if (bulge === 0) {
        return line
    }

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
    const arc = createArc(
        center,
        radius,
        Math.atan2(line.start.y - center.y, line.start.x - center.x),
        bulgeToSweep(bulge),
    )

    const reconstructed = segmentToBulge(arc)
    // Require eight significant digits relative to the input endpoint/chord scale.
    // This numerical admission budget is separate from model connectivity tolerance.
    const scale = Math.max(
        chord,
        Math.abs(start.x),
        Math.abs(start.y),
        Math.abs(end.x),
        Math.abs(end.y),
    )
    const tolerance = { distance: scale * 1e-8 }

    if (
        !pointsCoincide(reconstructed.start, line.start, tolerance) ||
        !pointsCoincide(reconstructed.end, line.end, tolerance)
    ) {
        throw new RangeError('Arc conversion cannot preserve its endpoints.')
    }

    return arc
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
