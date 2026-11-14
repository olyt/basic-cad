import { quoted, type DxfToken } from './tokenize'

export type InventoryOutcome = 'inventory' | 'error'
export type UnsupportedKind =
    'section' | 'entity' | 'block' | 'xref' | 'attribute'

type ScopeKind = 'top' | 'section' | 'table' | 'block'

export interface TypeCount {
    readonly name: string
    readonly count: number
}

export interface SectionCount {
    readonly name: string
    readonly line: number
    // Variables in HEADER, entries in TABLES, definitions in BLOCKS, records elsewhere.
    readonly items: number
}

export interface TableCount {
    readonly name: string
    readonly line: number
    readonly entries: number
}

export interface UnsupportedContent {
    readonly kind: Exclude<UnsupportedKind, 'attribute'>
    readonly name: string
    readonly line: number
    readonly handle?: string
}

export interface UnsupportedAttribute {
    readonly kind: Extract<UnsupportedKind, 'attribute'>
    readonly record: string
    readonly code: number
    readonly value: DxfToken['value']
    readonly line: number
    readonly handle?: string
}

export type UnsupportedItem = UnsupportedContent | UnsupportedAttribute

export interface DxfInventory {
    readonly sections: readonly SectionCount[]
    // Record types in order of first appearance; block contents are not counted.
    readonly entities: readonly TypeCount[]
    readonly objects: readonly TypeCount[]
    readonly tables: readonly TableCount[]
    readonly unsupported: readonly UnsupportedItem[]
}

export type InventoriedDxf =
    | {
          readonly kind: Extract<InventoryOutcome, 'inventory'>
          readonly inventory: DxfInventory
      }
    | {
          readonly kind: Extract<InventoryOutcome, 'error'>
          readonly line: number
          readonly message: string
      }

type InventoryError = Extract<InventoriedDxf, { kind: 'error' }>

interface DxfRecord {
    readonly type: string
    readonly line: number
    // Groups after the record's 0 group, without comments.
    readonly tokens: readonly DxfToken[]
}

interface RecordProfile {
    readonly codes: ReadonlySet<number>
    readonly defaults: ReadonlyMap<number, number>
}

interface Tally {
    readonly sections: { readonly name: string; line: number; items: number }[]
    readonly entities: Map<string, number>
    readonly objects: Map<string, number>
    readonly tables: { readonly name: string; line: number; entries: number }[]
    readonly unsupported: UnsupportedItem[]
}

type OpenSection = Tally['sections'][number]

interface OpenBlock {
    readonly item: UnsupportedContent
    listed: boolean
}

type Scope =
    | { readonly kind: Extract<ScopeKind, 'top'>; readonly tally: Tally }
    | {
          readonly kind: Extract<ScopeKind, 'section'>
          readonly tally: Tally
          readonly section: OpenSection
      }
    | {
          readonly kind: Extract<ScopeKind, 'table'>
          readonly tally: Tally
          readonly section: OpenSection
          readonly table: Tally['tables'][number]
      }
    | {
          readonly kind: Extract<ScopeKind, 'block'>
          readonly tally: Tally
          readonly section: OpenSection
          readonly block: OpenBlock
      }

type TopScope = Extract<Scope, { kind: 'top' }>
type SectionScope = Extract<Scope, { kind: 'section' }>
type TableScope = Extract<Scope, { kind: 'table' }>
type BlockScope = Extract<Scope, { kind: 'block' }>
type Step = Scope | InventoryError

