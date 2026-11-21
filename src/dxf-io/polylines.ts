import { bulgeToSegment } from '../geometry/bulge'
import { type Polyline, type PolylineSegment } from '../geometry/curve'
import { createPolyline } from '../geometry/polyline'
import { segmentEndpoints } from '../geometry/segment'
import {
    createModelTolerance,
    pointsCoincide,
    type ModelTolerance,
} from '../geometry/tolerance'
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
    fixed,
    issueAt,
    point,
    readFields,
    typeIssue,
    type DxfGeometryEntity,
    type EntityGroups,
    type Failure,
    type Fields,
    type GeometryResult,
    type GroupRule,
    type ReadDxfEntity,
} from './entity-geometry'
import { attributeGroups, attributeTokens, type DxfRecord } from './inventory'
import { type DxfIssue } from './issue'
import { type DxfToken } from './tokenize'

export type DxfPolylineEntity = DxfGeometryEntity<Polyline>

export type ReadDxfPolyline = ReadDxfEntity<Polyline>

export interface DxfPolylineContext {
    readonly references: DxfReferenceIndex
    // Segments must meet within the receiving document's tolerance.
    readonly modelTolerance: ModelTolerance
}

interface Vertex {
    readonly index: number
    readonly groups: EntityGroups
    readonly fields: Fields
}

interface Path {
    readonly vertices: readonly Vertex[]
    readonly closed: boolean
}

interface Segments extends Path {
    // Undefined marks a segment that failed and has already been reported.
    readonly segments: readonly (PolylineSegment | undefined)[]
}

type VertexGroups = Map<number, DxfToken[]>

const CLOSED = 1
const HEADER_RULES: readonly GroupRule[] = [
    {
        code: 90,
        // A fractional count cannot match the vertices, so the count check reports it.
        accepts: (value) => value >= 2,
        message: 'LWPOLYLINE needs at least two vertices.',
    },
    {
        code: 70,
        fallback: 0,
        accepts: (value) => value === 0 || value === CLOSED,
        message: 'Polyline flags other than closed (1) are not supported.',
    },
    fixed({
        code: 43,
        fallback: 0,
        message: 'Nonzero polyline width is not supported.',
    }),
    elevation(38),
]
const HEADER_CODES = [...HEADER_RULES, ...EXTRUSION].map(({ code }) => code)
const VERTEX_RULES: readonly GroupRule[] = [
    coordinate(10),
    coordinate(20),
    ...[40, 41].map((code) =>
        fixed({
            code,
            fallback: 0,
            message: 'Nonzero vertex width is not supported.',
        }),
    ),
    {
        code: 42,
        fallback: 0,
        accepts: Number.isFinite,
        message: 'Bulge must be finite.',
    },
]
const VERTEX_CODES = new Set(VERTEX_RULES.map(({ code }) => code))

function vertexIssue(vertex: Vertex, failure: Failure): DxfIssue {
    return { ...issueAt(vertex.groups, failure), vertex: vertex.index }
}

// Y follows its X; width and bulge groups follow both, once each.
function fits(vertex: VertexGroups | undefined, code: number): boolean {
    if (vertex === undefined || vertex.has(code)) {
        return false
    }

    return code === 20 || vertex.has(20)
}

function splitVertices(record: DxfRecord): {
    sources: VertexGroups[]
    issues: DxfIssue[]
} {
    const sources: VertexGroups[] = []
    const issues: DxfIssue[] = []

    for (const token of attributeTokens(record.tokens)) {
        const current = sources.at(-1)

        if (token.code === 10) {
            sources.push(new Map([[10, [token]]]))
        } else if (!VERTEX_CODES.has(token.code)) {
            continue
        } else if (fits(current, token.code)) {
            current!.set(token.code, [token])
        } else {
            issues.push({
                kind: 'unsupported',
                code: token.code,
                line: token.line,
                message: `Vertex group ${token.code} is repeated or out of order.`,
                ...(current && { vertex: sources.length - 1 }),
            })
        }
    }

    return { sources, issues }
}

function readVertex(entity: EntityGroups, index: number): Vertex | DxfIssue[] {
    if (!entity.groups.has(20)) {
        return [
            {
                kind: 'unsupported',
                code: 20,
                line: entity.groups.get(10)![0]!.line,
                message: 'Vertex needs one group 20 after its group 10.',
                vertex: index,
            },
        ]
    }

    const fields = readFields(entity, VERTEX_RULES)

    return Array.isArray(fields)
        ? fields.map((issue) => ({ ...issue, vertex: index }))
        : { index, groups: entity, fields }
}

