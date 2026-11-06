// Hundredths of a millimeter, in ascending display order.
export const LINEWEIGHT_VALUES = [
    0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106,
    120, 140, 158, 200, 211,
] as const
export const LINEWEIGHT_MODES = ['by-layer', 'by-block', 'default'] as const
export const LINETYPES = ['by-layer', 'by-block', 'continuous'] as const

export type LineweightValue = (typeof LINEWEIGHT_VALUES)[number]
export type LineweightMode = (typeof LINEWEIGHT_MODES)[number]
export type EntityLineweight = LineweightValue | LineweightMode
export type LayerLineweight =
    LineweightValue | Extract<LineweightMode, 'default'>
export type Linetype = (typeof LINETYPES)[number]

declare const aciBrand: unique symbol

export type AciColor = number & { readonly [aciBrand]: true }
export type EntityColor = AciColor | 'by-layer'

const lineweightValues: ReadonlySet<unknown> = new Set(LINEWEIGHT_VALUES)
const lineweightModes: ReadonlySet<unknown> = new Set(LINEWEIGHT_MODES)
const linetypes: ReadonlySet<unknown> = new Set(LINETYPES)
// Reserved CAD symbols, line breaks and invalid Unicode cannot round-trip.
const unwritableLayerName = /[<>/\\":;?*|,=`\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u
const blankLayerName = /^[\s\p{Cf}]*$/u

export function isLayerName(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= 255 &&
        !unwritableLayerName.test(value) &&
        !blankLayerName.test(value)
    )
}

export function isAciColor(value: unknown): value is AciColor {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return false
    }

    return value >= 1 && value <= 255
}

export function createAciColor(index: number): AciColor {
    if (!isAciColor(index)) {
        throw new RangeError('ACI color must be an integer from 1 to 255.')
    }

    return index
}

export function isEntityColor(value: unknown): value is EntityColor {
    return value === 'by-layer' || isAciColor(value)
}

export function isLineweightValue(value: unknown): value is LineweightValue {
    return lineweightValues.has(value)
}

export function isEntityLineweight(value: unknown): value is EntityLineweight {
    return isLineweightValue(value) || lineweightModes.has(value)
}

export function isLayerLineweight(value: unknown): value is LayerLineweight {
    return value === 'default' || isLineweightValue(value)
}

export function isLinetype(value: unknown): value is Linetype {
    return linetypes.has(value)
}
