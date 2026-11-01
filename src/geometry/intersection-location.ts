import { roundRational, type Rational } from './exact'

export type SegmentEndpoint = 'start' | 'end'

export interface ParameterLocation {
    readonly parameter: number
    // Endpoint identity is determined before the parameter is rounded.
    readonly endpoint?: SegmentEndpoint
}

export function rationalLocation(input: Rational): ParameterLocation {
    const parameter = roundRational(input)

    if (input.numerator < 0n || input.numerator > input.denominator) {
        throw new RangeError('Intersection parameter must be within [0, 1].')
    }

    if (input.numerator === 0n) {
        return { parameter, endpoint: 'start' }
    }

    if (input.numerator === input.denominator) {
        return { parameter, endpoint: 'end' }
    }

    return { parameter }
}
