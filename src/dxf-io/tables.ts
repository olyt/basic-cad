import { inventoryDxf, records, type DxfRecord } from './inventory'
import { type DxfToken } from './tokenize'

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
            const namesInRecord = record.tokens.filter(({ code }) => code === 2)
            const name = String(namesInRecord[0]?.value)

            if (namesInRecord.length !== 1 || names.has(name)) {
                return tableError(
                    record.line,
                    'Duplicate table name or table-name group.',
                )
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
