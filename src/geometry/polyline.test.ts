import { describe, expect, it } from 'vitest'
import {
    createArc,
    createCircle,
    createLine,
    type PolylineSegment,
} from './curve'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'

const origin = { x: 0, y: 0 }
const exact = { distance: 0 }
const line = createLine(origin, { x: 1, y: 0 })

describe('ordered polylines', () => {
    it('supports mixed arcs and lines with either closure flag', () => {
        const arc = createArc(origin, 1, 0, Math.PI / 2)
        const { start, end } = segmentEndpoints(arc)
        const segments = [arc, createLine(end, start)]

        for (const closed of [false, true]) {
            const polyline = createPolyline(segments, closed, exact)

            expect(polyline.type).toBe('polyline')
            expect(polyline.closed).toBe(closed)
            expect(polyline.segments).toEqual(segments)
        }
    })

    it('uses inclusive tolerance without snapping or reordering segments', () => {
        const following = createLine({ x: 1.125, y: 0 }, { x: 2, y: 0 })
        const segments = [line, following]
        const polyline = createPolyline(segments, false, { distance: 0.125 })

        expect(polyline.segments).toEqual(segments)
        expect(() => createPolyline(segments, false, exact)).toThrow(RangeError)
        expect(() =>
            createPolyline(segments, false, { distance: 0.124 }),
        ).toThrow(RangeError)
        expect(() =>
            createPolyline([following, line], false, { distance: 0.125 }),
        ).toThrow(RangeError)
    })

    it('checks closing gaps only when the polyline is closed', () => {
        const almostClosed = createLine({ x: 1, y: 0 }, { x: 0.125, y: 0 })
        const segments = [line, almostClosed]

        expect(createPolyline(segments, false, exact).closed).toBe(false)
        expect(createPolyline(segments, true, { distance: 0.125 }).closed).toBe(
            true,
        )
        expect(() => createPolyline(segments, true, exact)).toThrow(RangeError)
        expect(() => createPolyline([line], true, { distance: 1 })).toThrow(
            RangeError,
        )
    })

    it('copies the segment array and nested coordinates', () => {
        const start = { x: 0, y: 0 }
        const end = { x: 1, y: 0 }
        const center = { x: 1, y: 1 }
        const input = { type: 'line' as const, start, end }
        const expectedArc = createArc(center, 1, -Math.PI / 2, Math.PI / 2)
        const arc = { ...expectedArc, center }
        const segments = [input, arc]
        const polyline = createPolyline(segments, false, { distance: 1e-12 })

        expect(polyline.segments).not.toBe(segments)
        expect(polyline.segments[0]).not.toBe(input)

        start.x = 100
        end.y = 100
        center.x = 100
        arc.sweep = -1
        segments.pop()

        expect(polyline.segments).toEqual([line, expectedArc])
    })

    it('rejects empty, circle and invalid segments and nonboolean closure', () => {
        const circle = createCircle(origin, 1) as unknown as PolylineSegment
        const zeroLine = { type: 'line' as const, start: origin, end: origin }
        const invalidArc = { ...createArc(origin, 1, 0, 1), radius: 0 }

        for (const segments of [[], [circle], [zeroLine], [invalidArc]]) {
            expect(() => createPolyline(segments, false, exact)).toThrow(
                RangeError,
            )
        }

        expect(() => createPolyline([circle], false, exact)).toThrow(
            'Polyline segments must be lines or arcs, not circle.',
        )

        expect(() =>
            createPolyline([line], 'true' as unknown as boolean, exact),
        ).toThrow(RangeError)
    })

    it.each([-1, NaN, Infinity, -Infinity])(
        'validates tolerance %s for even one open segment',
        (distance) => {
            expect(() => createPolyline([line], false, { distance })).toThrow(
                RangeError,
            )
        },
    )
})