const COMMENT = 999
const APP_GROUP = 102
const XDATA_APP = 1001
const FIRST_XDATA_CODE = 1000
const STANDARD_SECTIONS: ReadonlySet<string> = new Set([
    'HEADER',
    'CLASSES',
    'TABLES',
    'BLOCKS',
    'ENTITIES',
    'OBJECTS',
])
// R2000 keeps model and paper space entities in ENTITIES, so these definitions stay empty.
const LAYOUT_BLOCK = /^\*(?:model_space|paper_space\d*)$/i
// Block flags for an external reference and an overlay.
const XREF_FLAGS = 4 | 8
const EXTRUSION = [210, 220, 230]
// Groups the entity readers interpret; any other group is outside the profile.
const ENTITY_CODES = [5, 6, 8, 62, 100, 330, 370, ...EXTRUSION]
// Default thickness, linetype scale, visibility and model space lose nothing.
const ENTITY_DEFAULTS: ReadonlyMap<number, number> = new Map([
    [39, 0],
    [48, 1],
    [60, 0],
    [67, 0],
])
const ENTITY_PROFILES: ReadonlyMap<string, RecordProfile> = new Map([
    ['LINE', entityProfile([10, 20, 30, 11, 21, 31])],
    ['CIRCLE', entityProfile([10, 20, 30, 40])],
    ['ARC', entityProfile([10, 20, 30, 40, 50, 51])],
    ['LWPOLYLINE', entityProfile([90, 70, 43, 38, 10, 20, 40, 41, 42])],
])
// R2000 layers always carry a plot style handle (390); a layer left unplotted (290 = 0) does not fit.
const LAYER_PROFILE: RecordProfile = {
    codes: new Set([5, 2, 6, 62, 70, 100, 330, 370, 390]),
    defaults: new Map([[290, 1]]),
}
const SECTION_READERS: ReadonlyMap<
    string,
    (scope: SectionScope, record: DxfRecord) => Step
> = new Map([
    ['HEADER', rejectHeaderRecord],
    ['TABLES', openTable],
    ['BLOCKS', openBlock],
    ['ENTITIES', readEntity],
    ['OBJECTS', readObject],
])

function entityProfile(codes: readonly number[]): RecordProfile {
    return {
        codes: new Set([...ENTITY_CODES, ...codes]),
        defaults: ENTITY_DEFAULTS,
    }
}

function inventoryError(line: number, message: string): InventoryError {
    return { kind: 'error', line, message }
}

function* records(tokens: readonly DxfToken[]): Generator<DxfRecord> {
    let record: DxfRecord | undefined
    let groups: DxfToken[] = []

    for (const token of tokens) {
        if (token.code === 0) {
            if (record !== undefined) {
                yield record
            }

            groups = []
            record = {
                type: String(token.value),
                line: token.line,
                tokens: groups,
            }
        } else if (token.code !== COMMENT) {
            groups.push(token)
        }
    }

    if (record !== undefined) {
        yield record
    }
}

function valueOf(
    record: DxfRecord,
    code: number,
): DxfToken['value'] | undefined {
    return record.tokens.find((token) => token.code === code)?.value
}

function handleOf(record: DxfRecord): { handle?: string } {
    const handle = valueOf(record, 5)

    return typeof handle === 'string' ? { handle } : {}
}

function nameOf(record: DxfRecord): string | undefined {
    const name = valueOf(record, 2)

    return typeof name === 'string' ? name : undefined
}

function addCount(counts: Map<string, number>, name: string): void {
    counts.set(name, (counts.get(name) ?? 0) + 1)
}

// Yields groups outside application groups (102) and XDATA, plus the groups that open them.
function* attributeTokens(tokens: readonly DxfToken[]): Generator<DxfToken> {
    let inAppGroup = false
    let inXdata = false

    for (const token of tokens) {
        if (inAppGroup) {
            inAppGroup = token.code !== APP_GROUP || token.value !== '}'
            continue
        }

        const isXdataApp = token.code === XDATA_APP

        inAppGroup =
            token.code === APP_GROUP && String(token.value).startsWith('{')
        inXdata ||= isXdataApp

        const isXdataValue =
            inXdata && !isXdataApp && token.code >= FIRST_XDATA_CODE

        if (!isXdataValue) {
            yield token
        }
    }
}

