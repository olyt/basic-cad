import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from './document'
import { createIdState } from './id'
import {
    admitEntityProperties,
    admitEntitySource,
    admitLayer,
    admitSourceFile,
} from './record-admission'

const { document } = createEmptyDocument(createIdState('admission', 0), {
    modelTolerance: { distance: 1e-7 },
})
const layer = { ...document.layers[0]!, name: ' Контур ', frozen: true }
const source = {
    id: 'source:import:0',
    format: 'dxf',
    fileName: 'План.dxf',
    version: 'AC1015',
}
const provenance = { sourceId: source.id, handle: 'AA' }
const cases = [
    { read: admitLayer, value: layer },
    { read: admitEntityProperties, value: document.defaults },
    { read: admitSourceFile, value: source },
    { read: admitEntitySource, value: provenance },
]

describe('document record admission', () => {
    it('copies supported fields without mutating frozen inputs or normalizing text', () => {
        for (const { read, value } of cases) {
            const input = Object.freeze({ ...value, extra: 'adapter data' })
            const admitted = read(input)

            expect(admitted).toEqual(value)
            expect(admitted).not.toBe(input)
            expect(input.extra).toBe('adapter data')
        }
    })

    it('reads each field once, so an accessor cannot change a checked value', () => {
        for (const { read, value } of cases) {
            const reads: Record<string, number> = {}
            const input = new Proxy(value, {
                get(target, key) {
                    const name = String(key)

                    reads[name] = (reads[name] ?? 0) + 1

                    return Reflect.get(target, key)
                },
            })

            expect(read(input)).toEqual(value)
            expect(reads).toEqual(
                Object.fromEntries(Object.keys(value).map((key) => [key, 1])),
            )
        }
    })

    it.each([null, undefined, [], 'record', 7, false])(
        'rejects non-record input %s in every reader',
        (value) => {
            for (const { read } of cases) {
                expect(() => read(value)).toThrow(RangeError)
            }
        },
    )

    it('rejects arrays even when their named fields would form valid records', () => {
        for (const { read, value } of cases) {
            expect(() => read(Object.assign([], value))).toThrow(RangeError)
        }
    })

    it('requires every mandatory field and retains valid zero lineweight', () => {
        for (const { read, value } of cases) {
            for (const key of Object.keys(value)) {
                if (key === 'version' || key === 'handle') {
                    continue
                }

                const incomplete: Record<string, unknown> = { ...value }

                delete incomplete[key]
                expect(() => read(incomplete)).toThrow(RangeError)
            }
        }

        expect(admitLayer({ ...layer, lineweight: 0 }).lineweight).toBe(0)
        expect(
            admitEntityProperties({ ...document.defaults, lineweight: 0 })
                .lineweight,
        ).toBe(0)
    })

    it.each([
        { id: 'entity:admission:1' },
        { id: 'layer:admission:01' },
        { name: '' },
        { name: ' \t\n' },
        { name: 'A\nB' },
        { name: 'walls/doors' },
        { name: 'A:B' },
        { name: 'A*B' },
        { name: 'A,B' },
        { name: 0 },
        { color: 0 },
        { color: 256 },
        { color: 'by-layer' },
        { lineweight: 'by-layer' },
        { lineweight: 'by-block' },
        { lineweight: 14 },
        { linetype: 'by-layer' },
        { linetype: 'dashed' },
    ])('rejects invalid layer fields %j', (patch) => {
        expect(() => admitLayer({ ...layer, ...patch })).toThrow(RangeError)
    })

    it('requires booleans for all three independent layer flags', () => {
        for (const key of ['visible', 'frozen', 'locked']) {
            for (const value of [0, 1, 'false', null, undefined]) {
                expect(() => admitLayer({ ...layer, [key]: value })).toThrow(
                    RangeError,
                )
            }

            expect(admitLayer({ ...layer, [key]: false })).toMatchObject({
                [key]: false,
            })
            expect(admitLayer({ ...layer, [key]: true })).toMatchObject({
                [key]: true,
            })
        }
    })

    it.each([
        { layerId: source.id },
        { color: 'by-block' },
        { color: 1.5 },
        { lineweight: -1 },
        { linetype: 'dashed' },
    ])('rejects invalid entity defaults %j', (patch) => {
        expect(() =>
            admitEntityProperties({ ...document.defaults, ...patch }),
        ).toThrow(RangeError)
    })

    it('retains explicit entity properties and all supported inheritance modes', () => {
        const explicit = {
            ...document.defaults,
            color: 255,
            lineweight: 158,
            linetype: 'continuous',
        }

        expect(admitEntityProperties(explicit)).toEqual(explicit)

        for (const lineweight of ['by-layer', 'by-block', 'default']) {
            const properties = {
                ...document.defaults,
                lineweight,
                linetype: 'by-block',
            }

            expect(admitEntityProperties(properties)).toEqual(properties)
        }
    })

    it.each([
        { id: layer.id },
        { format: 'DXF' },
        { format: 'svg' },
        { fileName: '' },
        { fileName: null },
        { version: '' },
        { version: null },
        { version: 2000 },
    ])('rejects invalid source file fields %j', (patch) => {
        expect(() => admitSourceFile({ ...source, ...patch })).toThrow(
            RangeError,
        )
    })

    it('accepts DWG provenance and omits absent optional metadata', () => {
        const input = { ...source, format: 'dwg', version: undefined }

        expect(admitSourceFile(input)).toEqual({
            id: source.id,
            format: 'dwg',
            fileName: source.fileName,
        })
        expect(admitSourceFile(input)).not.toHaveProperty('version')
        expect(
            admitEntitySource({ sourceId: source.id, handle: undefined }),
        ).toEqual({ sourceId: source.id })
        expect(admitEntitySource({ sourceId: source.id })).not.toHaveProperty(
            'handle',
        )
    })

    it.each([
        { sourceId: layer.id },
        { handle: '' },
        { handle: null },
        { handle: 10 },
    ])('rejects invalid entity provenance %j', (patch) => {
        expect(() => admitEntitySource({ ...provenance, ...patch })).toThrow(
            RangeError,
        )
    })
})
