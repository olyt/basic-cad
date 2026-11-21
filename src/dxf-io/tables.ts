import {
    attributeGroups,
    inventoryDxf,
    records,
    type DxfRecord,
} from './inventory'
import { quoted, type DxfToken } from './tokenize'

export type TablesOutcome = 'tables' | 'error'

export type DxfTableRecord = DxfRecord

export interface DxfTable extends DxfTableRecord {
    readonly name: string
    readonly entries: readonly DxfTableRecord[]
}

export type ReadDxfTables =
    | {
          readonly kind: Extract<TablesOutcome, 'tables'>
          readonly tables: readonly DxfTable[]
      }
    | {
          readonly kind: Extract<TablesOutcome, 'error'>
          readonly line: number
          readonly message: string
      }

type TableError = Extract<ReadDxfTables, { kind: 'error' }>

function tableError(line: number, message: string): TableError {
    return { kind: 'error', line, message }
}

function tableSection(
    tokens: readonly DxfToken[],
): readonly DxfTableRecord[] | TableError {
    const selected: DxfTableRecord[] = []
    let inside = false
    let seen = false

    for (const record of records(tokens)) {
        if (record.type === 'SECTION') {
            inside = record.tokens[0]?.value === 'TABLES'

            if (inside && seen) {
                return tableError(record.line, 'Duplicate TABLES section.')
            }

            seen ||= inside
        } else if (record.type === 'ENDSEC') {
            inside = false
        } else if (inside) {
            selected.push(record)
        }
    }

    return selected
}

function tableName(
    record: DxfTableRecord,
    names: ReadonlySet<string>,
): string | TableError {
    const groups = attributeGroups(record.tokens, [2]).get(2)!
    const name = String(groups[0]?.value)

    if (groups.length !== 1) {
        return tableError(
            record.line,
            '0/TABLE needs exactly one 2/name group.',
        )
    }

    return names.has(name)
        ? tableError(record.line, `Duplicate table ${quoted(name)}.`)
        : name
}

// Raw records remain intact; group 70 is a capacity hint, not an entry count.
export function readDxfTables(tokens: readonly DxfToken[]): ReadDxfTables {
    const inventory = inventoryDxf(tokens)

    if (inventory.kind === 'error') {
        return inventory
    }

    const section = tableSection(tokens)

    if ('kind' in section) {
        return section
    }

    const tables: DxfTable[] = []
    const names = new Set<string>()
    let entries: DxfTableRecord[] = []

    for (const record of section) {
        if (record.type === 'TABLE') {
            const name = tableName(record, names)

            if (typeof name !== 'string') {
                return name
            }

            names.add(name)
            entries = []
            tables.push({ ...record, name, entries })
        } else if (record.type !== 'ENDTAB') {
            entries.push(record)
        }
    }

    return { kind: 'tables', tables }
}