function readVertices(record: DxfRecord) {
    const { sources, issues } = splitVertices(record)
    const vertices: Vertex[] = []

    for (const [index, groups] of sources.entries()) {
        const vertex = readVertex({ record, groups }, index)

        if (Array.isArray(vertex)) {
            issues.push(...vertex)
        } else {
            vertices.push(vertex)
        }
    }

    return { vertices, issues, found: sources.length }
}

function countIssues(
    entity: EntityGroups,
    { declared, found }: { declared: number; found: number },
): DxfIssue[] {
    const message = `Group 90 declares ${declared} vertices, but the record has ${found}.`

    return declared === found ? [] : [issueAt(entity, { code: 90, message })]
}

function segmentFrom(from: Vertex, to: Vertex): PolylineSegment | DxfIssue {
    const start = point(from.fields, 10)
    const end = point(to.fields, 10)

    if (start.x === end.x && start.y === end.y) {
        const message = 'Segment starting at this vertex has zero length.'

        return vertexIssue(from, { code: 10, message })
    }

    try {
        return bulgeToSegment({ start, end, bulge: from.fields.get(42)! })
    } catch (error) {
        if (!(error instanceof RangeError)) {
            throw error
        }

        const message = 'Bulge cannot become an arc without losing geometry.'

        return vertexIssue(from, { code: 42, message })
    }
}

// An open polyline's last vertex starts no segment, so a bulge there has nowhere to go.
function danglingBulge({ vertices, closed }: Path): DxfIssue[] {
    const last = vertices.at(-1)!
    const message = 'The last vertex of an open polyline cannot keep a bulge.'

    return closed || last.fields.get(42) === 0
        ? []
        : [vertexIssue(last, { code: 42, message })]
}

// Each vertex and the segment ends touching it must coincide pairwise, as createPolyline requires.
function meetingIssues(path: Segments, tolerance: ModelTolerance): DxfIssue[] {
    const { vertices, closed, segments } = path
    const ends = segments.map((segment) => segment && segmentEndpoints(segment))
    const message =
        'Segment ends do not meet this vertex within model tolerance.'

    return vertices.flatMap((vertex, index) => {
        const before = closed || index > 0 ? ends.at(index - 1) : undefined
        const points = [point(vertex.fields, 10)]

        for (const at of [before?.end, ends[index]?.start]) {
            if (at !== undefined) {
                points.push(at)
            }
        }

        const meet = points.every((a, next) =>
            points
                .slice(next + 1)
                .every((b) => pointsCoincide(a, b, tolerance)),
        )

        return meet ? [] : [vertexIssue(vertex, { code: 10, message })]
    })
}

function buildPolyline(
    path: Path,
    tolerance: ModelTolerance,
): GeometryResult<Polyline> {
    const { vertices, closed } = path
    const count = closed ? vertices.length : vertices.length - 1
    const issues: DxfIssue[] = []
    const segments = vertices.slice(0, count).map((from, index) => {
        const built = segmentFrom(
            from,
            vertices[(index + 1) % vertices.length]!,
        )

        if ('type' in built) {
            return built
        }

        issues.push(built)

        return undefined
    })

    issues.push(
        ...danglingBulge(path),
        ...meetingIssues({ ...path, segments }, tolerance),
    )

    if (issues.length > 0) {
        return { issues }
    }

    const complete = segments.filter((segment) => segment !== undefined)

    return {
        value: createPolyline({ segments: complete, closed }, tolerance),
        issues,
    }
}

function readGeometry(
    record: DxfRecord,
    tolerance: ModelTolerance,
): GeometryResult<Polyline> {
    if (record.type !== 'LWPOLYLINE') {
        return { issues: [typeIssue(record, 'an LWPOLYLINE')] }
    }

    const entity = {
        record,
        groups: attributeGroups(record.tokens, HEADER_CODES),
    }
    const fields = readFields(entity, HEADER_RULES)
    const { vertices, issues, found } = readVertices(record)
    const extrusion = extrusionIssues(entity)
    const header = Array.isArray(fields)
        ? fields
        : countIssues(entity, { declared: fields.get(90)!, found })

    if (Array.isArray(fields) || header.length + issues.length > 0) {
        return { issues: [...header, ...issues, ...extrusion] }
    }

    // Vertices lie in the extrusion's plane, so any other plane withholds the value.
    if (extrusion.length > 0) {
        return { issues: extrusion }
    }

    return buildPolyline(
        { vertices, closed: fields.get(70) === CLOSED },
        tolerance,
    )
}

// Vertices are checked before segments are built, and segments before the polyline.
export function readDxfPolyline(
    record: DxfRecord,
    context: DxfPolylineContext,
): ReadDxfPolyline {
    const tolerance = createModelTolerance(context.modelTolerance.distance)

    return assembleEntity(
        readDxfEntityProperties(record, context.references),
        readGeometry(record, tolerance),
    )
}
