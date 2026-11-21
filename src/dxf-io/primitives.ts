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
import { integerCoordinates, roundRational } from '../geometry/exact'
import {
    readDxfEntityProperties,
    type DxfReferenceIndex,
} from './entity-properties'
import {
    assembleEntity,
    coordinate,
    elevation,
    EXTRUSION,
    issueAt,
    ocsPoint,
    point,
    readExtrusion,
    readFields,
    typeIssue,
    type DxfGeometryEntity,
    type ExtrusionDirection,
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
    readonly build: (
        fields: Fields,
        direction: ExtrusionDirection,
    ) => DxfPrimitive | Failure
}

const DEGREES_PER_TURN = 360
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

function circle(fields: Fields, direction: ExtrusionDirection): Circle {
    return createCircle(ocsPoint(fields, direction), fields.get(40)!)
}

// Keep both degree remainders exact until the counterclockwise span is rounded in radians.
function arcAngles(fields: Fields, direction: ExtrusionDirection) {
    const start = fields.get(50)!
    const end = fields.get(51)!

    if (!Number.isFinite(end - start)) {
        return undefined
    }

    const {
        exponent,
        values: [from, to, degreesPerTurn, radiansPerTurn],
    } = integerCoordinates([
        start % DEGREES_PER_TURN,
        end % DEGREES_PER_TURN,
        DEGREES_PER_TURN,
        FULL_TURN,
    ])
    const radians = (degrees: bigint) => {
        const remainder = degrees % degreesPerTurn
        const wrapped = remainder < 0n ? remainder + degreesPerTurn : remainder

        return roundRational(
            {
                numerator: wrapped * radiansPerTurn,
                denominator: degreesPerTurn,
            },
            exponent,
        )
    }
    const sweep = radians(to - from)
    // Reflection changes the start ray from θ to π − θ and reverses traversal.
    const startRay = direction === -1 ? degreesPerTurn / 2n - from : from

    return sweep > 0 && sweep < FULL_TURN
        ? { startAngle: radians(startRay), sweep: direction * sweep }
        : undefined
}

// DXF arcs run counterclockwise from group 50 to group 51, in degrees.
function arc(fields: Fields, direction: ExtrusionDirection): Arc | Failure {
    const angles = arcAngles(fields, direction)

    if (angles === undefined) {
        return {
            code: 51,
            message:
                'ARC angles must span a partial turn; zero and full turns are not converted.',
        }
    }

    return createArc({
        center: ocsPoint(fields, direction),
        radius: fields.get(40)!,
        ...angles,
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
    const { direction, issues } = readExtrusion(entity)

    if (Array.isArray(fields)) {
        return { issues: [...fields, ...issues] }
    }

    if (profile.ocs && direction === undefined) {
        return { issues }
    }

    const built = profile.build(fields, direction ?? 1)

    return 'type' in built
        ? { value: built, issues }
        : { issues: [...issues, issueAt(entity, built)] }
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
