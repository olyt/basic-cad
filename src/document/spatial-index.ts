import { curveBounds, type BoundingBox } from '../geometry/bounds'
import { type Vector2 } from '../geometry/vector'
import { admitDocument } from './document-admission'
import { type EntityId } from './id'
import { readNumber, readRecord } from './record'
import { type DrawingDocument } from './schema'

type Axis = 'x' | 'y'

interface IndexEntry {
    readonly id: EntityId
    readonly order: number
    readonly bounds: BoundingBox
}

type IndexNode =
    | IndexEntry
    | {
          readonly bounds: BoundingBox
          readonly children: readonly [IndexNode, IndexNode]
      }

export interface SpatialIndex {
    readonly document: DrawingDocument
    readonly query: (bounds: BoundingBox) => EntityId[]
}

function readCorner(value: unknown): Vector2 {
    const { x, y } = readRecord(value)

    return {
        x: readNumber(x, 'Bound coordinate'),
        y: readNumber(y, 'Bound coordinate'),
    }
}

function readBounds(value: BoundingBox): BoundingBox {
    const { min, max } = readRecord(value)
    const lower = readCorner(min)
    const upper = readCorner(max)

    if (lower.x > upper.x || lower.y > upper.y) {
        throw new RangeError('Query bounds must be ordered on both axes.')
    }

    return { min: lower, max: upper }
}

function overlaps(first: BoundingBox, second: BoundingBox): boolean {
    return (
        first.min.x <= second.max.x &&
        first.max.x >= second.min.x &&
        first.min.y <= second.max.y &&
        first.max.y >= second.min.y
    )
}

function unionBounds(first: BoundingBox, second: BoundingBox): BoundingBox {
    return {
        min: {
            x: Math.min(first.min.x, second.min.x),
            y: Math.min(first.min.y, second.min.y),
        },
        max: {
            x: Math.max(first.max.x, second.max.x),
            y: Math.max(first.max.y, second.max.y),
        },
    }
}

function axisCenter(bounds: BoundingBox, axis: Axis): number {
    return bounds.min[axis] / 2 + bounds.max[axis] / 2
}

function buildTree(entries: IndexEntry[]): IndexNode {
    if (entries.length === 1) {
        return entries[0]!
    }

    const bounds = entries.reduce(
        (combined, entry) => unionBounds(combined, entry.bounds),
        entries[0]!.bounds,
    )
    const axis: Axis =
        bounds.max.x - bounds.min.x >= bounds.max.y - bounds.min.y ? 'x' : 'y'

    entries.sort(
        (first, second) =>
            axisCenter(first.bounds, axis) - axisCenter(second.bounds, axis) ||
            first.order - second.order,
    )

    const middle = Math.floor(entries.length / 2)

    return {
        bounds,
        children: [
            buildTree(entries.slice(0, middle)),
            buildTree(entries.slice(middle)),
        ],
    }
}

function collect(
    node: IndexNode,
    query: { readonly bounds: BoundingBox; readonly hits: IndexEntry[] },
): void {
    if (!overlaps(node.bounds, query.bounds)) {
        return
    }

    if ('id' in node) {
        query.hits.push(node)

        return
    }

    for (const child of node.children) {
        collect(child, query)
    }
}

export function createSpatialIndex(document: DrawingDocument): SpatialIndex {
    const current = admitDocument(document)
    const entries = current.entities.map((entity, order) => ({
        id: entity.id,
        order,
        bounds: curveBounds(entity.geometry),
    }))
    const root = entries.length === 0 ? undefined : buildTree(entries)

    return {
        document: current,
        query(value) {
            const bounds = readBounds(value)
            const hits: IndexEntry[] = []

            if (root !== undefined) {
                collect(root, { bounds, hits })
            }

            return hits
                .sort((first, second) => first.order - second.order)
                .map(({ id }) => id)
        },
    }
}
