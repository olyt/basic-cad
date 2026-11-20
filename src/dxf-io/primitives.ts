import { FULL_TURN } from '../geometry/angle'
import {
    createArc,
    createCircle,
    createLine,
    MAX_COORDINATE,
    type Arc,
    type Circle,
    type Line,
} from '../geometry/curve'
import { createVector2, type Vector2 } from '../geometry/vector'
import {
    readDxfEntityProperties,
    type DxfEntityProperties,
    type DxfReferenceIndex,
} from './entity-properties'
import { attributeGroups, type DxfRecord } from './inventory'
import { type DxfIssue } from './issue'
import { type DxfToken } from './tokenize'

export type DxfPrimitive = Line | Circle | Arc

export interface DxfPrimitiveEntity extends DxfEntityProperties {
    readonly geometry: DxfPrimitive
}

export interface ReadDxfPrimitive {
    readonly record: DxfRecord
    readonly handle?: string
    readonly value?: DxfPrimitiveEntity
    readonly issues: readonly DxfIssue[]
}

type Fields = ReadonlyMap<number, number>

interface Failure {
    readonly code: number
    readonly message: string
}

interface GroupRule extends Failure {
    // Absent groups take this value; a rule without one requires its group.
    readonly fallback?: number
    readonly accepts: (value: number) => boolean
}

interface PrimitiveProfile {
    readonly rules: readonly GroupRule[]
    // ARC and CIRCLE points lie in the extrusion's plane; LINE endpoints are always WCS.
    readonly ocs: boolean
    readonly build: (fields: Fields) => DxfPrimitive | Failure
}

interface EntityGroups {
    readonly record: DxfRecord
    readonly groups: ReadonlyMap<number, readonly DxfToken[]>
}

interface GeometryResult {
    readonly value?: DxfPrimitive
    readonly issues: readonly DxfIssue[]
}

const DEGREE = Math.PI / 180
const LIMIT = MAX_COORDINATE.toExponential()
const RADIUS: GroupRule = {
    code: 40,
    accepts: (value) => value > 0 && value <= MAX_COORDINATE,
    message: `Radius must be positive and at most ${LIMIT} drawing units.`,
}
const EXTRUSION: readonly GroupRule[] = (
    [
        [210, 0],
        [220, 0],
        [230, 1],
    ] as const
).map(([code, fallback]) => ({
    code,
    fallback,
    accepts: (value) => value === fallback,
    message: 'Extrusion other than (0, 0, 1) is not converted.',
}))
const CENTER = [coordinate(10), coordinate(20), elevation(30)]
const PROFILES: ReadonlyMap<string, PrimitiveProfile> = new Map([
    [
        'LINE',
        {
            rules: [
                coordinate(10),
                coordinate(20),
                elevation(30),
                coordinate(11),
                coordinate(21),
                elevation(31),
            ],
            ocs: false,
            build: line,
        },
    ],
    ['CIRCLE', { rules: [...CENTER, RADIUS], ocs: true, build: circle }],
    [
        'ARC',
        {
            rules: [...CENTER, RADIUS, angle(50), angle(51)],
            ocs: true,
            build: arc,
        },
    ],
])
const GEOMETRY_CODES = [
    ...new Set(
        [...Array.from(PROFILES.values(), ({ rules }) => rules), EXTRUSION]
            .flat()
            .map(({ code }) => code),
    ),
]

function coordinate(code: number): GroupRule {
    return {
        code,
        accepts: (value) => Math.abs(value) <= MAX_COORDINATE,
        message: `Coordinate group ${code} is outside ±${LIMIT} drawing units.`,
    }
}

// Nonzero Z is rejected rather than flattened onto the drawing plane.
function elevation(code: number): GroupRule {
    return {
        code,
        fallback: 0,
        accepts: (value) => value === 0,
        message: `Nonzero Z (group ${code}) is not supported.`,
    }
}

function angle(code: number): GroupRule {
    return { code, accepts: Number.isFinite, message: 'Angle must be finite.' }
}

function point(fields: Fields, code: number): Vector2 {
    return createVector2(fields.get(code)!, fields.get(code + 10)!)
}

function line(fields: Fields): Line | Failure {
    const start = point(fields, 10)
    const end = point(fields, 11)

    return start.x === end.x && start.y === end.y
        ? { code: 11, message: 'LINE endpoints must be distinct.' }
        : createLine(start, end)
}

function circle(fields: Fields): Circle {
    return createCircle(point(fields, 10), fields.get(40)!)
}

// Shifting only negative remainders keeps positive ones exact; a tiny negative one can reach 360.
function turnDegrees(value: number): number {
    const remainder = value % 360

    return remainder < 0 ? remainder + 360 : remainder
}

// DXF arcs run counterclockwise from group 50 to group 51, in degrees.
function arc(fields: Fields): Arc | Failure {
    const start = fields.get(50)!
    const sweep = turnDegrees(fields.get(51)! - start) * DEGREE
    const partial = sweep > 0 && sweep < FULL_TURN

    if (!partial) {
        return {
            code: 51,
            message:
                'ARC angles must span a partial turn; zero and full turns are not converted.',
        }
    }

    return createArc({
        center: point(fields, 10),
        radius: fields.get(40)!,
        startAngle: turnDegrees(start) * DEGREE,
        sweep,
    })
}

function issueAt(entity: EntityGroups, failure: Failure): DxfIssue {
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

function readFields(
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

function extrusionIssues(entity: EntityGroups): DxfIssue[] {
    const issues = EXTRUSION.map((rule) => readRule(entity, rule)).filter(
        (value) => typeof value !== 'number',
    )

    return issues.slice(0, 1)
}

function readGeometry(record: DxfRecord): GeometryResult {
    const profile = PROFILES.get(record.type)

    if (profile === undefined) {
        const message = 'Expected a LINE, CIRCLE or ARC entity.'

        return {
            issues: [
                { kind: 'unsupported', code: 0, line: record.line, message },
            ],
        }
    }

    const entity = {
        record,
        groups: attributeGroups(record.tokens, GEOMETRY_CODES),
    }
    const fields = readFields(entity, profile.rules)
    const extrusion = extrusionIssues(entity)

    if (Array.isArray(fields)) {
        return { issues: [...fields, ...extrusion] }
    }

    if (profile.ocs && extrusion.length > 0) {
        return { issues: extrusion }
    }

    const built = profile.build(fields)

    return 'type' in built
        ? { value: built, issues: extrusion }
        : { issues: [...extrusion, issueAt(entity, built)] }
}

// Coordinates are checked before construction, so no curve constructor rejects source values.
export function readDxfPrimitive(
    record: DxfRecord,
    references: DxfReferenceIndex,
): ReadDxfPrimitive {
    const { value: properties, ...source } = readDxfEntityProperties(
        record,
        references,
    )
    const geometry = readGeometry(record)
    const issues = [...source.issues, ...geometry.issues]

    return properties === undefined || geometry.value === undefined
        ? { ...source, issues }
        : {
              ...source,
              value: { ...properties, geometry: geometry.value },
              issues,
          }
}
