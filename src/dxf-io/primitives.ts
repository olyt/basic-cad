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
import {
    readDxfEntityProperties,
    type DxfReferenceIndex,
} from './entity-properties'
import {
    assembleEntity,
    coordinate,
    elevation,
    EXTRUSION,
    extrusionIssues,
    issueAt,
    point,
    readFields,
    typeIssue,
    type DxfGeometryEntity,
    type Failure,
    type Fields,
    type GeometryResult,
    type GroupRule,
    type ReadDxfEntity,
} from './entity-geometry'
import { attributeGroups, type DxfRecord } from './inventory'

export type DxfPrimitive = Line | Circle | Arc

export type DxfPrimitiveEntity = DxfGeometryEntity<DxfPrimitive>

export type ReadDxfPrimitive = ReadDxfEntity<DxfPrimitive>

interface PrimitiveProfile {
    readonly rules: readonly GroupRule[]
    // ARC and CIRCLE points lie in the extrusion's plane; LINE endpoints are always WCS.
    readonly ocs: boolean
    readonly build: (fields: Fields) => DxfPrimitive | Failure
}

const DEGREE = Math.PI / 180
const RADIUS: GroupRule = {
    code: 40,
    accepts: (value) => value > 0 && value <= MAX_COORDINATE,
    message: `Radius must be positive and at most ${MAX_COORDINATE.toExponential()} drawing units.`,
}
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

function angle(code: number): GroupRule {
    return { code, accepts: Number.isFinite, message: 'Angle must be finite.' }
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

function readGeometry(record: DxfRecord): GeometryResult<DxfPrimitive> {
    const profile = PROFILES.get(record.type)

    if (profile === undefined) {
        return { issues: [typeIssue(record, 'a LINE, CIRCLE or ARC')] }
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
    return assembleEntity(
        readDxfEntityProperties(record, references),
        readGeometry(record),
    )
}
