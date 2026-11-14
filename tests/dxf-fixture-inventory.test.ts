import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes } from '../src/dxf-io/decode-bytes'
import { inventoryDxf, type DxfInventory } from '../src/dxf-io/inventory'
import { tokenizeDxf } from '../src/dxf-io/tokenize'
import { decodeText } from '../src/file-io/text-codec'

interface Manifest {
    readonly layers: readonly unknown[]
    readonly sourceLayers?: readonly unknown[]
    readonly entities: readonly {
        readonly handle: string
        readonly sourceType: string
        readonly classification: string
    }[]
}

const corpus = fileURLToPath(new URL('../fixtures/dxf/r2000/', import.meta.url))
const fixtures = readdirSync(corpus, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.dxf'))
    .sort()
// Named and anonymous blocks behind the unsupported fixture's INSERT and DIMENSION.
const fixtureBlocks: ReadonlyMap<string, readonly string[]> = new Map([
    ['ezdxf/unsupported-content.dxf', ['ProbeBlock', '*D1', '_CLOSEDFILLED']],
])

function inventoryOf(path: string): DxfInventory {
    const decoded = decodeDxfBytes(readFileSync(join(corpus, path)), decodeText)

    if (decoded.kind !== 'text') {
        throw new Error(decoded.message)
    }

    const tokens = tokenizeDxf(decoded.text)

    if (tokens.kind !== 'tokens') {
        throw new Error(`Line ${tokens.line}: ${tokens.message}`)
    }

    const result = inventoryDxf(tokens.tokens)

    if (result.kind !== 'inventory') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.inventory
}

function manifestOf(path: string): Manifest {
    return JSON.parse(
        readFileSync(
            join(corpus, path.replace(/\.dxf$/, '.expected.json')),
            'utf8',
        ),
    ) as Manifest
}

function typeCounts(types: readonly string[]) {
    const counts = new Map<string, number>()

    for (const type of types) {
        counts.set(type, (counts.get(type) ?? 0) + 1)
    }

    return Array.from(counts, ([name, count]) => ({ name, count }))
}

describe('DXF fixture inventory', () => {
    it.each(fixtures)('inventories %s against its expected content', (path) => {
        const inventory = inventoryOf(path)
        const manifest = manifestOf(path)
        const layerTable = inventory.tables.find(({ name }) => name === 'LAYER')
        const unsupported = (kind: string) =>
            inventory.unsupported.filter((item) => item.kind === kind)

        expect(inventory.sections.map(({ name }) => name)).toEqual([
            'HEADER',
            'CLASSES',
            'TABLES',
            'BLOCKS',
            'ENTITIES',
            'OBJECTS',
        ])
        expect(inventory.entities).toEqual(
            typeCounts(manifest.entities.map(({ sourceType }) => sourceType)),
        )
        expect(layerTable?.entries).toBe(
            (manifest.sourceLayers ?? manifest.layers).length,
        )
        expect(unsupported('entity')).toEqual(
            manifest.entities
                .filter(
                    ({ classification }) => classification === 'unsupported',
                )
                .map(({ sourceType, handle }) =>
                    expect.objectContaining({ name: sourceType, handle }),
                ),
        )
        expect(
            inventory.unsupported.flatMap((item) =>
                item.kind === 'block' ? [item.name] : [],
            ),
        ).toEqual(fixtureBlocks.get(path) ?? [])
        expect([...unsupported('section'), ...unsupported('xref')]).toEqual([])
    })

    it('finds no unsupported entity groups, and only the ezdxf Defpoints plot flag', () => {
        for (const path of fixtures) {
            const attributes = inventoryOf(path).unsupported.filter(
                (item) => item.kind === 'attribute',
            )

            // Handle 28 is the unplotted Defpoints layer ezdxf adds to every drawing.
            expect(attributes).toEqual(
                path.startsWith('ezdxf/')
                    ? [
                          expect.objectContaining({
                              record: 'LAYER',
                              handle: '28',
                              code: 290,
                              value: 0,
                          }),
                      ]
                    : [],
            )
        }
    })
})
