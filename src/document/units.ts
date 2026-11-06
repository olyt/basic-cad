// Order matches $INSUNITS codes 0–20.
export const DRAWING_UNITS = [
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
] as const

export type DrawingUnits = (typeof DRAWING_UNITS)[number]

const drawingUnits: ReadonlySet<unknown> = new Set(DRAWING_UNITS)

export function isDrawingUnits(value: unknown): value is DrawingUnits {
    return drawingUnits.has(value)
}
