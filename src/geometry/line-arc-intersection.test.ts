import { describe, expect, it } from 'vitest'
import { FULL_TURN } from './angle'
import { createArc, createLine, type Arc, type ArcInput } from './curve'
import { intersectLineArc } from './line-arc-intersection'
import { type LineOperand } from './line-intersection'

const origin = { x: 0, y: 0 }
const horizontal: LineOperand = {
    line: createLine({ x: -2, y: 0 }, { x: 2, y: 0 }),
    domain: 'segment',
}

function arcWith(input: Partial<ArcInput>): Arc {
    return createArc({
        center: origin,
        radius: 1,
        startAngle: 0,
        sweep: Math.PI,
        ...input,
    })
}

describe('line–arc intersections', () => {
    it.each([
        { startAngle: (3 * Math.PI) / 2, sweep: Math.PI },
        { startAngle: Math.PI / 2, sweep: -Math.PI },
    ])('filters arcs across zero with sweep $sweep', (angles) => {
        expect(
            intersectLineArc(horizontal, {
                arc: arcWith(angles),
                angularTolerance: 0,
            }),
        ).toEqual([{ x: 1, y: 0 }])
    })

    it.each([Math.PI, -Math.PI])(
        'includes both arc endpoints for sweep %s',
        (sweep) => {
            expect(
                intersectLineArc(horizontal, {
                    arc: arcWith({ sweep }),
                    angularTolerance: 0,
                }),
            ).toEqual([
                { x: -1, y: 0 },
                { x: 1, y: 0 },
            ])
        },
    )

    it('handles an empty angular interval and tangent arc hits', () => {
        const quarter = arcWith({ startAngle: Math.PI / 4, sweep: Math.PI / 4 })
        const tangent: LineOperand = {
            line: createLine({ x: -2, y: 1 }, { x: 2, y: 1 }),
            domain: 'infinite',
        }

        expect(
            intersectLineArc(horizontal, { arc: quarter, angularTolerance: 0 }),
        ).toEqual([])
        expect(
            intersectLineArc(tangent, { arc: quarter, angularTolerance: 0 }),
        ).toEqual([{ x: 0, y: 1 }])
        expect(
            intersectLineArc(tangent, {
                arc: arcWith({ sweep: -Math.PI / 2 }),
                angularTolerance: 0,
            }),
        ).toEqual([])
    })

    it('uses the selected line domain and preserves intersection ordering', () => {
        const operand: LineOperand = {
            line: createLine(origin, { x: 0.5, y: 0 }),
            domain: 'segment',
        }
        const input = { arc: arcWith({}), angularTolerance: 0 }

        expect(intersectLineArc(operand, input)).toEqual([])
        expect(
            intersectLineArc({ ...operand, domain: 'infinite' }, input),
        ).toEqual([
            { x: -1, y: 0 },
            { x: 1, y: 0 },
        ])
        expect(
            intersectLineArc(
                {
                    ...horizontal,
                    line: createLine(
                        horizontal.line.end,
                        horizontal.line.start,
                    ),
                },
                input,
            ),
        ).toEqual([
            { x: 1, y: 0 },
            { x: -1, y: 0 },
        ])
    })

    it.each([-1, 1])(
        'retains the near-full excluded gap for direction %s',
        (sign) => {
            const y = -sign * Number.MIN_VALUE
            const operand: LineOperand = {
                line: createLine({ x: -2, y }, { x: 2, y }),
                domain: 'infinite',
            }
            const arc = arcWith({ sweep: sign * (FULL_TURN - 2 ** -50) })

            expect(
                intersectLineArc(operand, { arc, angularTolerance: 0 }),
            ).toEqual([{ x: -1, y }])
            expect(
                intersectLineArc(operand, {
                    arc,
                    angularTolerance: Number.MIN_VALUE,
                }),
            ).toHaveLength(2)
        },
    )

    it('expands only by the explicitly supplied angular tolerance', () => {
        const y = -1e-10
        const operand: LineOperand = {
            line: createLine({ x: 0, y }, { x: 2, y }),
            domain: 'segment',
        }
        const arc = arcWith({ sweep: Math.PI / 2 })

        expect(intersectLineArc(operand, { arc, angularTolerance: 0 })).toEqual(
            [],
        )
        expect(
            intersectLineArc(operand, { arc, angularTolerance: 1e-11 }),
        ).toEqual([])
        expect(
            intersectLineArc(operand, { arc, angularTolerance: 1e-9 }),
        ).toEqual([{ x: 1, y }])
    })

    it('filters by local directions when different roots round to the center', () => {
        const center = { x: 1e15, y: 1e15 }
        const operand: LineOperand = {
            line: createLine({ x: center.x - 1, y: center.y }, center),
            domain: 'infinite',
        }
        const arc = arcWith({
            center,
            radius: Number.MIN_VALUE,
            startAngle: -Math.PI / 4,
            sweep: Math.PI / 2,
        })

        expect(intersectLineArc(operand, { arc, angularTolerance: 0 })).toEqual(
            [center],
        )
        expect(
            intersectLineArc(operand, {
                arc: arcWith({ center, radius: Number.MIN_VALUE }),
                angularTolerance: 0,
            }),
        ).toEqual([center, center])
    })

    it('keeps noncardinal endpoint rays within an explicit rounding allowance', () => {
        const angle = 0.3
        const operand: LineOperand = {
            line: createLine(origin, {
                x: Math.cos(angle),
                y: Math.sin(angle),
            }),
            domain: 'infinite',
        }
        const arc = arcWith({ startAngle: angle, sweep: Math.PI / 3 })
        const hits = intersectLineArc(operand, { arc, angularTolerance: 1e-14 })

        expect(hits).toHaveLength(1)
        expect(hits[0]?.x).toBeCloseTo(Math.cos(angle), 14)
        expect(hits[0]?.y).toBeCloseTo(Math.sin(angle), 14)
    })

    it('matches an independent angular oracle on seeded signed sweeps', () => {
        let state = 20261030

        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0

            return state / 2 ** 32
        }

        for (let index = 0; index < 180; index++) {
            const angle = random() * FULL_TURN
            const startAngle = random() * FULL_TURN
            const sign = index % 2 === 0 ? 1 : -1
            const sweep = sign * (0.01 + random() * (FULL_TURN - 0.02))
            const center = { x: index % 3 === 0 ? 1e6 : 0, y: -17 }
            const direction = { x: Math.cos(angle), y: Math.sin(angle) }
            const operand: LineOperand = {
                line: createLine(center, {
                    x: center.x + direction.x,
                    y: center.y + direction.y,
                }),
                domain: 'infinite',
            }
            const arc = arcWith({ center, radius: 4, startAngle, sweep })
            const expected = [-1, 1].filter((side) => {
                const candidate = angle + (side < 0 ? Math.PI : 0)
                const rawTravel = sign * (candidate - startAngle)
                const travel = ((rawTravel % FULL_TURN) + FULL_TURN) % FULL_TURN

                return travel <= Math.abs(sweep)
            })
            const hits = intersectLineArc(operand, { arc, angularTolerance: 0 })

            expect(hits).toHaveLength(expected.length)

            for (const [hitIndex, side] of expected.entries()) {
                expect(hits[hitIndex]?.x).toBeCloseTo(
                    center.x + side * 4 * direction.x,
                    8,
                )
                expect(hits[hitIndex]?.y).toBeCloseTo(
                    center.y + side * 4 * direction.y,
                    8,
                )
            }
        }
    })

    it.each([-1, NaN, Infinity])(
        'rejects angular tolerance %s even when the circle misses',
        (angularTolerance) => {
            const operand: LineOperand = {
                line: createLine({ x: 3, y: 3 }, { x: 4, y: 3 }),
                domain: 'segment',
            }

            expect(() =>
                intersectLineArc(operand, {
                    arc: arcWith({}),
                    angularTolerance,
                }),
            ).toThrow(RangeError)
        },
    )

    it('rejects invalid raw arcs and line domains', () => {
        const invalid = { ...arcWith({}), sweep: 0 }

        expect(() =>
            intersectLineArc(horizontal, { arc: invalid, angularTolerance: 0 }),
        ).toThrow(RangeError)
        expect(() =>
            intersectLineArc(horizontal, {
                arc: { ...invalid, sweep: FULL_TURN },
                angularTolerance: 0,
            }),
        ).toThrow(RangeError)
        expect(() =>
            intersectLineArc(
                { ...horizontal, domain: 'ray' as LineOperand['domain'] },
                { arc: arcWith({}), angularTolerance: 0 },
            ),
        ).toThrow(RangeError)
    })
})
