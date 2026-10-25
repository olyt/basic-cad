import { type Polyline, type PolylineSegment } from './curve'
import { copySegment, segmentEndpoints } from './segment'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from './tolerance'

export type PolylineInput = Omit<Polyline, 'type'>

// Structural validation shared by operations on an already admitted polyline.
// Connectivity still belongs to createPolyline's explicit model tolerance.
export function copyPolylineSegments({
    segments,
    closed,
}: PolylineInput): [PolylineSegment, ...PolylineSegment[]] {
    if (typeof closed !== 'boolean') {
        throw new RangeError('Polyline closure flag must be a boolean.')
    }

    const copies = segments.map(copySegment)
    const [first, ...rest] = copies

    if (!first) {
        throw new RangeError('A polyline needs at least one segment.')
    }

    if (closed && copies.length < 2) {
        throw new RangeError('A closed polyline needs at least two segments.')
    }

    return [first, ...rest]
}

export function createPolyline(
    input: PolylineInput,
    tolerance: ModelTolerance,
): Polyline {
    const checkedTolerance = createModelTolerance(tolerance.distance)
    const copies = copyPolylineSegments(input)
    const first = segmentEndpoints(copies[0])
    let previous = first

    for (const segment of copies.slice(1)) {
        const current = segmentEndpoints(segment)

        if (!pointsCoincide(previous.end, current.start, checkedTolerance)) {
            throw new RangeError(
                'Polyline segments must connect in their given order.',
            )
        }

        previous = current
    }

    if (
        input.closed &&
        !pointsCoincide(previous.end, first.start, checkedTolerance)
    ) {
        throw new RangeError('Closed polyline endpoints must coincide.')
    }

    return { type: 'polyline', segments: copies, closed: input.closed }
}
