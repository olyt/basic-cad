import { describe, expect, it } from 'vitest'
import { createCircle, createLine } from '../geometry/curve'
import { createEmptyDocument } from './document'
import { admitDocument } from './document-admission'
import { createIdState } from './id'

const { document: empty } = createEmptyDocument(createIdState('admission', 0), {
    modelTolerance: { distance: 0.125 },
    units: 'unitless',
})
const layer = {
    ...empty.layers[0]!,
    id: 'layer:other:0',
    name: ' Стены ',
    frozen: true,
    locked: true,
}
const source = { id: 'source:files:0', format: 'dxf', fileName: 'План.dxf' }
const snapshot = {
    ...empty,
    revision: 17,
    defaults: { ...empty.defaults, layerId: layer.id },
    layers: [empty.layers[0]!, layer],
    entities: [
        {
            ...empty.defaults,
            id: 'entity:entities:0',
            layerId: layer.id,
            geometry: createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
            source: { sourceId: source.id, handle: 'AA' },
        },
        {
            ...empty.defaults,
            id: 'entity:entities:1',
            geometry: createCircle({ x: 3, y: 4 }, 2),
        },
    ],
    sources: [{ ...source, id: 'source:unused:0' }, source],
}
const collections = ['layers', 'entities', 'sources'] as const

function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
}

function readOnce(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) {
        return value
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => readOnce(item))
    }

    const reads = new Set<PropertyKey>()
    const fields = Object.fromEntries(
        Object.entries(value).map(([key, field]) => [key, readOnce(field)]),
    )

    return new Proxy(fields, {
        get(target, key) {
            expect(reads.has(key), `Repeated field read: ${String(key)}`).toBe(
                false,
            )
            reads.add(key)

            return Reflect.get(target, key)
        },
    })
}

function expectDetached(actual: unknown, original: unknown): void {
    expect(actual).toEqual(original)

    if (typeof original !== 'object' || original === null) {
        return
    }

    expect(actual).not.toBe(original)

    for (const [key, value] of Object.entries(original)) {
        expectDetached((actual as Record<string, unknown>)[key], value)
    }
}

describe('whole-document admission', () => {
    it('copies an empty factory document without changing its defaults', () => {
        expectDetached(admitDocument(freeze(empty)), empty)
    })

    it('admits a frozen JSON snapshot, retaining order, namespaces and spaced Unicode names', () => {
        const input: unknown = JSON.parse(JSON.stringify(snapshot))
        const admitted = admitDocument(freeze(input))

        expectDetached(admitted, input)
        expect(admitted).toEqual(snapshot)
    })

    it('copies only supported document, tolerance and default fields', () => {
        const input = {
            ...snapshot,
            extra: true,
            modelTolerance: { ...snapshot.modelTolerance, extra: true },
            defaults: { ...snapshot.defaults, extra: true },
        }

        expect(admitDocument(input)).toEqual(snapshot)
        expect(input.extra).toBe(true)
    })

    it.each([0, Number.MAX_SAFE_INTEGER])(
        'retains admitted revision %s and zero tolerance/lineweight',
        (revision) => {
            const input = {
                ...snapshot,
                revision,
                modelTolerance: { distance: 0 },
                defaultLineweight: 0,
            }

            expect(admitDocument(input)).toEqual(input)
        },
    )

    it.each([null, undefined, [], false])(
        'rejects non-document %j',
        (value) => {
            expect(() => admitDocument(value)).toThrow(RangeError)
        },
    )

    it('requires every top-level document field', () => {
        for (const key of Object.keys(snapshot)) {
            const input: Record<string, unknown> = { ...snapshot }

            delete input[key]
            expect(() => admitDocument(input)).toThrow(RangeError)
        }
    })

    it.each([
        { schemaVersion: 0 },
        { schemaVersion: 2 },
        { schemaVersion: '1' },
        { id: 'layer:admission:0' },
        { id: 'document:admission:00' },
        { revision: -1 },
        { revision: 0.5 },
        { revision: NaN },
        { revision: Infinity },
        { revision: Number.MAX_SAFE_INTEGER + 1 },
        { revision: '0' },
        { units: 'unknown' },
        { defaultLineweight: 14 },
        { defaultLineweight: 'default' },
        { modelTolerance: null },
        { modelTolerance: {} },
        { modelTolerance: { distance: -1 } },
        { modelTolerance: { distance: NaN } },
        { modelTolerance: { distance: Infinity } },
        { modelTolerance: { distance: '0' } },
        { defaults: null },
        { defaults: {} },
    ])('rejects invalid drawing fields %j', (patch) => {
        expect(() => admitDocument({ ...empty, ...patch })).toThrow(RangeError)
    })

    it.each(collections)('requires a dense array for %s', (key) => {
        const sparse = [...snapshot[key]]

        sparse.length += 1

        for (const value of [null, {}, sparse]) {
            expect(() => admitDocument({ ...snapshot, [key]: value })).toThrow(
                RangeError,
            )
        }
    })

    it.each(collections)('rejects duplicate %s IDs', (key) => {
        const duplicate: Record<string, unknown> = { ...snapshot[key][0] }

        if (key === 'layers') {
            duplicate.name = 'Different name'
        }

        const input = { ...snapshot, [key]: [...snapshot[key], duplicate] }

        expect(() => admitDocument(input)).toThrow('IDs')
    })

    it.each([
        ['Walls', 'WALLS'],
        ['Стены', 'СТЕНЫ'],
        ['Walls', ' walls '],
        ['Straße', 'STRASSE'],
        ['kelvin', 'Kelvin'],
    ])('rejects colliding names %s / %s', (first, second) => {
        const layers = [
            empty.layers[0]!,
            { ...layer, name: first },
            { ...layer, id: 'layer:third:0', name: second },
        ]

        expect(() => admitDocument({ ...snapshot, layers })).toThrow(
            'Layer names',
        )
    })

    it.each(['Zero', ' 0 ', '０'])('requires exact 0 over %s', (name) => {
        const layers = [{ ...empty.layers[0]!, name }, layer]

        expect(() => admitDocument({ ...snapshot, layers })).toThrow('layer 0')
    })

    it.each([
        { defaults: { ...snapshot.defaults, layerId: 'layer:missing:0' } },
        {
            entities: [
                snapshot.entities[0],
                { ...snapshot.entities[1], layerId: 'layer:missing:0' },
            ],
        },
        {
            entities: [
                snapshot.entities[0],
                {
                    ...snapshot.entities[1],
                    source: { sourceId: 'source:missing:0' },
                },
            ],
        },
    ])('requires every layer and source reference to resolve: %j', (patch) => {
        expect(() => admitDocument({ ...snapshot, ...patch })).toThrow(
            RangeError,
        )
    })

    it('uses the document model tolerance at actual polyline joints without snapping', () => {
        const geometry = {
            type: 'polyline',
            closed: false,
            segments: [
                createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
                createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 }),
            ],
        }
        const input = {
            ...snapshot,
            entities: [{ ...snapshot.entities[0], geometry }],
        }

        expect(admitDocument(input).entities[0]!.geometry).toEqual(geometry)
        expect(() =>
            admitDocument({ ...input, modelTolerance: { distance: 0.0625 } }),
        ).toThrow(RangeError)
    })

    it('reads each document and nested record field once before validating its snapshot', () => {
        expect(admitDocument(readOnce(snapshot))).toEqual(snapshot)
    })
})
