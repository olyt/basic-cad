import { type IntersectionCurve } from './intersection-curve'
import { sourcePairs, type IntersectionEvent } from './intersection-events'
import {
    classifyJointEvent,
    curveJoints,
    jointEventKey,
    type JointEvent,
} from './intersection-joints'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from './tolerance'

interface JointMergeQuery {
    readonly events: readonly IntersectionEvent[]
    readonly first: IntersectionCurve
    readonly second: IntersectionCurve
}

function priority(candidate: JointEvent): number[] {
    const { event, endpointScore, distanceScore, lineScore } = candidate
    const parameters = [
        event.hit.first.parameter,
        event.hit.second.parameter,
    ].sort((a, b) => a - b)
    const parts = [event.firstPart, event.secondPart].sort((a, b) => a - b)

    return [
        -endpointScore,
        distanceScore,
        -lineScore,
        event.hit.point.x,
        event.hit.point.y,
        ...parameters,
        ...parts,
    ]
}

function compareCandidates(first: JointEvent, second: JointEvent): number {
    const a = priority(first)
    const b = priority(second)

    for (let index = 0; index < a.length; index++) {
        const difference = a[index]! - b[index]!

        if (difference !== 0) {
            return difference
        }
    }

    return 0
}

function connected(first: JointEvent, second: JointEvent): boolean {
    const acrossFirst =
        first.firstJoint !== undefined &&
        first.event.firstPart !== second.event.firstPart &&
        first.event.secondPart === second.event.secondPart
    const acrossSecond =
        first.secondJoint !== undefined &&
        first.event.secondPart !== second.event.secondPart &&
        first.event.firstPart === second.event.firstPart

    return acrossFirst || acrossSecond
}

function canJoin(
    candidate: JointEvent,
    input: {
        readonly cluster: readonly JointEvent[]
        readonly tolerance: ModelTolerance
    },
): boolean {
    const pairs = new Set(
        input.cluster.flatMap(({ event }) => sourcePairs(event)),
    )

    if (sourcePairs(candidate.event).some((pair) => pairs.has(pair))) {
        return false
    }

    if (!input.cluster.some((member) => connected(candidate, member))) {
        return false
    }

    return input.cluster.every((member) =>
        pointsCoincide(
            candidate.event.hit.point,
            member.event.hit.point,
            input.tolerance,
        ),
    )
}

function growCluster(
    input: {
        readonly seed: JointEvent
        readonly candidates: readonly JointEvent[]
    },
    tolerance: ModelTolerance,
): JointEvent[] {
    const cluster = [input.seed]
    let previousSize: number

    do {
        previousSize = cluster.length

        for (const candidate of input.candidates) {
            if (
                !cluster.includes(candidate) &&
                canJoin(candidate, { cluster, tolerance })
            ) {
                cluster.push(candidate)
            }
        }
    } while (cluster.length > previousSize)

    return cluster
}

function mergedEvent(cluster: readonly JointEvent[]): IntersectionEvent {
    const representative = cluster.toSorted(
        (first, second) =>
            second.lineScore - first.lineScore ||
            compareCandidates(first, second),
    )[0]!
    const firstMerged =
        new Set(cluster.map(({ event }) => event.firstPart)).size > 1 &&
        representative.firstJoint !== undefined
    const secondMerged =
        new Set(cluster.map(({ event }) => event.secondPart)).size > 1 &&
        representative.secondJoint !== undefined

    return {
        ...representative.event,
        firstEndpoint: firstMerged || representative.event.firstEndpoint,
        secondEndpoint: secondMerged || representative.event.secondEndpoint,
        sourcePairs: [
            ...new Set(cluster.flatMap(({ event }) => sourcePairs(event))),
        ],
        hit: {
            point: representative.event.hit.point,
            first: firstMerged
                ? representative.firstJoint!.location
                : representative.event.hit.first,
            second: secondMerged
                ? representative.secondJoint!.location
                : representative.event.hit.second,
        },
    }
}

function mergeGroup(
    candidates: readonly JointEvent[],
    tolerance: ModelTolerance,
): IntersectionEvent[] {
    const ordered = candidates.toSorted(compareCandidates)

    for (const seed of ordered) {
        const cluster = growCluster({ seed, candidates: ordered }, tolerance)

        if (cluster.length > 1) {
            return [
                mergedEvent(cluster),
                ...ordered
                    .filter((candidate) => !cluster.includes(candidate))
                    .map(({ event }) => event),
            ]
        }
    }

    return ordered.map(({ event }) => event)
}

export function mergeJointIntersections(
    input: JointMergeQuery,
    tolerance: ModelTolerance,
): readonly IntersectionEvent[] {
    const checked = createModelTolerance(tolerance.distance)

    if (checked.distance === 0 || input.events.length === 0) {
        return input.events
    }

    const curves = {
        first: curveJoints(input.first, checked),
        second: curveJoints(input.second, checked),
    }
    const groups = new Map<string, JointEvent[]>()
    const output: IntersectionEvent[] = []

    for (const event of input.events) {
        const candidate = classifyJointEvent(event, curves)

        if (!candidate.firstJoint && !candidate.secondJoint) {
            output.push(event)
            continue
        }

        const key = jointEventKey(candidate)
        const group = groups.get(key) ?? []

        group.push(candidate)
        groups.set(key, group)
    }

    for (const group of groups.values()) {
        output.push(...mergeGroup(group, checked))
    }

    return output
}
