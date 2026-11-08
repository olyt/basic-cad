import { curveBounds, type BoundingBox } from '../geometry/bounds'
import {
    createArc,
    createCircle,
    createLine,
    type Curve,
} from '../geometry/curve'
import { createPolyline } from '../geometry/polyline'
import { segmentEndpoints } from '../geometry/segment'
import { createEmptyDocument } from '../document/document'
import { admitDocument } from '../document/document-admission'
import { createIdState } from '../document/id'
import { type DrawingDocument } from '../document/schema'
import { seededRandom } from './random'

const random = seededRandom(0x350035)

export const { document: empty } = createEmptyDocument(
    createIdState('spatial', 0),
    {
        modelTolerance: { distance: 1e-7 },
    },
)

const layers = [
    empty.layers[0]!,
    ...(['visible', 'frozen', 'locked'] as const).map((flag, index) => ({
        ...empty.layers[0]!,
        id: `layer:flags:${index}`,
        name: flag,
        [flag]: flag !== 'visible',
    })),
]

function curve(index: number): Curve {
    const center = {
        x: random.between(-500, 500),
        y: random.between(-500, 500),
    }
    const radius = random.between(1, 30)
    const arc = createArc({
        center,
        radius,
        startAngle: random.between(0, Math.PI * 2),
        sweep: random.sign() * random.between(0.2, 5.8),
    })
    const { start, end } = segmentEndpoints(arc)
    const polyline = createPolyline(
        {
            closed: false,
            segments: [
                createLine({ x: start.x - radius, y: start.y }, start),
                arc,
                createLine(end, { x: end.x + radius, y: end.y }),
            ],
        },
        empty.modelTolerance,
    )

    return [
        createLine(center, { x: center.x + radius, y: center.y + radius / 2 }),
        createCircle(center, radius),
        arc,
        polyline,
    ][index % 4]!
}

export const document = admitDocument({
    ...empty,
    layers,
    entities: Array.from({ length: 96 }, (_, index) => ({
        ...empty.defaults,
        id: `entity:spatial:${index.toString(36)}`,
        layerId: layers[index % 4]!.id,
        geometry: curve(index),
    })),
})

export function pointQuery(x: number, y: number): BoundingBox {
    const point = { x, y }

    return { min: point, max: point }
}

export const all = {
    min: { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE },
    max: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
}
export const queries = [
    all,
    curveBounds(document.entities[0]!.geometry),
    curveBounds(document.entities[4]!.geometry),
    pointQuery(5000, 5000),
    pointQuery(-5000, -5000),
    ...Array.from({ length: 120 }, () => {
        const min = {
            x: random.between(-600, 600),
            y: random.between(-600, 600),
        }

        return {
            min,
            max: {
                x: min.x + random.between(0, 200),
                y: min.y + random.between(0, 200),
            },
        }
    }),
]

export function brute(current: DrawingDocument, query: BoundingBox) {
    return current.entities
        .filter(({ geometry }) => {
            const box = curveBounds(geometry)

            return (
                box.min.x <= query.max.x &&
                box.max.x >= query.min.x &&
                box.min.y <= query.max.y &&
                box.max.y >= query.min.y
            )
        })
        .map(({ id }) => id)
}

export function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
}
