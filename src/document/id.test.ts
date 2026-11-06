import { describe, expect, expectTypeOf, it } from 'vitest'
import {
    allocateId,
    createIdState,
    parseId,
    type DocumentId,
    type EntityId,
    type IdKind,
    type LayerId,
    type SourceId,
} from './id'

describe('stable application IDs', () => {
    it('allocates different kinds from an explicit monotonic state without mutating it', () => {
        const initial = Object.freeze(createIdState('drawing-a', 0))
        const document = allocateId('document', initial)
        const layer = allocateId('layer', document.nextState)
        const entity = allocateId('entity', layer.nextState)
        const source = allocateId('source', entity.nextState)

        expect([document.id, layer.id, entity.id, source.id]).toEqual([
            'document:drawing-a:0',
            'layer:drawing-a:1',
            'entity:drawing-a:2',
            'source:drawing-a:3',
        ])
        expect(source.nextState.nextSequence).toBe(4)
        expect(initial.nextSequence).toBe(0)
        expectTypeOf(document.id).toEqualTypeOf<DocumentId>()
        expectTypeOf(entity.id).toEqualTypeOf<EntityId>()
        expectTypeOf(layer.id).toEqualTypeOf<LayerId>()
        expectTypeOf(source.id).toEqualTypeOf<SourceId>()
        expectTypeOf<EntityId>().not.toEqualTypeOf<LayerId>()
    })

    it('resumes a JSON checkpoint and preserves existing IDs verbatim', () => {
        const first = allocateId('entity', createIdState('drawing-a', 35))
        const restored = JSON.parse(JSON.stringify(first.nextState))
        const second = allocateId(
            'entity',
            createIdState(restored.namespace, restored.nextSequence),
        )

        expect(first.id).toBe('entity:drawing-a:z')
        expect(second.id).toBe('entity:drawing-a:10')
        expect(parseId('entity', first.id)).toBe(first.id)
        expect(
            allocateId('entity', createIdState('drawing-b', 35)).id,
        ).not.toBe(first.id)
    })

    it('stops before the safe integer counter can wrap or repeat', () => {
        const last = allocateId(
            'entity',
            createIdState('drawing-a', Number.MAX_SAFE_INTEGER - 1),
        )

        expect(parseId('entity', last.id)).toBe(last.id)
        expect(last.nextState.nextSequence).toBe(Number.MAX_SAFE_INTEGER)
        expect(() => allocateId('entity', last.nextState)).toThrow('exhausted')
    })

    it('rejects a missing checkpoint counter instead of restarting allocation', () => {
        const malformed = JSON.parse('{"namespace":"drawing-a"}')

        expect(() =>
            createIdState(malformed.namespace, malformed.nextSequence),
        ).toThrow('safe integer')
        expect(() => allocateId('entity', malformed)).toThrow('safe integer')
    })

    it('rejects an exhausted-state sequence as an allocated ID', () => {
        const sequence = Number.MAX_SAFE_INTEGER.toString(36)

        expect(() => parseId('entity', `entity:drawing-a:${sequence}`)).toThrow(
            'allocation range',
        )
    })

    it.each(['unknown', 'ENTITY', '', null, 42, undefined])(
        'rejects an untyped runtime kind %j',
        (value) => {
            const kind = value as IdKind

            expect(() => parseId(kind, `${String(value)}:drawing-a:0`)).toThrow(
                RangeError,
            )
            expect(() =>
                allocateId(kind, createIdState('drawing-a', 0)),
            ).toThrow(RangeError)
        },
    )

    it.each(['', 'has space', 'a:b', '../drawing', 'drawing\n'])(
        'rejects namespace %j',
        (namespace) => {
            expect(() => createIdState(namespace, 0)).toThrow(RangeError)
        },
    )

    it.each([
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        undefined,
        null,
    ])('rejects sequence %s', (nextSequence) => {
        expect(() =>
            createIdState('drawing-a', nextSequence as number),
        ).toThrow(RangeError)
    })

    it.each([
        'AA',
        'layer:drawing-a:0',
        'entity::0',
        'entity:drawing-a:00',
        'entity:drawing-a:Z',
        'entity:drawing-a:1.5',
        'entity:drawing-a:-1',
        'entity:drawing-a:0:extra',
    ])('rejects malformed or wrong-kind ID %j', (value) => {
        expect(() => parseId('entity', value)).toThrow(RangeError)
    })
})
