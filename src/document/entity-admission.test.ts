import { describe, expect, it } from 'vitest'
import { FULL_TURN } from '../geometry/angle'
import {
    createArc,
    createCircle,
    createLine,
    MAX_COORDINATE,
} from '../geometry/curve'
import { type ModelTolerance } from '../geometry/tolerance'
import { admitEntity } from './entity-admission'
import { admitCurve } from './geometry-admission'

const tolerance = { distance: 1e-7 }
const line = createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
const circle = createCircle({ x: 3, y: 4 }, 2)
const arc = createArc({
    center: { x: 1, y: 1 },
    radius: 1,
    startAngle: -Math.PI / 2,
    sweep: Math.PI / 2,
})
const polyline = { type: 'polyline', segments: [line, arc], closed: false }
const curves = [
    line,
    circle,
    createCircle({ x: MAX_COORDINATE, y: -MAX_COORDINATE }, MAX_COORDINATE),
    arc,
    polyline,
    {
        ...polyline,
        segments: [line, arc, createLine({ x: 2, y: 1 }, line.start)],
        closed: true,
    },
]
const entity = {
    id: 'entity:admission:2',
    layerId: 'layer:admission:1',
    color: 'by-layer',
    lineweight: 'default',
    linetype: 'continuous',
    geometry: polyline,
    source: { sourceId: 'source:other-file:0', handle: 'AA' },
}

function freeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze)
        Object.freeze(value)
    }

    return value
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

function readOnce<Value extends object>(value: Value): Value {
    const reads = new Set<PropertyKey>()

    return new Proxy(value, {
        get(target, key) {
            expect(reads.has(key), `Repeated field read: ${String(key)}`).toBe(
                false,
            )
            reads.add(key)

            return Reflect.get(target, key)
        },
    })
}

describe('entity and geometry admission', () => {
    it.each(curves)(
        'copies frozen $type geometry and all nested coordinates',
        (curve) => {
            expectDetached(admitCurve(freeze(curve), tolerance), curve)
        },
    )

    it('copies entity properties, geometry and provenance without retaining extra fields', () => {
        const input = freeze({
            ...entity,
            extra: true,
            source: { ...entity.source, extra: true },
            geometry: { ...polyline, extra: true },
        })

        expectDetached(admitEntity(input, tolerance), entity)
        expect(input.extra).toBe(true)
    })

    it('normalizes arc starts while preserving signed, arbitrarily shallow curvature', () => {
        const input = { ...arc, startAngle: -0.25, sweep: -1e-20 }

        expect(admitCurve(input, tolerance)).toEqual(createArc(input))
    })

    it.each([
        null,
        undefined,
        [],
        {},
        { type: 'spline' },
        { ...line, start: null },
        { ...line, end: undefined },
        { ...line, end: { x: '1', y: 0 } },
        { ...line, start: { x: NaN, y: 0 } },
        { ...line, end: { x: MAX_COORDINATE + 1, y: 0 } },
        { ...line, end: line.start },
        { ...circle, center: { x: 0 } },
        { ...circle, radius: '2' },
        { ...circle, radius: 0 },
        { ...circle, radius: MAX_COORDINATE + 1 },
        { ...circle, radius: Infinity },
        { ...arc, startAngle: undefined },
        { ...arc, startAngle: '0' },
        { ...arc, sweep: 0 },
        { ...arc, sweep: FULL_TURN },
    ])('rejects malformed or unsupported geometry %j', (value) => {
        expect(() => admitCurve(value, tolerance)).toThrow(RangeError)
        expect(() =>
            admitEntity({ ...entity, geometry: value }, tolerance),
        ).toThrow(RangeError)
    })

    it.each([
        { segments: [] },
        { segments: null },
        { segments: { 0: line, length: 1 } },
        { segments: [circle] },
        { segments: [polyline] },
        { segments: [null] },
        { segments: Object.assign(Array<unknown>(3), { 0: line, 2: arc }) },
        { closed: undefined },
        { closed: 1 },
        { closed: true, segments: [line] },
    ])('rejects invalid polyline structure %j', (patch) => {
        expect(() => admitCurve({ ...polyline, ...patch }, tolerance)).toThrow(
            RangeError,
        )
    })

    it('admits an exact binary joint gap at tolerance without snapping either endpoint', () => {
        const input = {
            ...polyline,
            segments: [line, createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 })],
        }

        expect(admitCurve(input, { distance: 0.125 })).toEqual(input)
        expect(() => admitCurve(input, { distance: 0.0625 })).toThrow(
            RangeError,
        )
    })

    it('checks closed seams with the supplied tolerance and retains the admitted gap', () => {
        const input = {
            ...polyline,
            closed: true,
            segments: [line, createLine(line.end, { x: 0.125, y: 0 })],
        }

        expect(admitCurve(input, { distance: 0.125 })).toEqual(input)
        expect(() => admitCurve(input, { distance: 0.0625 })).toThrow(
            RangeError,
        )
        expect(
            admitCurve({ ...input, closed: false }, { distance: 0 }),
        ).toEqual({ ...input, closed: false })
    })

    it.each([
        undefined,
        null,
        {},
        { distance: -1 },
        { distance: NaN },
        { distance: Infinity },
        { distance: '0' },
    ])(
        'requires valid explicit model tolerance even for primitives: %j',
        (value) => {
            for (const geometry of [line, circle, arc]) {
                expect(() =>
                    admitCurve(geometry, value as ModelTolerance),
                ).toThrow(RangeError)
                expect(() =>
                    admitEntity(
                        { ...entity, geometry },
                        value as ModelTolerance,
                    ),
                ).toThrow(RangeError)
            }
        },
    )

    it.each([
        { id: undefined },
        { id: 'layer:admission:2' },
        { id: 'entity:admission:02' },
        { layerId: undefined },
        { color: 'by-block' },
        { lineweight: -1 },
        { linetype: 'dashed' },
        { source: null },
        { source: { sourceId: entity.id } },
        { source: { ...entity.source, handle: '' } },
    ])('rejects invalid entity fields %j', (patch) => {
        expect(() => admitEntity({ ...entity, ...patch }, tolerance)).toThrow(
            RangeError,
        )
    })

    it('omits absent source metadata without inventing provenance', () => {
        expect(
            admitEntity({ ...entity, source: undefined }, tolerance),
        ).not.toHaveProperty('source')

        const { source: omitted, ...input } = entity

        expect(omitted).toBeDefined()
        expect(admitEntity(input, tolerance)).toEqual(input)
    })

    it('reads each entity, curve and coordinate field once before validating it', () => {
        const geometry = readOnce({
            ...line,
            start: readOnce(line.start),
            end: readOnce(line.end),
        })

        expect(
            admitEntity(readOnce({ ...entity, geometry }), readOnce(tolerance)),
        ).toEqual({ ...entity, geometry: line })
    })
})
