import { describe, expect, it } from 'vitest'
import { polylineSignedArea as fixedArea } from '../test-support/fixed-scale/area'
import { circleIntersections as fixedCircles } from '../test-support/fixed-scale/circle-intersection'
import { lineCircleIntersections as fixedLineCircle } from '../test-support/fixed-scale/line-circle-intersection'
import { intersectLines as fixedLines } from '../test-support/fixed-scale/line-intersection'
import { scalingAreaCases, scalingCases } from '../test-support/scaling-cases'
import { polylineSignedArea } from './area'
import { circleIntersections } from './circle-intersection'
import { lineCircleIntersections } from './line-circle-intersection'
import { intersectLines } from './line-intersection'

function outcome(operation: () => unknown): unknown {
    try {
        return { value: operation() }
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error
        }

        return { error: { name: error.name, message: error.message } }
    }
}

const cases = scalingCases()

describe('operand scaling versus the frozen fixed-scale reference', () => {
    it('preserves line classifications, coordinates and errors bit for bit', () => {
        for (const { firstLine, secondLine } of cases) {
            expect(
                outcome(() => intersectLines(firstLine, secondLine)),
            ).toStrictEqual(outcome(() => fixedLines(firstLine, secondLine)))
        }
    })

    it('preserves line-circle roots, directions, ordering and errors bit for bit', () => {
        for (const { firstLine, first } of cases) {
            expect(
                outcome(() => lineCircleIntersections(firstLine, first)),
            ).toStrictEqual(outcome(() => fixedLineCircle(firstLine, first)))
        }
    })

    it('preserves circle-pair roots, both directions and errors bit for bit', () => {
        for (const { first, second } of cases) {
            expect(
                outcome(() => circleIntersections(first, second)),
            ).toStrictEqual(outcome(() => fixedCircles(first, second)))
        }
    })

    it('preserves exact polygon/curved area and errors bit for bit', () => {
        for (const polyline of scalingAreaCases()) {
            for (const distance of [0, 1e-7, 0.125, -1, NaN]) {
                expect(
                    outcome(() => polylineSignedArea(polyline, { distance })),
                ).toStrictEqual(
                    outcome(() => fixedArea(polyline, { distance })),
                )
            }
        }
    })
})
