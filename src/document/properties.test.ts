import { describe, expect, it } from 'vitest'
import {
    createAciColor,
    isAciColor,
    isEntityColor,
    isEntityLineweight,
    isLayerLineweight,
    isLineweightValue,
    isLinetype,
    LINEWEIGHT_VALUES,
} from './properties'
import { DRAWING_UNITS, isDrawingUnits } from './units'

describe('drawing properties', () => {
    it('preserves explicit unitless and named drawing units', () => {
        expect(DRAWING_UNITS).toEqual([
            'unitless',
            'inches',
            'feet',
            'miles',
            'millimeters',
            'centimeters',
            'meters',
            'kilometers',
            'microinches',
            'mils',
            'yards',
            'angstroms',
            'nanometers',
            'microns',
            'decimeters',
            'decameters',
            'hectometers',
            'gigameters',
            'astronomical-units',
            'light-years',
            'parsecs',
        ])
        expect(DRAWING_UNITS.every(isDrawingUnits)).toBe(true)

        for (const value of [
            undefined,
            null,
            0,
            'mm',
            'unknown',
            'us-survey-feet',
        ]) {
            expect(isDrawingUnits(value)).toBe(false)
        }
    })

    it('distinguishes explicit ACI indices from BYLAYER and unsupported color modes', () => {
        expect(createAciColor(1)).toBe(1)
        expect(createAciColor(255)).toBe(255)
        expect(isEntityColor('by-layer')).toBe(true)
        expect(isEntityColor('by-block')).toBe(false)

        for (const value of [0, 256, -7, 1.5, NaN, Infinity]) {
            expect(isAciColor(value)).toBe(false)
            expect(() => createAciColor(value)).toThrow(RangeError)
        }
    })

    it('uses hundredths of a millimeter and retains inheritance modes separately', () => {
        expect(LINEWEIGHT_VALUES).toEqual([
            0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90,
            100, 106, 120, 140, 158, 200, 211,
        ])

        for (const value of LINEWEIGHT_VALUES) {
            expect(isLineweightValue(value)).toBe(true)
            expect(isEntityLineweight(value)).toBe(true)
            expect(isLayerLineweight(value)).toBe(true)
        }

        for (const value of ['by-layer', 'by-block', 'default']) {
            expect(isEntityLineweight(value)).toBe(true)
            expect(isLineweightValue(value)).toBe(false)
        }

        expect(isLayerLineweight('by-layer')).toBe(false)
        expect(isLayerLineweight('by-block')).toBe(false)
        expect(isLayerLineweight('default')).toBe(true)

        for (const value of [-1, -2, -3, 14, 212, 0.25, NaN, Infinity, '25']) {
            expect(isEntityLineweight(value)).toBe(false)
        }
    })

    it('limits linetypes to the qualified continuous and inheritance choices', () => {
        expect(['continuous', 'by-layer', 'by-block'].every(isLinetype)).toBe(
            true,
        )
        expect(isLinetype('dashed')).toBe(false)
        expect(isLinetype(null)).toBe(false)
    })
})
