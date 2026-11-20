import { describe, expect, it } from 'vitest'
import { createAciColor, LINEWEIGHT_VALUES } from '../document/properties'
import {
    indexDxfReferences,
    readDxfEntityProperties,
    type EntityPropertyContext,
} from './entity-properties'
import { records } from './inventory'
import { type DxfLayer } from './layers'
import { tokenizeDxf } from './tokenize'

const source = { type: 'LAYER', line: 1, tokens: [] }
const layer: DxfLayer = {
    record: source,
    name: 'Plan',
    issues: [],
    value: {
        name: 'Plan',
        color: createAciColor(7),
        visible: true,
        frozen: false,
        locked: false,
        lineweight: 'default',
        linetype: 'continuous',
    },
}
const context: EntityPropertyContext = {
    layers: [layer],
    linetypes: [{ name: 'CONTINUOUS', value: 'continuous', record: source }],
}
const payload = '102\n{APP\n8\nOther\n62\n1\n6\nDASHED\n370\n50\n102\n}\n'

function read(body = '8\nPlan\n', dependencies = context) {
    const result = tokenizeDxf(`0\nLINE\n${body}0\nEOF\n`)

    if (result.kind !== 'tokens') {
        throw new Error(result.message)
    }

    return readDxfEntityProperties(
        records(result.tokens).next().value!,
        indexDxfReferences(dependencies),
    )
}

describe('DXF entity properties', () => {
    it('uses only the omitted optional-property defaults', () => {
        expect(read().value).toEqual({
            layerName: 'Plan',
            color: 'by-layer',
            lineweight: 'by-layer',
            linetype: 'by-layer',
        })
        expect(read().issues).toEqual([])
        expect(read('8\nPlan\n62\n256\n').value?.color).toBe('by-layer')
        expect(read('').value).toBeUndefined()
        expect(read('').issues).toContainEqual(
            expect.objectContaining({ code: 8, line: 1 }),
        )
    })

    it('preserves every explicit ACI and lineweight', () => {
        for (let color = 1; color <= 255; color += 1) {
            expect(read(`8\nPlan\n62\n${color}\n`).value?.color).toBe(color)
        }

        for (const weight of LINEWEIGHT_VALUES) {
            expect(read(`8\nPlan\n370\n${weight}\n`).value?.lineweight).toBe(
                weight,
            )
        }
    })

    it.each([
        [-1, 'by-layer'],
        [-2, 'by-block'],
        [-3, 'default'],
    ] as const)('preserves lineweight mode %s', (code, value) => {
        expect(read(`8\nPlan\n370\n${code}\n`).value?.lineweight).toBe(value)
    })

    it.each([
        ['bYlAyEr', 'by-layer'],
        ['BYBLOCK', 'by-block'],
        ['continuous', 'continuous'],
    ] as const)('resolves linetype %s', (name, value) => {
        expect(read(`8\nPlan\n6\n${name}\n`).value?.linetype).toBe(value)
    })

    it.each([
        ['pLaN', 'Plan'],
        ['\\U+041F\\U+043B\\U+0430\\U+043D\\U+D83D\\U+DE00', 'План😀'],
        ['K', 'K'],
        ['ß', 'SS'],
        [' plan ', ' Plan '],
    ])('resolves exact-spacing decoded layer %s', (reference, name) => {
        const target = { ...layer, name, value: { ...layer.value!, name } }
        const item = read(`8\n${reference}\n`, { ...context, layers: [target] })

        expect(item.value?.layerName).toBe(name)
        expect(item.record.tokens).toContainEqual(
            expect.objectContaining({ code: 8, value: reference }),
        )
    })

    it.each([
        [8, ['', 'Missing', ' Plan ', 'Plan\n8\nPlan']],
        [62, [0, -7, 257, '1\n62\n2']],
        [6, ['', 'DASHED', ' CONTINUOUS ', 'BYLAYER\n6\nBYLAYER']],
        [370, [17, -4, '-1\n370\n-1']],
    ] as const)('rejects malformed or duplicate group %s', (code, values) => {
        for (const value of values) {
            const body = `${code === 8 ? '' : '8\nPlan\n'}${code}\n${value}\n`
            const item = read(body)

            expect(item.value, body).toBeUndefined()
            expect(item.issues).toContainEqual(
                expect.objectContaining({ kind: 'unsupported', code }),
            )
        }
    })

    it('requires unique usable layer and explicit linetype dependencies', () => {
        for (const layers of [
            [],
            [{ ...layer, value: undefined }],
            [layer, layer],
        ]) {
            expect(
                read(undefined, { ...context, layers }).value,
            ).toBeUndefined()
        }

        for (const linetypes of [
            [],
            [context.linetypes[0]!, context.linetypes[0]!],
            [{ ...context.linetypes[0]!, value: undefined }],
        ]) {
            expect(
                read('8\nPlan\n6\nCONTINUOUS\n', { ...context, linetypes })
                    .value,
            ).toBeUndefined()
            expect(
                read(undefined, { ...context, linetypes }).value?.linetype,
            ).toBe('by-layer')
        }
    })

    it('propagates unsupported layer dependencies without repeating layer conversions', () => {
        const issues: DxfLayer['issues'] = [
            { kind: 'converted', code: 70, line: 5, message: 'Frozen' },
            { kind: 'unsupported', code: 290, line: 7, message: 'Plot' },
        ]
        const frozen = {
            ...layer,
            value: { ...layer.value!, frozen: true, visible: false },
            issues: issues.slice(0, 1),
        }

        expect(
            read(undefined, { ...context, layers: [frozen] }).issues,
        ).toEqual([])

        const item = read(undefined, {
            ...context,
            layers: [{ ...frozen, issues }],
        })

        expect(item.value?.layerName).toBe('Plan')
        expect(item.issues).toEqual([
            expect.objectContaining({ kind: 'unsupported', code: 8, line: 3 }),
        ])
    })

    it('resolves every entity of a 20K-layer drawing to its own layer', () => {
        const names = Array.from({ length: 20_000 }, (_, index) => `L${index}`)
        const references = indexDxfReferences({
            ...context,
            layers: names.map((name) => ({
                ...layer,
                name,
                value: { ...layer.value!, name },
            })),
        })
        // A per-entity layer scan took about 14 s here; the 5 s test timeout catches its return.
        const resolved = names.map(
            (name, index) =>
                readDxfEntityProperties(
                    {
                        type: 'LINE',
                        line: index + 1,
                        tokens: [{ code: 8, value: name, line: index + 2 }],
                    },
                    references,
                ).value?.layerName,
        )

        expect(resolved).toEqual(names)
    })

    it('keeps application payload out of required fields, defaults and diagnostic positions', () => {
        expect(read('8\nPlan\n' + payload).value).toEqual(read().value)
        expect(read('8\nPlan\n62\n7\n' + payload).value?.color).toBe(7)
        expect(read(payload).value).toBeUndefined()
        expect(read('8\nPlan\n62\n-7\n' + payload).issues).toContainEqual(
            expect.objectContaining({ code: 62, line: 5 }),
        )
    })

    it('retains opaque handles and reports malformed provenance without losing base properties', () => {
        expect(read('8\nPlan\n5\n  source-handle  \n').handle).toBe(
            '  source-handle  ',
        )

        for (const extra of ['5\n\n', '5\n  \n', '5\nA\n5\nB\n']) {
            const item = read('8\nPlan\n' + extra)

            expect(item.handle).toBeUndefined()
            expect(item.value?.layerName).toBe('Plan')
            expect(item.issues).toContainEqual(
                expect.objectContaining({ kind: 'unsupported', code: 5 }),
            )
        }
    })
})
