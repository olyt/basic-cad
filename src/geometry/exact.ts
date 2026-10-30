export interface QuadraticSurd {
    readonly base: bigint
    readonly coefficient: bigint
    readonly radicand: bigint
    readonly denominator: bigint
}

const coordinateBits = new DataView(new ArrayBuffer(8))

// Every finite double is an integer multiple of 2^-1074.
export function integerCoordinate(value: number): bigint {
    if (!Number.isFinite(value)) {
        throw new RangeError('Exact coordinates must be finite.')
    }

    coordinateBits.setFloat64(0, value)

    const bits = coordinateBits.getBigUint64(0)
    const exponent = Number((bits >> 52n) & 0x7ffn)
    let coefficient = bits & ((1n << 52n) - 1n)

    if (exponent !== 0) {
        coefficient = (coefficient | (1n << 52n)) << BigInt(exponent - 1)
    }

    return bits >> 63n === 0n ? coefficient : -coefficient
}

function assertPositiveDenominator(denominator: bigint): void {
    if (denominator <= 0n) {
        throw new RangeError('Exact denominators must be positive.')
    }
}

function finiteCoordinate(value: number): number {
    if (!Number.isFinite(value)) {
        throw new RangeError(
            'Exact coordinate exceeds the finite number range.',
        )
    }

    return value
}

function roundedQuotient(numerator: bigint, denominator: bigint): number {
    const magnitude = numerator < 0n ? -numerator : numerator
    const integer = magnitude / denominator
    const shift = Math.max(0, integer.toString(2).length - 53)
    const divisor = denominator << BigInt(shift)
    let rounded = magnitude / divisor
    const twiceRemainder = (magnitude % divisor) * 2n
    const roundUp =
        twiceRemainder > divisor ||
        (twiceRemainder === divisor && (rounded & 1n) !== 0n)

    if (roundUp) {
        rounded += 1n
    }

    // Round the exact rational once, including subnormal ties to even.
    const result = Number(rounded) * 2 ** (shift - 1074)

    if (result === 0) {
        return 0
    }

    return numerator < 0n ? -result : result
}

// The rational numerator/denominator is measured in units of 2^-1074.
export function roundedCoordinate(
    numerator: bigint,
    denominator: bigint,
): number {
    assertPositiveDenominator(denominator)

    return finiteCoordinate(roundedQuotient(numerator, denominator))
}

function integerSquareRoot(value: bigint): bigint {
    if (value < 2n) {
        return value
    }

    let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2))
    let next = (estimate + value / estimate) >> 1n

    while (next < estimate) {
        estimate = next
        next = (estimate + value / estimate) >> 1n
    }

    return estimate
}

// Rounds (base + coefficient * sqrt(radicand)) / denominator in units of 2^-1074.
export function roundSurd(input: QuadraticSurd): number {
    const { base, coefficient, radicand, denominator } = input

    assertPositiveDenominator(denominator)

    if (radicand < 0n) {
        throw new RangeError('Exact square roots need a nonnegative radicand.')
    }

    if (coefficient === 0n || radicand === 0n) {
        return roundedCoordinate(base, denominator)
    }

    let precision = 0

    for (;;) {
        const scaled = radicand << BigInt(2 * precision)
        const root = integerSquareRoot(scaled)
        const divisor = denominator << BigInt(precision)
        const numerator = (base << BigInt(precision)) + coefficient * root

        if (root * root === scaled) {
            return roundedCoordinate(numerator, divisor)
        }

        const first = roundedQuotient(numerator, divisor)
        const second = roundedQuotient(numerator + coefficient, divisor)

        if (first === second) {
            return finiteCoordinate(first)
        }

        // Refine until both enclosing rationals round to the same double.
        precision = precision === 0 ? 32 : precision * 2
    }
}
