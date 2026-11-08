import { isIdKind, parseId, type IdKind } from './id'
import { readRecord, readText } from './record'

interface RecordChangeOptions<Item> {
    readonly changes: unknown
    readonly kind: IdKind
    readonly admit: (value: unknown) => Item
}

interface RecordBatch<Item> {
    readonly records: Map<string, Item>
    readonly used: Set<string>
    readonly kind: IdKind
    readonly admit: (value: unknown) => Item
}

function readItems(value: unknown): unknown[] {
    if (value === undefined) {
        return []
    }

    if (!Array.isArray(value)) {
        throw new RangeError('Record change lists must be arrays.')
    }

    return Array.from(value)
}

function claimId(used: Set<string>, id: string): void {
    if (used.has(id)) {
        throw new RangeError(
            'Each record ID may have only one operation per batch.',
        )
    }

    used.add(id)
}

function writeRecords<Item extends { readonly id: string }>(
    batch: RecordBatch<Item>,
    request: { readonly items: unknown; readonly create: boolean },
): void {
    for (const value of readItems(request.items)) {
        const record = batch.admit(value)
        const id = parseId(batch.kind, record.id)

        claimId(batch.used, id)

        if (batch.records.has(id) === request.create) {
            throw new RangeError(
                request.create
                    ? 'Cannot create an existing record.'
                    : 'Cannot update a missing record.',
            )
        }

        batch.records.set(id, record)
    }
}

export function applyRecordChanges<Item extends { readonly id: string }>(
    current: readonly Item[],
    options: RecordChangeOptions<Item>,
): {
    readonly records: readonly Item[]
    readonly changed: boolean
    readonly changedIds: ReadonlySet<string>
} {
    const { changes, kind, admit } = options

    if (!isIdKind(kind)) {
        throw new RangeError('Record kind is unsupported.')
    }

    const records = new Map<string, Item>(
        current.map((item) => [parseId(kind, item.id), item]),
    )

    if (records.size !== current.length) {
        throw new RangeError('Current record IDs must be unique.')
    }

    const { creates, updates, deletes } = readRecord(
        changes === undefined ? {} : changes,
    )
    const batch: RecordBatch<Item> = { records, used: new Set(), kind, admit }

    writeRecords(batch, { items: creates, create: true })
    writeRecords(batch, { items: updates, create: false })

    for (const value of readItems(deletes)) {
        const id = parseId(kind, readText(value, 'Deleted record ID'))

        claimId(batch.used, id)

        if (!records.delete(id)) {
            throw new RangeError('Cannot delete a missing record.')
        }
    }

    return {
        records: [...records.values()],
        changed: batch.used.size > 0,
        changedIds: batch.used,
    }
}