function inProfile(profile: RecordProfile, token: DxfToken): boolean {
    return (
        profile.codes.has(token.code) ||
        profile.defaults.get(token.code) === token.value
    )
}

function unsupportedAttributes(
    record: DxfRecord,
    profile: RecordProfile,
): UnsupportedAttribute[] {
    const handle = handleOf(record)

    return Array.from(attributeTokens(record.tokens))
        .filter((token) => !inProfile(profile, token))
        .map((token) => ({
            kind: 'attribute',
            record: record.type,
            code: token.code,
            value: token.value,
            line: token.line,
            ...handle,
        }))
}

function closingError(
    scope: Exclude<Scope, TopScope>,
    line: number,
): InventoryError {
    switch (scope.kind) {
        case 'section':
            return inventoryError(
                line,
                `Section ${quoted(scope.section.name)} ends without 0/ENDSEC.`,
            )
        case 'table':
            return inventoryError(
                line,
                `Table ${quoted(scope.table.name)} ends without 0/ENDTAB.`,
            )
        case 'block':
            return inventoryError(
                line,
                `Block ${quoted(scope.block.item.name)} ends without 0/ENDBLK.`,
            )
    }
}

function unexpectedRecord(record: DxfRecord, expected: string): InventoryError {
    return inventoryError(
        record.line,
        `Expected ${expected}, found record ${quoted(record.type)}.`,
    )
}

function openSection(scope: TopScope, record: DxfRecord): Step {
    const [name] = record.tokens

    if (record.type !== 'SECTION') {
        return unexpectedRecord(record, '0/SECTION')
    }

    if (name?.code !== 2) {
        return inventoryError(record.line, '0/SECTION has no 2/name group.')
    }

    const section = {
        name: String(name.value),
        line: record.line,
        items: record.tokens.filter((token) => token.code === 9).length,
    }

    scope.tally.sections.push(section)

    if (!STANDARD_SECTIONS.has(section.name)) {
        scope.tally.unsupported.push({
            kind: 'section',
            name: section.name,
            line: record.line,
        })
    }

    return { kind: 'section', tally: scope.tally, section }
}

function rejectHeaderRecord(_scope: SectionScope, record: DxfRecord): Step {
    return unexpectedRecord(record, '0/ENDSEC in HEADER')
}

function openTable(scope: SectionScope, record: DxfRecord): Step {
    if (record.type !== 'TABLE') {
        return unexpectedRecord(record, '0/TABLE or 0/ENDSEC in TABLES')
    }

    const name = nameOf(record)

    if (name === undefined) {
        return inventoryError(record.line, '0/TABLE has no 2/name group.')
    }

    const table = { name, line: record.line, entries: 0 }

    scope.tally.tables.push(table)

    return { kind: 'table', tally: scope.tally, section: scope.section, table }
}

function openBlock(scope: SectionScope, record: DxfRecord): Step {
    if (record.type !== 'BLOCK') {
        return unexpectedRecord(record, '0/BLOCK or 0/ENDSEC in BLOCKS')
    }

    const name = nameOf(record)

    if (name === undefined) {
        return inventoryError(record.line, '0/BLOCK has no 2/name group.')
    }

    const flags = valueOf(record, 70)
    const isXref = typeof flags === 'number' && (flags & XREF_FLAGS) !== 0
    const item: UnsupportedContent = {
        kind: isXref ? 'xref' : 'block',
        name,
        line: record.line,
        ...handleOf(record),
    }
    const listed = !LAYOUT_BLOCK.test(name)

    if (listed) {
        scope.tally.unsupported.push(item)
    }

    scope.section.items += 1

    return {
        kind: 'block',
        tally: scope.tally,
        section: scope.section,
        block: { item, listed },
    }
}

