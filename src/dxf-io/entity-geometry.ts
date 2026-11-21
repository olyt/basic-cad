import { MAX_COORDINATE } from '../geometry/curve'
import { createVector2, type Vector2 } from '../geometry/vector'
import {
    type DxfEntityProperties,
    type ReadDxfEntityProperties,
} from './entity-properties'
import { type DxfRecord } from './inventory'
import { type DxfIssue } from './issue'
import { type DxfToken } from './tokenize'

export type Fields = ReadonlyMap<number, number>

export type ExtrusionDirection = 1 | -1

interface DxfExtrusion {
    readonly direction?: ExtrusionDirection
    readonly issues: readonly DxfIssue[]
}

export interface Failure {
    readonly code: number
    readonly message: string
}

export interface GroupRule extends Failure {
    // Absent groups take this value; a rule without one requires its group.
    readonly fallback?: number
    readonly accepts: (value: number) => boolean
}

export interface EntityGroups {
    readonly record: DxfRecord
    readonly groups: ReadonlyMap<number, readonly DxfToken[]>
}

export interface GeometryResult<T> {
    readonly value?: T
    readonly issues: readonly DxfIssue[]
}

export interface DxfGeometryEntity<T> extends DxfEntityProperties {
    readonly geometry: T
}

export interface ReadDxfEntity<T> {
    readonly record: DxfRecord
    readonly handle?: string
    readonly value?: DxfGeometryEntity<T>
    readonly issues: readonly DxfIssue[]
}

const LIMIT = MAX_COORDINATE.toExponential()

// Absent groups take the only value the rule accepts.
export function fixed(rule: Omit<GroupRule, 'accepts'>): GroupRule {
    return { ...rule, accepts: (value) => value === rule.fallback }
}

const EXTRUSION_MESSAGE = 'Extrusion must be (0, 0, 1) or (0, 0, -1).'

export const EXTRUSION: readonly GroupRule[] = [
    ...[210, 220].map((code) =>
        fixed({ code, fallback: 0, message: EXTRUSION_MESSAGE }),
    ),
    {
        code: 230,
        fallback: 1,
        accepts: (value) => value === 1 || value === -1,
        message: EXTRUSION_MESSAGE,
    },
]

export function coordinate(code: number): GroupRule {
    return {
        code,
        accepts: (value) => Math.abs(value) <= MAX_COORDINATE,
        message: `Coordinate group ${code} is outside ±${LIMIT} drawing units.`,
    }
}

// Nonzero Z is rejected rather than flattened onto the drawing plane.
export function elevation(code: number): GroupRule {
    return fixed({
        code,
        fallback: 0,
        message: `Nonzero Z (group ${code}) is not supported.`,
    })
}

export function point(fields: Fields, code: number): Vector2 {
    return createVector2(fields.get(code)!, fields.get(code + 10)!)
}

// The -Z normal gives the object coordinate system the world axes -X and +Y.
export function ocsPoint(
    fields: Fields,
    direction: ExtrusionDirection,
): Vector2 {
    return createVector2(direction * fields.get(10)!, fields.get(20)!)
}

export function issueAt(entity: EntityGroups, failure: Failure): DxfIssue {
    const groups = entity.groups.get(failure.code) ?? []

    return {
        kind: 'unsupported',
        code: failure.code,
        line: groups.at(-1)?.line ?? entity.record.line,
        message: failure.message,
    }
}

function readRule(entity: EntityGroups, rule: GroupRule): number | DxfIssue {
    const groups = entity.groups.get(rule.code) ?? []
    const value = groups[0]?.value ?? rule.fallback

    if (groups.length > 1 || typeof value !== 'number') {
        const count = rule.fallback === undefined ? 'exactly' : 'at most'

        return issueAt(entity, {
            code: rule.code,
            message: `${entity.record.type} needs ${count} one numeric group ${rule.code}.`,
        })
    }

    return rule.accepts(value) ? value : issueAt(entity, rule)
}

export function readFields(
    entity: EntityGroups,
    rules: readonly GroupRule[],
): Fields | DxfIssue[] {
    const fields = new Map<number, number>()
    const issues: DxfIssue[] = []

    for (const rule of rules) {
        const value = readRule(entity, rule)

        if (typeof value === 'number') {
            fields.set(rule.code, value)
        } else {
            issues.push(value)
        }
    }

    return issues.length === 0 ? fields : issues
}

export function readExtrusion(entity: EntityGroups): DxfExtrusion {
    const fields = readFields(entity, EXTRUSION)

    if (Array.isArray(fields)) {
        return { issues: fields.slice(0, 1) }
    }

    if (fields.get(230) === 1) {
        return { direction: 1, issues: [] }
    }

    const message =
        entity.record.type === 'LINE'
            ? 'Normalized the flipped extrusion. LINE endpoints are already in world coordinates.'
            : 'Converted geometry from the flipped extrusion to world coordinates.'

    return {
        direction: -1,
        issues: [
            {
                kind: 'converted',
                code: 230,
                line: entity.groups.get(230)![0]!.line,
                message,
            },
        ],
    }
}

export function typeIssue(record: DxfRecord, expected: string): DxfIssue {
    return {
        kind: 'unsupported',
        code: 0,
        line: record.line,
        message: `Expected ${expected} entity.`,
    }
}

// A value needs both usable properties and geometry; the handle survives every failure.
export function assembleEntity<T>(
    properties: ReadDxfEntityProperties,
    geometry: GeometryResult<T>,
): ReadDxfEntity<T> {
    const { value, ...source } = properties

    if (value === undefined || geometry.value === undefined) {
        const failures = geometry.issues.filter(
            ({ kind }) => kind === 'unsupported',
        )

        return { ...source, issues: [...source.issues, ...failures] }
    }

    return {
        ...source,
        value: { ...value, geometry: geometry.value },
        issues: [...source.issues, ...geometry.issues],
    }
}
