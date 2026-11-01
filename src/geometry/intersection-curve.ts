import { type Curve } from './curve'
import { type CurveLocation } from './evaluation'
import { type ParameterLocation } from './intersection-location'
import {
    prepareIntersectionPart,
    type IntersectionPart,
} from './intersection-part'
import { copyPolylineSegments } from './polyline'
import { type Vector2 } from './vector'

export interface IntersectionCurve {
    readonly parts: readonly IntersectionPart[]
    readonly polyline: boolean
    readonly closed: boolean
    readonly starts: readonly CurveLocation[]
    readonly ends: readonly CurveLocation[]
}

interface PartLocation {
    readonly partIndex: number
    readonly point: Vector2
    readonly root: ParameterLocation
}

interface LocatedCurvePoint {
    readonly location: CurveLocation
    readonly endpoint: boolean
}

function samePoint(first: Vector2, second: Vector2): boolean {
    return first.x === second.x && first.y === second.y
}

function sharedEndpoint(
    first: IntersectionPart,
    second: IntersectionPart,
): boolean {
    if (!first.endpoints || !second.endpoints) {
        return false
    }

    return samePoint(first.endpoints.end, second.endpoints.start)
}

function vertexOwners(parts: readonly IntersectionPart[], closed: boolean) {
    const starts = parts.map((_, segmentIndex) => ({
        segmentIndex,
        parameter: 0,
    }))
    const ends = parts.map((_, segmentIndex) => ({
        segmentIndex,
        parameter: 1,
    }))

    for (let index = 0; index + 1 < parts.length; index++) {
        if (sharedEndpoint(parts[index]!, parts[index + 1]!)) {
            starts[index + 1] = ends[index]!
        }
    }

    if (closed && sharedEndpoint(parts.at(-1)!, parts[0]!)) {
        ends[parts.length - 1] = starts[0]!
    }

    return { starts, ends }
}

export function prepareIntersectionCurve(
    curve: Curve,
    angularTolerance: number,
): IntersectionCurve {
    if (!Number.isFinite(angularTolerance) || angularTolerance < 0) {
        throw new RangeError(
            'Angular tolerance must be finite and nonnegative.',
        )
    }

    if (curve.type === 'polyline') {
        const parts = copyPolylineSegments(curve).map((segment) =>
            prepareIntersectionPart(segment, angularTolerance),
        )

        return {
            parts,
            polyline: true,
            closed: curve.closed,
            ...vertexOwners(parts, curve.closed),
        }
    }

    return {
        parts: [prepareIntersectionPart(curve, angularTolerance)],
        polyline: false,
        closed: false,
        starts: [{ parameter: 0 }],
        ends: [{ parameter: 1 }],
    }
}

// Only exact endpoint coordinates unify adjacent ownership; admitted gaps remain gaps.
export function intersectionCurveLocation(
    curve: IntersectionCurve,
    { partIndex, point, root }: PartLocation,
): LocatedCurvePoint {
    const endpoints = curve.parts[partIndex]!.endpoints
    const endpoint = root.endpoint ? endpoints?.[root.endpoint] : undefined
    const exactEndpoint = endpoint !== undefined && samePoint(point, endpoint)

    if (!curve.polyline) {
        return {
            location: { parameter: root.parameter },
            endpoint: exactEndpoint,
        }
    }

    const location = { segmentIndex: partIndex, parameter: root.parameter }

    if (!exactEndpoint) {
        return { location, endpoint: false }
    }

    return {
        location:
            root.endpoint === 'start'
                ? curve.starts[partIndex]!
                : curve.ends[partIndex]!,
        endpoint: true,
    }
}
