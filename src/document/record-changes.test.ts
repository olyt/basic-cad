import { describe, expect, expectTypeOf, it } from 'vitest'
import {
    type ChangeSet,
    type DocumentSettings,
    type RecordChanges,
} from './change-set'
import { type DocumentId, type IdKind, type SourceId } from './id'
import { admitSourceFile } from './record-admission'
import { applyRecordChanges } from './record-changes'
import { type Entity, type Layer, type SourceFile } from './schema'

function source(sequence: string) {
    return Object.freeze(
        admitSourceFile({
            id: `source:batch:${sequence}`,
            format: 'dxf',
            fileName: `${sequence}.dxf`,
            version: 'AC1015',
        }),
    )
}

const current = Object.freeze([source('0'), source('1'), source('2')])
const created = source('3')
const replacement = Object.freeze({
    id: current[0]!.id,
    format: 'dwg',
    fileName: 'Replacement.dwg',
})
const options = { kind: 'source' as const, admit: admitSourceFile }
const operations = ['creates', 'updates', 'deletes'] as const

function apply(changes: unknown) {
    return applyRecordChanges(current, { ...options, changes })
}

describe('atomic record changes', () => {
    it('keeps source IDs, drawing identity and complete settings in the typed contract', () => {
        expectTypeOf<
            RecordChanges<(typeof current)[number]>['deletes']
        >().toEqualTypeOf<readonly SourceId[] | undefined>()
        expectTypeOf<RecordChanges<SourceFile>['creates']>().toEqualTypeOf<
            readonly SourceFile[] | undefined
        >()
        expectTypeOf<RecordChanges<SourceFile>['updates']>().toEqualTypeOf<
            readonly SourceFile[] | undefined
        >()
        expectTypeOf<ChangeSet['entities']>().toEqualTypeOf<
            RecordChanges<Entity> | undefined
        >()
        expectTypeOf<ChangeSet['layers']>().toEqualTypeOf<
            RecordChanges<Layer> | undefined
        >()
        expectTypeOf<ChangeSet['sources']>().toEqualTypeOf<
            RecordChanges<SourceFile> | undefined
        >()
        expectTypeOf<ChangeSet['documentId']>().toEqualTypeOf<DocumentId>()
        expectTypeOf<ChangeSet['baseRevision']>().toBeNumber()
        expectTypeOf<ChangeSet['settings']>().toEqualTypeOf<
            DocumentSettings | undefined
        >()
        expectTypeOf<keyof DocumentSettings>().toEqualTypeOf<
            'units' | 'modelTolerance' | 'defaultLineweight' | 'defaults'
        >()
    })

    it.each([
        undefined,
        {},
        { creates: undefined, updates: undefined, deletes: undefined },
        { creates: [], updates: [], deletes: [] },
    ])('treats omitted and empty lists as no-ops: %j', (changes) => {
        expect(apply(changes)).toEqual({ records: current, changed: false })
    })

    it('replaces in place, deletes, then appends in create-list order without mutating inputs', () => {
        const later = source('4')
        const changes = Object.freeze({
            creates: Object.freeze([later, created]),
            updates: Object.freeze([replacement]),
            deletes: Object.freeze([current[1]!.id]),
        })
        const result = apply(changes)

        expect(result).toEqual({
            records: [replacement, current[2], later, created],
            changed: true,
        })
        expect(result.records[0]).not.toBe(replacement)
        expect(result.records[2]).not.toBe(later)
        expect(result.records[3]).not.toBe(created)
        expect(result.records[0]).not.toHaveProperty('version')
        expect(current.map(({ id }) => id)).toEqual([
            'source:batch:0',
            'source:batch:1',
            'source:batch:2',
        ])
        expect(current[0]!.version).toBe('AC1015')
        expect(changes.updates[0]).toBe(replacement)
    })

    it('counts an admitted identical update as a change', () => {
        expect(apply({ updates: [current[1]] })).toEqual({
            records: current,
            changed: true,
        })
    })

    it('allows a pure delete to remove all records', () => {
        expect(apply({ deletes: current.map(({ id }) => id) })).toEqual({
            records: [],
            changed: true,
        })
    })

    it.each([null, [], 0, false, 'changes'])(
        'rejects an invalid changes group %j',
        (changes) => {
            expect(() => apply(changes)).toThrow(RangeError)
        },
    )

    it.each(operations)(
        'requires a dense %s array when present',
        (operation) => {
            for (const value of [null, {}, 'array', Array<unknown>(1)]) {
                expect(() => apply({ [operation]: value })).toThrow(RangeError)
            }
        },
    )

    it.each([
        { creates: [current[0]] },
        { updates: [created] },
        { deletes: [created.id] },
    ])(
        'checks create/update/delete existence against the original records: %j',
        (changes) => {
            expect(() => apply(changes)).toThrow(RangeError)
        },
    )

    it.each(['creates', 'updates'])(
        'decodes complete records in %s',
        (operation) => {
            const record = operation === 'creates' ? created : current[0]

            expect(() =>
                apply({ [operation]: [{ ...record, fileName: '' }] }),
            ).toThrow(RangeError)
        },
    )

    it.each([
        { creates: [created, created] },
        { updates: [current[0], current[0]] },
        { deletes: [current[0]!.id, current[0]!.id] },
        { creates: [created], updates: [created] },
        { creates: [created], deletes: [created.id] },
        { updates: [current[0]], deletes: [current[0]!.id] },
        { creates: [current[0]], deletes: [current[0]!.id] },
    ])('rejects duplicate or conflicting operations %j', (changes) => {
        expect(() => apply(changes)).toThrow(RangeError)
    })

    it('rejects duplicate original IDs even for an omitted changes group', () => {
        expect(() =>
            applyRecordChanges([current[0]!, current[0]!], {
                ...options,
                changes: undefined,
            }),
        ).toThrow(RangeError)
    })

    it.each(['source:batch:01', 'layer:batch:0'])(
        'rejects non-canonical or wrong-kind current IDs even for an omitted changes group: %s',
        (id) => {
            expect(() =>
                applyRecordChanges([{ ...current[0]!, id: id as SourceId }], {
                    ...options,
                    changes: undefined,
                }),
            ).toThrow(RangeError)
        },
    )

    it.each([
        undefined,
        null,
        0,
        'entity:batch:0',
        'source:batch:01',
        `source:batch:${Number.MAX_SAFE_INTEGER.toString(36)}`,
    ])('validates delete IDs canonically and by kind: %j', (id) => {
        expect(() => apply({ deletes: [id] })).toThrow(RangeError)
    })

    it.each(['entity:batch:0', 'source:batch:01', undefined])(
        'validates admitted result IDs independently of the decoder: %j',
        (id) => {
            expect(() =>
                applyRecordChanges([], {
                    kind: 'source',
                    admit: (value) => value as { readonly id: string },
                    changes: { creates: [{ id }] },
                }),
            ).toThrow(RangeError)
        },
    )

    it.each([undefined, null, 'SOURCE', 'unknown'])(
        'rejects invalid kind %j on an empty no-op',
        (kind) => {
            expect(() =>
                applyRecordChanges([], {
                    ...options,
                    kind: kind as IdKind,
                    changes: undefined,
                }),
            ).toThrow(RangeError)
        },
    )

    it('rejects an invalid late record after valid operations without publishing partial changes', () => {
        const invalid = Object.freeze({ ...source('4'), fileName: '' })
        const changes = Object.freeze({
            creates: Object.freeze([created, invalid]),
            updates: Object.freeze([replacement]),
            deletes: Object.freeze([current[1]!.id]),
        })

        expect(() => apply(changes)).toThrow(RangeError)
        expect(current).toEqual([source('0'), source('1'), source('2')])
        expect(changes.creates).toEqual([created, invalid])
        expect(changes.updates).toEqual([replacement])
        expect(changes.deletes).toEqual([current[1]!.id])
    })

    it.each(['entity', 'layer'] as const)(
        'supports the same generic batch contract for %s IDs',
        (kind) => {
            const record = { id: `${kind}:other:0` }
            const changes = { creates: [record] }

            expect(
                applyRecordChanges([], {
                    kind,
                    admit: (value) => ({ ...(value as typeof record) }),
                    changes,
                }),
            ).toEqual({ records: [record], changed: true })
        },
    )
})
