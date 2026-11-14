import { type Linetype } from '../document/properties'
import { type DxfTable, type DxfTableRecord } from './tables'
import { decodeUnicodeEscapes } from './unicode-escape'

export interface DxfLinetype {
    readonly name?: string
    readonly record: DxfTableRecord
    readonly value?: Linetype
    readonly reason?: string
}

const LINETYPE_NAMES: ReadonlyMap<string, Linetype> = new Map([
    ['BYLAYER', 'by-layer'],
    ['BYBLOCK', 'by-block'],
    ['CONTINUOUS', 'continuous'],
])
const REQUIRED_NUMBERS: ReadonlyMap<number, readonly number[]> = new Map([
    [70, [0, 64]],
    [72, [65]],
    [73, [0]],
    [40, [0]],
])
const METADATA_CODES = new Set([5, 3, 100, 330])

function nameOf(record: DxfTableRecord): string | undefined {
    const names = record.tokens.filter(({ code }) => code === 2)
    const value = names[0]?.value

    return names.length === 1 && typeof value === 'string'
        ? decodeUnicodeEscapes(value)
        : undefined
}

function nameKey(name: string): string {
    return name.trim().toLowerCase().toUpperCase()
}

function definitionIssue(record: DxfTableRecord): string | undefined {
    const duplicate = Array.from(METADATA_CODES).find(
        (code) =>
            code !== 100 &&
            record.tokens.filter((token) => token.code === code).length > 1,
    )

    if (duplicate !== undefined) {
        return `Duplicate LTYPE group ${duplicate}.`
    }

    for (const [code, allowed] of REQUIRED_NUMBERS) {
        const values = record.tokens.filter((token) => token.code === code)
        const value = values[0]?.value
        const valid =
            values.length === 1 &&
            typeof value === 'number' &&
            allowed.includes(value)

        if (!valid) {
            return `Group ${code} is missing, repeated or outside the supported zero-pattern definition.`
        }
    }

    const known = (code: number) =>
        code === 2 || REQUIRED_NUMBERS.has(code) || METADATA_CODES.has(code)
    const extra = record.tokens.find(({ code }) => !known(code))

    return extra === undefined
        ? undefined
        : `Unsupported LTYPE group ${extra.code}.`
}

function classify(
    record: DxfTableRecord,
    names: ReadonlyMap<string, number>,
): DxfLinetype {
    const name = nameOf(record)
    const source = { record, ...(name === undefined ? {} : { name }) }

    if (name === undefined) {
        return { ...source, reason: 'LTYPE needs exactly one name group.' }
    }

    if (names.get(nameKey(name)) !== 1) {
        return { ...source, reason: 'Duplicate linetype name.' }
    }

    const value = LINETYPE_NAMES.get(name.toUpperCase())
    const reason =
        definitionIssue(record) ??
        (value === undefined ? 'Unsupported linetype name.' : undefined)

    return reason === undefined ? { ...source, value } : { ...source, reason }
}

// Unsupported definitions are retained; admission depends on whether drawing content uses them.
export function readDxfLinetypes(table: DxfTable): readonly DxfLinetype[] {
    const names = new Map<string, number>()

    for (const record of table.entries) {
        const name = nameOf(record)

        if (name !== undefined) {
            const key = nameKey(name)

            names.set(key, (names.get(key) ?? 0) + 1)
        }
    }

    return table.entries.map((record) => {
        if (table.name !== 'LTYPE' || record.type !== 'LTYPE') {
            return { record, reason: 'Expected an LTYPE table entry.' }
        }

        return classify(record, names)
    })
}