function readEntity(scope: SectionScope, record: DxfRecord): Step {
    const profile = ENTITY_PROFILES.get(record.type)

    scope.section.items += 1
    addCount(scope.tally.entities, record.type)

    if (profile === undefined) {
        scope.tally.unsupported.push({
            kind: 'entity',
            name: record.type,
            line: record.line,
            ...handleOf(record),
        })
    } else {
        scope.tally.unsupported.push(...unsupportedAttributes(record, profile))
    }

    return scope
}

function readObject(scope: SectionScope, record: DxfRecord): Step {
    scope.section.items += 1
    addCount(scope.tally.objects, record.type)

    return scope
}

function readRecord(scope: SectionScope): Step {
    scope.section.items += 1

    return scope
}

function stepSection(scope: SectionScope, record: DxfRecord): Step {
    if (record.type === 'ENDSEC') {
        return { kind: 'top', tally: scope.tally }
    }

    if (record.type === 'SECTION') {
        return closingError(scope, record.line)
    }

    const read = SECTION_READERS.get(scope.section.name) ?? readRecord

    return read(scope, record)
}

function stepTable(scope: TableScope, record: DxfRecord): Step {
    const { table } = scope

    if (record.type === 'ENDTAB') {
        return { kind: 'section', tally: scope.tally, section: scope.section }
    }

    if (['TABLE', 'ENDSEC', 'SECTION'].includes(record.type)) {
        return closingError(scope, record.line)
    }

    if (record.type !== table.name) {
        return unexpectedRecord(record, `${quoted(table.name)} entries`)
    }

    table.entries += 1
    scope.section.items += 1

    if (table.name === 'LAYER') {
        scope.tally.unsupported.push(
            ...unsupportedAttributes(record, LAYER_PROFILE),
        )
    }

    return scope
}

function stepBlock(scope: BlockScope, record: DxfRecord): Step {
    const { block } = scope

    if (record.type === 'ENDBLK') {
        return { kind: 'section', tally: scope.tally, section: scope.section }
    }

    if (['BLOCK', 'ENDSEC', 'SECTION'].includes(record.type)) {
        return closingError(scope, record.line)
    }

    if (!block.listed) {
        scope.tally.unsupported.push(block.item)
        block.listed = true
    }

    return scope
}

function step(scope: Scope, record: DxfRecord): Step {
    switch (scope.kind) {
        case 'top':
            return openSection(scope, record)
        case 'section':
            return stepSection(scope, record)
        case 'table':
            return stepTable(scope, record)
        case 'block':
            return stepBlock(scope, record)
    }
}

function finish(scope: Scope, line: number): InventoriedDxf {
    if (scope.kind !== 'top') {
        return closingError(scope, line)
    }

    const { tally } = scope
    const counts = (map: Map<string, number>) =>
        Array.from(map, ([name, count]) => ({ name, count }))

    return {
        kind: 'inventory',
        inventory: {
            sections: tally.sections,
            entities: counts(tally.entities),
            objects: counts(tally.objects),
            tables: tally.tables,
            unsupported: tally.unsupported,
        },
    }
}

// Counts records and lists content outside the supported profile, independently of the entity readers.
export function inventoryDxf(tokens: readonly DxfToken[]): InventoriedDxf {
    const first = tokens.find((token) => token.code !== COMMENT)
    let scope: Scope = {
        kind: 'top',
        tally: {
            sections: [],
            entities: new Map(),
            objects: new Map(),
            tables: [],
            unsupported: [],
        },
    }

    if (first !== undefined && first.code !== 0) {
        return inventoryError(
            first.line,
            `Expected 0/SECTION, found group code ${first.code}.`,
        )
    }

    for (const record of records(tokens)) {
        if (record.type === 'EOF') {
            return finish(scope, record.line)
        }

        const next = step(scope, record)

        if (next.kind === 'error') {
            return next
        }

        scope = next
    }

    // Token lists from tokenizeDxf always end with 0/EOF.
    return finish(scope, tokens.at(-1)?.line ?? 1)
}
