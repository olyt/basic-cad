import {
    createArc,
    createCircle,
    createLine,
    type Curve,
    type PolylineSegment,
} from '../geometry/curve'
import { createPolyline } from '../geometry/polyline'
import {
    createModelTolerance,
    type ModelTolerance,
} from '../geometry/tolerance'
import { type Vector2 } from '../geometry/vector'
import { readBoolean, readNumber, readRecord } from './record'

function readPoint(value: unknown): Vector2 {
    const { x, y } = readRecord(value)

    return { x: readNumber(x, 'Point x'), y: readNumber(y, 'Point y') }
}

function admitSegment(
    record: Record<string, unknown>,
    type: unknown,
): PolylineSegment {
    switch (type) {
        case 'line': {
            const { start, end } = record

            return createLine(readPoint(start), readPoint(end))
        }

        case 'arc': {
            const { center, radius, startAngle, sweep } = record

            return createArc({
                center: readPoint(center),
                radius: readNumber(radius, 'Radius'),
                startAngle: readNumber(startAngle, 'Arc start angle'),
                sweep: readNumber(sweep, 'Arc sweep'),
            })
        }

        default:
            throw new RangeError('Curve segment type must be line or arc.')
    }
}

function readSegment(value: unknown): PolylineSegment {
    const record = readRecord(value)
    const { type } = record

    return admitSegment(record, type)
}

export function admitCurve(
    value: unknown,
    modelTolerance: ModelTolerance,
): Curve {
    const { distance } = readRecord(modelTolerance)
    const tolerance = createModelTolerance(
        readNumber(distance, 'Model tolerance'),
    )
    const record = readRecord(value)
    const { type } = record

    if (type === 'circle') {
        const { center, radius } = record

        return createCircle(readPoint(center), readNumber(radius, 'Radius'))
    }

    if (type !== 'polyline') {
        return admitSegment(record, type)
    }

    const { segments, closed } = record

    if (!Array.isArray(segments)) {
        throw new RangeError('Polyline segments must be an array.')
    }

    return createPolyline(
        {
            segments: Array.from(segments, readSegment),
            closed: readBoolean(closed, 'Polyline closure'),
        },
        tolerance,
    )
}
