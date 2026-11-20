import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes } from '../src/dxf-io/decode-bytes'
import {
    indexDxfReferences,
    readDxfEntityProperties,
} from '../src/dxf-io/entity-properties'
import { readDxfHeader, type DxfHeader } from '../src/dxf-io/header'
import { records } from '../src/dxf-io/inventory'
import { readDxfLayers } from '../src/dxf-io/layers'
import { readDxfLinetypes } from '../src/dxf-io/linetypes'
import { readDxfPrimitive } from '../src/dxf-io/primitives'
import { readDxfTables } from '../src/dxf-io/tables'
import { tokenizeDxf, type DxfToken } from '../src/dxf-io/tokenize'
import { decodeText } from '../src/file-io/text-codec'

interface Point {
    readonly x: number
    readonly y: number
}

interface Geometry {
    readonly type: string
    readonly start?: Point
    readonly end?: Point
    readonly center?: Point
    readonly radius?: number
    readonly startAngle?: number
    readonly sweep?: number
}

interface Manifest extends DxfHeader {
    readonly modelTolerance: { readonly distance: number }
    readonly layers: readonly {
        readonly name: string
        readonly frozen: boolean
    }[]
    readonly sourceLayers?: readonly unknown[]
    readonly entities: readonly {
        readonly handle: string
        readonly sourceType: string
        readonly classification: string
        readonly geometry: Geometry | null
        readonly layerName: string
        readonly color: unknown
        readonly lineweight: unknown
        readonly linetype: string
    }[]
}

const corpus = fileURLToPath(new URL('../fixtures/dxf/r2000/', import.meta.url))
const fixtures = readdirSync(corpus, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.dxf'))
    .sort()

function tokensOf(path: string): readonly DxfToken[] {
    const decoded = decodeDxfBytes(readFileSync(join(corpus, path)), decodeText)

    if (decoded.kind !== 'text') {
        throw new Error(decoded.message)
    }

    const result = tokenizeDxf(decoded.text)

    if (result.kind !== 'tokens') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.tokens
}

function manifestOf(path: string): Manifest {
    return JSON.parse(
        readFileSync(
            join(corpus, path.replace(/\.dxf$/, '.expected.json')),
            'utf8',
        ),
    ) as Manifest
}

function tablesOf(path: string) {
    const tokens = tokensOf(path)
    const result = readDxfTables(tokens)

    if (result.kind !== 'tables') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    const table = (name: string) =>
        result.tables.find((item) => item.name === name)!
    const linetypes = readDxfLinetypes(table('LTYPE'))

    return {
        tokens,
        layerTable: table('LAYER'),
        linetypes,
        layers: readDxfLayers(table('LAYER'), linetypes),
    }
}

function referencesOf(path: string) {
    const { tokens, linetypes, layers } = tablesOf(path)
    const sourceRecords = Array.from(records(tokens))

    return {
        references: indexDxfReferences({ layers, linetypes }),
        recordOf: (handle: string) =>
            sourceRecords.find(({ tokens }) =>
                tokens.some(
                    ({ code, value }) => code === 5 && value === handle,
                ),
            )!,
    }
}

// Arc angles are scaled by their radius so every difference is a distance.
function deviation(actual: Geometry, expected: Geometry): number {
    const positions = (geometry: Geometry) => {
        const { start, end, center, radius = 0 } = geometry
        const { startAngle = 0, sweep = 0 } = geometry

        return [
            start?.x,
            start?.y,
            end?.x,
            end?.y,
            center?.x,
            center?.y,
            radius,
            radius * startAngle,
            radius * sweep,
        ].map((value) => value ?? 0)
    }
    const wanted = positions(expected)

    return Math.max(
        ...positions(actual).map((value, index) =>
            Math.abs(value - wanted[index]!),
        ),
    )
}

describe('DXF fixture readers', () => {
    it.each(fixtures)('reads the %s header', (path) => {
        const expected = manifestOf(path)

        expect(readDxfHeader(tokensOf(path))).toEqual({
            kind: 'header',
            header: {
                sourceVersion: expected.sourceVersion,
                currentLayer: expected.currentLayer,
                codepage: expected.codepage,
                unitCode: expected.unitCode,
                units: expected.units,
                measurement: expected.measurement,
            },
        })
    })

    it.each(fixtures)('reads the %s tables and linetypes', (path) => {
        const { layerTable, linetypes } = tablesOf(path)
        const expected = manifestOf(path)

        expect(layerTable.entries).toHaveLength(
            (expected.sourceLayers ?? expected.layers).length,
        )
        expect(
            linetypes
                .flatMap(({ value }) => (value === undefined ? [] : [value]))
                .sort(),
        ).toEqual(['by-block', 'by-layer', 'continuous'])
        expect(
            linetypes.filter(({ reason }) => reason !== undefined),
        ).toHaveLength(path.startsWith('librecad/') ? 24 : 0)
    })

    it.each(fixtures)('normalizes the %s layers and their issues', (path) => {
        const { layers } = tablesOf(path)
        const expected = manifestOf(path)

        expect(layers.map(({ value }) => value)).toEqual(expected.layers)
        // Generated Defpoints is unplotted (290=0), which a layer cannot keep.
        expect(
            layers.map(({ issues }) =>
                issues.map(({ kind, code }) => [kind, code]),
            ),
        ).toEqual(
            expected.layers.map(({ name, frozen }) => [
                ...(name === 'Defpoints' ? [['unsupported', 290]] : []),
                ...(frozen ? [['converted', 70]] : []),
            ]),
        )
    })

    it.each(fixtures)(
        'reads the %s entity properties without issues',
        (path) => {
            const { references, recordOf } = referencesOf(path)

            for (const entity of manifestOf(path).entities) {
                const { handle, layerName, color, lineweight, linetype } =
                    entity
                const record = recordOf(handle)

                expect(readDxfEntityProperties(record, references)).toEqual({
                    record,
                    handle,
                    value: { layerName, color, lineweight, linetype },
                    issues: [],
                })
            }
        },
    )

    it.each(fixtures)('reads the %s LINE, CIRCLE and ARC geometry', (path) => {
        const { references, recordOf } = referencesOf(path)
        const { entities, modelTolerance } = manifestOf(path)
        const primitives = entities.filter(({ sourceType }) =>
            ['LINE', 'CIRCLE', 'ARC'].includes(sourceType),
        )

        for (const { classification, geometry, ...entity } of primitives) {
            const { handle, layerName, color, lineweight, linetype } = entity
            const item = readDxfPrimitive(recordOf(handle), references)
            // Converted entities have flipped normals, which CAD-050 converts.
            const flipped = classification === 'converted'

            expect(item.handle).toBe(handle)
            expect(item.issues.map(({ kind, code }) => [kind, code])).toEqual(
                flipped ? [['unsupported', 230]] : [],
            )

            if (flipped && entity.sourceType !== 'LINE') {
                expect(item.value).toBeUndefined()
                continue
            }

            const { geometry: actual, ...properties } = item.value!

            expect(properties).toEqual({
                layerName,
                color,
                lineweight,
                linetype,
            })
            expect(actual.type).toBe(geometry!.type)
            expect(deviation(actual, geometry!)).toBeLessThanOrEqual(
                modelTolerance.distance,
            )
        }
    })
})
