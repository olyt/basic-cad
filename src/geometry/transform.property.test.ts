import { describe, expect, it } from 'vitest'
import { seededRandom } from '../test-support/random'
import { FULL_TURN } from './angle'
import { polylineSignedArea } from './area'
import { createArc, createCircle, createLine, type Curve } from './curve'
import { evaluateCurve, type CurveLocation } from './evaluation'
import { curveLength } from './length'
import { createPolyline } from './polyline'
import { segmentEndpoints } from './segment'
import { transformCurve, type CurveTransform } from './transform'
import { type Vector2 } from './vector'

const random = seededRandom(20261106)
const modelTolerance = { distance: 1e-7 }
const parameters = [0, 0.17, 0.67, 1]

function analyticPoint(point: Vector2, transform: CurveTransform): Vector2 {
    if (transform.type === 'move') {
        return {
            x: point.x + transform.offset.x,
            y: point.y + transform.offset.y,
        }
    }

    if (transform.type === 'scale') {
        return {
            x:
                transform.center.x +
                transform.factor * (point.x - transform.center.x),
            y:
                transform.center.y +
                transform.factor * (point.y - transform.center.y),
        }
    }

    if (transform.type === 'rotate') {
        const angle = transform.angle % FULL_TURN
        const x = point.x - transform.center.x
        const y = point.y - transform.center.y

        return {
            x: transform.center.x + x * Math.cos(angle) - y * Math.sin(angle),
            y: transform.center.y + x * Math.sin(angle) + y * Math.cos(angle),
        }
    }

    const { start, end } = transform.axis
    const x = end.x - start.x
    const y = end.y - start.y
    const offsetX = point.x - start.x
    const offsetY = point.y - start.y
    const projection = (offsetX * x + offsetY * y) / (x * x + y * y)

    return {
        x: start.x + 2 * projection * x - offsetX,
        y: start.y + 2 * projection * y - offsetY,
    }
}

function inverse(transform: CurveTransform): CurveTransform {
    switch (transform.type) {
        case 'move':
            return {
                ...transform,
                offset: { x: -transform.offset.x, y: -transform.offset.y },
            }
        case 'rotate':
            return { ...transform, angle: -transform.angle }
        case 'scale':
            return { ...transform, factor: 1 / transform.factor }
        case 'mirror':
            return transform
    }
}

function locations(curve: Curve): readonly CurveLocation[] {
    return curve.type === 'polyline'
        ? curve.segments.flatMap((_, segmentIndex) =>
              parameters.map((parameter) => ({ parameter, segmentIndex })),
          )
        : parameters.map((parameter) => ({ parameter }))
}

function mappedLocation(
    curve: Curve,
    input: {
        readonly location: CurveLocation
        readonly transform: CurveTransform
    },
): CurveLocation {
    if (curve.type !== 'circle') {
        return input.location
    }

    const { transform, location } = input

    if (transform.type === 'rotate') {
        return {
            parameter:
                location.parameter + (transform.angle % FULL_TURN) / FULL_TURN,
        }
    }

    if (transform.type === 'mirror') {
        const { start, end } = transform.axis

        return {
            parameter:
                (2 * Math.atan2(end.y - start.y, end.x - start.x)) / FULL_TURN -
                location.parameter,
        }
    }

    return location
}

function expectPoint(actual: Vector2, expected: Vector2): void {
    expect(
        Math.hypot(actual.x - expected.x, actual.y - expected.y),
    ).toBeLessThan(modelTolerance.distance)
}

const cases = Array.from({ length: 180 }, () => {
    const arc = createArc({
        center: { x: random.between(-1e5, 1e5), y: random.between(-1e5, 1e5) },
        radius: random.magnitude(0, 2),
        startAngle: random.between(0, FULL_TURN),
        sweep: random.sign() * random.between(0.1, FULL_TURN - 0.1),
    })
    const { start, end } = segmentEndpoints(arc)
    const line = createLine(
        { x: start.x - arc.radius, y: start.y - arc.radius },
        start,
    )
    const closed = createPolyline(
        { segments: [arc, createLine(end, start)], closed: true },
        modelTolerance,
    )
    const open = createPolyline(
        {
            segments: [
                line,
                arc,
                createLine(end, { x: end.x + arc.radius, y: end.y }),
            ],
            closed: false,
        },
        modelTolerance,
    )
    const center = {
        x: random.between(-1e5, 1e5),
        y: random.between(-1e5, 1e5),
    }
    const transforms: readonly CurveTransform[] = [
        {
            type: 'move',
            offset: {
                x: random.between(-500, 500),
                y: random.between(-500, 500),
            },
        },
        { type: 'rotate', center, angle: random.between(-10, 10) },
        { type: 'scale', center, factor: random.between(0.25, 4) },
        {
            type: 'mirror',
            axis: createLine(center, {
                x: center.x + random.between(1, 100),
                y: center.y + random.between(-100, 100),
            }),
        },
    ]

    return {
        closed,
        transforms,
        curves: [line, arc, createCircle(arc.center, arc.radius), open, closed],
    }
})

function checkFixture(fixture: (typeof cases)[number]): void {
    for (const transform of fixture.transforms) {
        const factor = transform.type === 'scale' ? transform.factor : 1

        for (const source of fixture.curves) {
            const result = transformCurve(source, { transform, modelTolerance })
            const restored = transformCurve(result, {
                transform: inverse(transform),
                modelTolerance,
            })

            expect(result.type).toBe(source.type)
            expect(
                Math.abs(curveLength(result) - factor * curveLength(source)),
            ).toBeLessThan(modelTolerance.distance)

            for (const location of locations(source)) {
                const original = evaluateCurve(source, location).point

                expectPoint(
                    evaluateCurve(
                        result,
                        mappedLocation(source, { location, transform }),
                    ).point,
                    analyticPoint(original, transform),
                )
                expectPoint(evaluateCurve(restored, location).point, original)
            }
        }
    }
}

describe('seeded geometry transforms', () => {
    it('matches analytic samples and inverse transforms for 180 fixtures of every curve type', () => {
        cases.forEach(checkFixture)
    })

    it('scales signed area by factor squared and reverses it under reflection', () => {
        for (const { closed, transforms } of cases) {
            const original = polylineSignedArea(closed, modelTolerance)

            for (const transform of transforms) {
                const result = transformCurve(closed, {
                    transform,
                    modelTolerance,
                })

                expect(result.type).toBe('polyline')

                const factor =
                    transform.type === 'scale' ? transform.factor ** 2 : 1
                const sign = transform.type === 'mirror' ? -1 : 1
                const actual = polylineSignedArea(
                    result as typeof closed,
                    modelTolerance,
                )
                const budget =
                    8 *
                    modelTolerance.distance *
                    curveLength(closed) *
                    Math.max(1, factor)

                expect(
                    Math.abs(actual - original * factor * sign),
                ).toBeLessThan(budget)
            }
        }
    })
})
