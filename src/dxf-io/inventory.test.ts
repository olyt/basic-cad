import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { inventoryDxf, type DxfInventory } from './inventory'
import { tokenizeDxf, type DxfToken } from './tokenize'

// One group per line: the code, a space, then the exact value. Group k is on file line 2k - 1.
function groups(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trimStart())
        .filter((line) => line !== '')
        .flatMap((pair) => {
            const space = pair.indexOf(' ')

            return [pair.slice(0, space), pair.slice(space + 1)]
        })
}

function tokensOf(text: string): readonly DxfToken[] {
    const result = tokenizeDxf([...groups(text), '0', 'EOF', ''].join('\n'))

    if (result.kind !== 'tokens') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.tokens
}

function inventoryOf(text: string): DxfInventory {
    const result = inventoryDxf(tokensOf(text))

    if (result.kind !== 'inventory') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.inventory
}

function entitiesSection(body: string): string {
    return `0 SECTION\n2 ENTITIES\n${body}\n0 ENDSEC`
}

describe('DXF raw inventory', () => {
    it('counts items per section, entity type, object type and table', () => {
        const inventory = inventoryOf(`
            0 SECTION
            2 HEADER
            9 $ACADVER
            1 AC1015
            9 $INSUNITS
            70 4
            0 ENDSEC
            0 SECTION
            2 CLASSES
            0 CLASS
            1 ACDBPLACEHOLDER
            0 ENDSEC
            0 SECTION
            2 TABLES
            0 TABLE
            2 LTYPE
            0 LTYPE
            2 ByLayer
            0 LTYPE
            2 Continuous
            0 ENDTAB
            0 TABLE
            2 LAYER
            0 LAYER
            2 0
            0 ENDTAB
            0 TABLE
            2 VIEW
            0 ENDTAB
            0 ENDSEC
            0 SECTION
            2 BLOCKS
            0 BLOCK
            2 *Model_Space
            0 ENDBLK
            0 BLOCK
            2 *Paper_Space
            0 ENDBLK
            0 ENDSEC
            0 SECTION
            2 ENTITIES
            0 LINE
            0 CIRCLE
            0 LINE
            0 ENDSEC
            0 SECTION
            2 OBJECTS
            0 DICTIONARY
            0 LAYOUT
            0 DICTIONARY
            0 ENDSEC
        `)

        expect(inventory).toEqual({
            sections: [
                { name: 'HEADER', line: 1, items: 2 },
                { name: 'CLASSES', line: 15, items: 1 },
                { name: 'TABLES', line: 25, items: 3 },
                { name: 'BLOCKS', line: 61, items: 2 },
                { name: 'ENTITIES', line: 79, items: 3 },
                { name: 'OBJECTS', line: 91, items: 3 },
            ],
            entities: [
                { name: 'LINE', count: 2 },
                { name: 'CIRCLE', count: 1 },
            ],
            objects: [
                { name: 'DICTIONARY', count: 2 },
                { name: 'LAYOUT', count: 1 },
            ],
            tables: [
                { name: 'LTYPE', line: 29, entries: 2 },
                { name: 'LAYER', line: 43, entries: 1 },
                { name: 'VIEW', line: 53, entries: 0 },
            ],
            unsupported: [],
        })
    })

    it('lists sections outside the six R2000 data sections', () => {
        const inventory = inventoryOf(`
            0 SECTION
            2 THUMBNAILIMAGE
            90 3
            310 0A0B
            0 ENDSEC
            0 SECTION
            2 ACDSDATA
            0 ACDSSCHEMA
            0 ACDSRECORD
            0 ENDSEC
            0 SECTION
            2 entities
            0 LINE
            0 ENDSEC
        `)

        expect(inventory.sections).toEqual([
            { name: 'THUMBNAILIMAGE', line: 1, items: 0 },
            { name: 'ACDSDATA', line: 11, items: 2 },
            { name: 'entities', line: 21, items: 1 },
        ])
        expect(inventory.entities).toEqual([])
        expect(inventory.unsupported).toEqual([
            { kind: 'section', name: 'THUMBNAILIMAGE', line: 1 },
            { kind: 'section', name: 'ACDSDATA', line: 11 },
            { kind: 'section', name: 'entities', line: 21 },
        ])
    })

    it('lists entity types outside the profile with their handles', () => {
        const inventory = inventoryOf(
            entitiesSection(`
                0 TEXT
                5 2B
                0 LINE
                5 1A
                0 POLYLINE
                5 30
                0 VERTEX
                5 31
                0 SEQEND
                5 32
                0 3DFACE
            `),
        )

        expect(inventory.entities.map(({ name }) => name)).toEqual([
            'TEXT',
            'LINE',
            'POLYLINE',
            'VERTEX',
            'SEQEND',
            '3DFACE',
        ])
        expect(inventory.unsupported).toEqual([
            { kind: 'entity', name: 'TEXT', line: 5, handle: '2B' },
            { kind: 'entity', name: 'POLYLINE', line: 13, handle: '30' },
            { kind: 'entity', name: 'VERTEX', line: 17, handle: '31' },
            { kind: 'entity', name: 'SEQEND', line: 21, handle: '32' },
            { kind: 'entity', name: '3DFACE', line: 25 },
        ])
        expect(inventory.unsupported[4]).not.toHaveProperty('handle')
    })

    it('accepts every group the entity readers interpret', () => {
        const inventory = inventoryOf(
            entitiesSection(`
                0 LINE
                5 1
                330 1F
                100 AcDbEntity
                8 Walls
                6 ByLayer
                62 256
                370 -1
                100 AcDbLine
                10 0
                20 0
                30 0
                11 1
                21 1
                31 0
                210 0
                220 0
                230 -1
                999 comment
                0 CIRCLE
                5 2
                10 0
                20 0
                30 0
                40 2
                210 0
                220 0
                230 1
                0 ARC
                5 3
                10 0
                20 0
                30 0
                40 2
                50 0
                51 90
                0 LWPOLYLINE
                5 4
                90 2
                70 1
                43 0
                38 0
                10 0
                20 0
                40 0
                41 0
                42 0.5
                10 1
                20 0
                210 0
                220 0
                230 1
            `),
        )

        expect(inventory.unsupported).toEqual([])
    })

    it('lists other entity groups unless they hold their default value', () => {
        const inventory = inventoryOf(
            entitiesSection(`
                0 LINE
                5 1A
                39 2.5
                48 2
                60 1
                67 1
                420 255
                40 1
                39 0
                48 1.0
                60 0
                67 0
                0 CIRCLE
                50 90
            `),
        )
        const attribute = { kind: 'attribute', record: 'LINE', handle: '1A' }

        expect(inventory.unsupported).toEqual([
            { ...attribute, code: 39, value: 2.5, line: 9 },
            { ...attribute, code: 48, value: 2, line: 11 },
            { ...attribute, code: 60, value: 1, line: 13 },
            { ...attribute, code: 67, value: 1, line: 15 },
            { ...attribute, code: 420, value: 255, line: 17 },
            { ...attribute, code: 40, value: 1, line: 19 },
            {
                kind: 'attribute',
                record: 'CIRCLE',
                code: 50,
                value: 90,
                line: 31,
            },
        ])
    })

    it('lists each application group once without its contents', () => {
        const inventory = inventoryOf(
            entitiesSection(`
                0 LINE
                5 1A
                102 {ACAD_REACTORS
                330 2F
                102 }
                102 {ACAD_XDICTIONARY
                360 30
                102 }
                102 {APP
                1 }
                102 {NESTED
                102 }
                39 7
                102 }
                102 {UNCLOSED
                39 8
            `),
        )
        const attribute = { kind: 'attribute', record: 'LINE', handle: '1A' }

        expect(inventory.unsupported).toEqual([
            { ...attribute, code: 102, value: '{ACAD_REACTORS', line: 9 },
            { ...attribute, code: 102, value: '{ACAD_XDICTIONARY', line: 15 },
            { ...attribute, code: 102, value: '{APP', line: 21 },
            { ...attribute, code: 39, value: 7, line: 29 },
            { ...attribute, code: 102, value: '}', line: 31 },
            { ...attribute, code: 102, value: '{UNCLOSED', line: 33 },
        ])
    })

    it('lists each XDATA application once without its values', () => {
        const inventory = inventoryOf(
            entitiesSection(`
                0 ARC
                5 1A
                1000 orphan
                1001 ACAD
                1000 note
                1040 2.5
                1002 {
                1070 3
                1002 }
                1001 OTHER
                1071 9
                39 3
            `),
        )
        const attribute = { kind: 'attribute', record: 'ARC', handle: '1A' }

        expect(inventory.unsupported).toEqual([
            { ...attribute, code: 1000, value: 'orphan', line: 9 },
            { ...attribute, code: 1001, value: 'ACAD', line: 11 },
            { ...attribute, code: 1001, value: 'OTHER', line: 23 },
            { ...attribute, code: 39, value: 3, line: 27 },
        ])
    })

    it('checks layer entries, and no other table entries, against the profile', () => {
        const inventory = inventoryOf(`
            0 SECTION
            2 TABLES
            0 TABLE
            2 LAYER
            0 LAYER
            5 10
            330 2
            100 AcDbSymbolTableRecord
            100 AcDbLayerTableRecord
            2 Walls
            70 5
            62 -3
            6 Continuous
            370 35
            390 F
            290 1
            0 LAYER
            5 11
            2 Notes
            290 0
            420 16711680
            1001 AcAecLayerStandard
            1000 description
            0 ENDTAB
            0 TABLE
            2 LTYPE
            0 LTYPE
            5 12
            2 DASHED
            49 0.5
            1001 APP
            0 ENDTAB
            0 ENDSEC
        `)
        const attribute = { kind: 'attribute', record: 'LAYER', handle: '11' }

        expect(inventory.tables).toEqual([
            { name: 'LAYER', line: 5, entries: 2 },
            { name: 'LTYPE', line: 49, entries: 1 },
        ])
        expect(inventory.unsupported).toEqual([
            { ...attribute, code: 290, value: 0, line: 39 },
            { ...attribute, code: 420, value: 16711680, line: 41 },
            { ...attribute, code: 1001, value: 'AcAecLayerStandard', line: 43 },
        ])
    })

    it('lists block definitions other than empty model and paper space', () => {
        const inventory = inventoryOf(`
            0 SECTION
            2 BLOCKS
            0 BLOCK
            5 20
            2 *Model_Space
            70 0
            0 ENDBLK
            0 BLOCK
            2 *PAPER_SPACE
            0 ENDBLK
            0 BLOCK
            2 *Paper_Space0
            0 ENDBLK
            0 BLOCK
            5 30
            2 Door
            0 LINE
            0 ARC
            0 ENDBLK
            0 BLOCK
            2 *U2
            70 1
            0 ENDBLK
            0 BLOCK
            2 Site
            70 4
            0 ENDBLK
            0 BLOCK
            2 Overlay
            70 8
            0 ENDBLK
            0 BLOCK
            2 Tagged
            70 2
            0 ENDBLK
            0 BLOCK
            5 40
            2 *Paper_Space1
            0 LINE
            0 CIRCLE
            0 ENDBLK
            0 BLOCK
            2 *Model_Space2
            0 ENDBLK
            0 ENDSEC
        `)

        expect(inventory.sections).toEqual([
            { name: 'BLOCKS', line: 1, items: 10 },
        ])
        expect(inventory.entities).toEqual([])
        expect(inventory.unsupported).toEqual([
            { kind: 'block', name: 'Door', line: 27, handle: '30' },
            { kind: 'block', name: '*U2', line: 39 },
            { kind: 'xref', name: 'Site', line: 47 },
            { kind: 'xref', name: 'Overlay', line: 55 },
            { kind: 'block', name: 'Tagged', line: 63 },
            { kind: 'block', name: '*Paper_Space1', line: 71, handle: '40' },
            { kind: 'block', name: '*Model_Space2', line: 83 },
        ])
    })

    it('ignores comments anywhere', () => {
        expect(
            inventoryOf(`
                999 written by a test
                0 SECTION
                999 before the name
                2 HEADER
                9 $ACADVER
                999 between groups
                1 AC1015
                0 ENDSEC
                999 between records
                0 SECTION
                2 ENTITIES
                0 LINE
                999 inside a record
                5 1A
                0 ENDSEC
            `),
        ).toEqual({
            sections: [
                { name: 'HEADER', line: 3, items: 1 },
                { name: 'ENTITIES', line: 19, items: 1 },
            ],
            entities: [{ name: 'LINE', count: 1 }],
            objects: [],
            tables: [],
            unsupported: [],
        })
    })

    it('reports malformed section, table and block framing with its line', () => {
        const tables = '0 SECTION\n2 TABLES\n0 TABLE\n2 LAYER\n0 LAYER'
        const blocks = '0 SECTION\n2 BLOCKS\n0 BLOCK\n2 Door\n0 LINE'
        const cases: readonly (readonly [string, number, string])[] = [
            [
                '5 1A\n0 SECTION\n2 HEADER\n0 ENDSEC',
                1,
                'Expected 0/SECTION, found group code 5.',
            ],
            ['999 note\n5 1A', 3, 'Expected 0/SECTION, found group code 5.'],
            ['0 ENDSEC', 1, 'Expected 0/SECTION, found record "ENDSEC".'],
            [
                '0 SECTION\n5 1\n2 HEADER\n0 ENDSEC',
                1,
                '0/SECTION has no 2/name group.',
            ],
            ['0 SECTION\n0 ENDSEC', 1, '0/SECTION has no 2/name group.'],
            [
                '0 SECTION\n2 ENTITIES\n0 LINE\n0 SECTION\n2 OBJECTS\n0 ENDSEC',
                7,
                'Section "ENTITIES" ends without 0/ENDSEC.',
            ],
            [
                '0 SECTION\n2 ENTITIES\n0 LINE',
                7,
                'Section "ENTITIES" ends without 0/ENDSEC.',
            ],
            [
                '0 SECTION\n2 HEADER\n9 $ACADVER\n1 AC1015\n0 LINE\n0 ENDSEC',
                9,
                'Expected 0/ENDSEC in HEADER, found record "LINE".',
            ],
            [
                '0 SECTION\n2 TABLES\n0 LAYER\n0 ENDSEC',
                5,
                'Expected 0/TABLE or 0/ENDSEC in TABLES, found record "LAYER".',
            ],
            [
                '0 SECTION\n2 TABLES\n0 TABLE\n5 2\n0 ENDTAB\n0 ENDSEC',
                5,
                '0/TABLE has no 2/name group.',
            ],
            [
                `${tables}\n0 LTYPE\n0 ENDTAB\n0 ENDSEC`,
                11,
                'Expected "LAYER" entries, found record "LTYPE".',
            ],
            [`${tables}\n0 ENDSEC`, 11, 'Table "LAYER" ends without 0/ENDTAB.'],
            [
                `${tables}\n0 TABLE\n2 LTYPE`,
                11,
                'Table "LAYER" ends without 0/ENDTAB.',
            ],
            [
                `${tables}\n0 SECTION\n2 BLOCKS`,
                11,
                'Table "LAYER" ends without 0/ENDTAB.',
            ],
            [tables, 11, 'Table "LAYER" ends without 0/ENDTAB.'],
            [
                '0 SECTION\n2 BLOCKS\n0 LINE\n0 ENDSEC',
                5,
                'Expected 0/BLOCK or 0/ENDSEC in BLOCKS, found record "LINE".',
            ],
            [
                '0 SECTION\n2 BLOCKS\n0 BLOCK\n5 20\n0 ENDBLK\n0 ENDSEC',
                5,
                '0/BLOCK has no 2/name group.',
            ],
            [
                `${blocks}\n0 BLOCK\n2 Window`,
                11,
                'Block "Door" ends without 0/ENDBLK.',
            ],
            [`${blocks}\n0 ENDSEC`, 11, 'Block "Door" ends without 0/ENDBLK.'],
            [
                `${blocks}\n0 SECTION\n2 OBJECTS`,
                11,
                'Block "Door" ends without 0/ENDBLK.',
            ],
            [blocks, 11, 'Block "Door" ends without 0/ENDBLK.'],
        ]

        for (const [text, line, message] of cases) {
            expect(inventoryDxf(tokensOf(text))).toEqual({
                kind: 'error',
                line,
                message,
            })
        }
    })

    it('shortens long record names quoted in errors', () => {
        expect(inventoryDxf(tokensOf(`0 ${'X'.repeat(1_000)}`))).toEqual({
            kind: 'error',
            line: 1,
            message: `Expected 0/SECTION, found record "${'X'.repeat(40)}…".`,
        })
    })

    it('treats the end of a token list without EOF as the end of the file', () => {
        const complete = tokensOf(entitiesSection('0 LINE'))
        const open = tokensOf('0 SECTION\n2 ENTITIES\n0 LINE\n5 1A')

        expect(inventoryDxf(complete.slice(0, -1))).toEqual(
            inventoryDxf(complete),
        )
        expect(inventoryDxf(open.slice(0, -1))).toEqual({
            kind: 'error',
            line: 7,
            message: 'Section "ENTITIES" ends without 0/ENDSEC.',
        })
        expect(inventoryDxf([])).toEqual({
            kind: 'inventory',
            inventory: {
                sections: [],
                entities: [],
                objects: [],
                tables: [],
                unsupported: [],
            },
        })
    })

    it('returns a result for random record sequences without throwing', () => {
        const types = [
            'SECTION',
            'ENDSEC',
            'TABLE',
            'ENDTAB',
            'BLOCK',
            'ENDBLK',
            'EOF',
            'LAYER',
            'LINE',
            'TEXT',
        ]
        const fragments: readonly (readonly [number, string | number])[] = [
            [2, 'HEADER'],
            [2, 'TABLES'],
            [2, 'BLOCKS'],
            [2, 'ENTITIES'],
            [2, 'LAYER'],
            [2, '*Paper_Space'],
            [5, '1A'],
            [9, '$ACADVER'],
            [39, 2],
            [67, 0],
            [70, 4],
            [102, '{ACAD_REACTORS'],
            [102, '}'],
            [290, 0],
            [999, 'note'],
            [1001, 'APP'],
            [1040, 1.5],
        ]
        const random = seededRandom(45)
        const pick = <T>(items: readonly T[]): T =>
            items[Math.floor(random.between(0, items.length))] as T

        for (let sample = 0; sample < 2_000; sample += 1) {
            const length = Math.floor(random.between(0, 60))
            const tokens = Array.from({ length }, (_, index): DxfToken => {
                const [code, value] =
                    random.between(0, 1) < 0.4
                        ? [0, pick(types)]
                        : pick(fragments)

                return { code, value, line: 2 * index + 1 }
            })
            const result = inventoryDxf(tokens)

            if (result.kind === 'error') {
                expect(result.line).toBeGreaterThanOrEqual(1)
                expect(result.line).toBeLessThanOrEqual(2 * length)
            } else {
                const lines = result.inventory.unsupported.map(
                    ({ line }) => line,
                )

                expect(lines).toEqual(lines.toSorted((a, b) => a - b))
            }
        }
    })
})
