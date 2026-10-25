import { type Polyline } from './curve'
import { copySegment, segmentEndpoints } from './segment'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from './tolerance'

export type PolylineInput = Omit<Polyline, 'type'>

export function createPolyline(
    { segments, closed }: PolylineInput,
    tolerance: ModelTolerance,
): Polyline {
    const checkedTolerance = createModelTolerance(tolerance.distance)

    if (typeof closed !== 'boolean') {
        throw new RangeError('Polyline closure flag must be a boolean.')
    }

    const copies = segments.map(copySegment)
    const endpoints = copies.map(segmentEndpoints)
    const first = endpoints[0]
    const last = endpoints.at(-1)

    if (!first || !last) {
        throw new RangeError('A polyline needs at least one segment.')
    }

    if (closed && copies.length < 2) {
        throw new RangeError('A closed polyline needs at least two segments.')
    }

    for (const [index, current] of endpoints.entries()) {
        const previous = endpoints[index - 1]

        if (
            previous &&
            !pointsCoincide(previous.end, current.start, checkedTolerance)
        ) {
            throw new RangeError(
                'Polyline segments must connect in their given order.',
            )
        }
    }

    if (closed && !pointsCoincide(last.end, first.start, checkedTolerance)) {
        throw new RangeError('Closed polyline endpoints must coincide.')
    }

    return { type: 'polyline', segments: copies, closed }
}
