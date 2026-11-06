import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from './document'
import { allocateId, createIdState } from './id'
import { DRAWING_UNITS, type DrawingUnits } from './units'

const modelTolerance = { distance: 1e-7 }

describe('empty drawing construction', () => {
    it('creates a versioned millimeter document with layer 0 and BYLAYER defaults', () => {
        const state = Object.freeze(createIdState('new-drawing', 0))
        const { document, nextIdState } = createEmptyDocument(state, {
            modelTolerance,
        })

        expect(document).toMatchObject({
            schemaVersion: 1,
            revision: 0,
            units: 'millimeters',
            defaultLineweight: 25,
            entities: [],
            sources: [],
        })
        expect(document.layers).toEqual([
            {
                id: document.defaults.layerId,
                name: '0',
                color: 7,
                visible: true,
                frozen: false,
                locked: false,
                lineweight: 'default',
                linetype: 'continuous',
            },
        ])
        expect(document.defaults).toEqual({
            layerId: document.layers[0]!.id,
            color: 'by-layer',
            lineweight: 'by-layer',
            linetype: 'by-layer',
        })
        expect(document.id).toBe('document:new-drawing:0')
        expect(document.layers[0]!.id).toBe('layer:new-drawing:1')
        expect(allocateId('entity', nextIdState).id).toBe(
            'entity:new-drawing:2',
        )
        expect(state.nextSequence).toBe(0)
    })

    it.each(DRAWING_UNITS)(
        'retains requested units %s without substituting millimeters',
        (units) => {
            expect(
                createEmptyDocument(createIdState('drawing', 0), {
                    modelTolerance,
                    units,
                }).document.units,
            ).toBe(units)
        },
    )

    it('copies model tolerance and creates independent arrays for separate drawings', () => {
        const tolerance = { distance: 1e-7 }
        const first = createEmptyDocument(createIdState('drawing-a', 0), {
            modelTolerance: tolerance,
        })
        const second = createEmptyDocument(first.nextIdState, {
            modelTolerance: tolerance,
        })

        tolerance.distance = 1
        expect(first.document.modelTolerance.distance).toBe(1e-7)
        expect(first.document.entities).not.toBe(second.document.entities)
        expect(first.document.layers).not.toBe(second.document.layers)
        expect(first.document.sources).not.toBe(second.document.sources)
        expect(first.document.id).not.toBe(second.document.id)
        expect(first.document.layers[0]!.id).not.toBe(
            second.document.layers[0]!.id,
        )
    })

    it.each([-1, NaN, Infinity, undefined])(
        'rejects invalid model tolerance %s without consuming IDs',
        (distance) => {
            const state = createIdState('drawing', 0)

            expect(() =>
                createEmptyDocument(state, {
                    modelTolerance: { distance: distance as number },
                }),
            ).toThrow(RangeError)
            expect(state.nextSequence).toBe(0)
        },
    )

    it('rejects unsupported units and exhausted ID state', () => {
        expect(() =>
            createEmptyDocument(createIdState('drawing', 0), {
                modelTolerance,
                units: 'mm' as DrawingUnits,
            }),
        ).toThrow('units')
        expect(() =>
            createEmptyDocument(
                createIdState('drawing', Number.MAX_SAFE_INTEGER - 1),
                { modelTolerance },
            ),
        ).toThrow('exhausted')
    })
})
