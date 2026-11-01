import { type CurveLocation } from './evaluation'
import { type Vector2 } from './vector'

export interface CurveIntersectionHit {
    readonly point: Vector2
    readonly first: CurveLocation
    readonly second: CurveLocation
}

export interface IntersectionEvent {
    readonly hit: CurveIntersectionHit
    readonly firstPart: number
    readonly secondPart: number
    readonly firstEndpoint: boolean
    readonly secondEndpoint: boolean
    readonly sourcePairs?: readonly string[]
}

interface EventGroup {
    readonly events: IntersectionEvent[]
    readonly pairs: Set<string>
    preserveRoots: boolean
}

function eventKey({
    hit: { point, first, second },
    firstEndpoint,
    secondEndpoint,
}: IntersectionEvent): string {
    return JSON.stringify([
        first.segmentIndex ?? -1,
        first.parameter,
        second.segmentIndex ?? -1,
        second.parameter,
        point.x,
        point.y,
        firstEndpoint,
        secondEndpoint,
    ])
}

function compareLocations(first: CurveLocation, second: CurveLocation): number {
    const segments = (first.segmentIndex ?? -1) - (second.segmentIndex ?? -1)

    return segments || first.parameter - second.parameter
}

export function uniqueIntersections(
    events: readonly IntersectionEvent[],
): readonly CurveIntersectionHit[] {
    const groups = new Map<string, EventGroup>()

    for (const event of events) {
        const key = eventKey(event)
        const group = groups.get(key) ?? {
            events: [],
            pairs: new Set<string>(),
            preserveRoots: false,
        }

        for (const pair of sourcePairs(event)) {
            group.preserveRoots = group.preserveRoots || group.pairs.has(pair)
            group.pairs.add(pair)
        }

        group.events.push(event)
        groups.set(key, group)
    }

    // Multiple roots from one exact kernel stay distinct despite identical rounded keys.
    return [...groups.values()]
        .flatMap((group) =>
            group.preserveRoots
                ? group.events.map(({ hit }) => hit)
                : [group.events[0]!.hit],
        )
        .sort(
            (first, second) =>
                compareLocations(first.first, second.first) ||
                compareLocations(first.second, second.second),
        )
}

export function sourcePairs(event: IntersectionEvent): readonly string[] {
    return event.sourcePairs ?? [`${event.firstPart}:${event.secondPart}`]
}
