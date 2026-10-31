export interface QuadraticSurd {
    readonly base: bigint
    readonly coefficient: bigint
    readonly radicand: bigint
    readonly denominator: bigint
}

interface BinaryCoordinate {
    readonly coefficient: bigint
    readonly exponent: number
}

export interface IntegerCoordinates<T extends readonly number[]> {
    readonly exponent: number
    readonly values: { readonly [K in keyof T]: bigint }
}

export interface Rational {
    readonly numerator: bigint
    readonly denominator: bigint
}

const coordinateBits = new DataView(new ArrayBuffer(8))

function trailingZeros(coefficient: bigint): number {
    const low = Number(coefficient & 0xffffffffn)

    if (low !== 0) {
        return 31 - Math.clz32(low & -low)
    }

    const high = Number(coefficient >> 32n)

    return 63 - Math.clz32(high & -high)
}

function binaryCoordinate(value: number): BinaryCoordinate {
    if (!Number.isFinite(value)) {
        throw new RangeError('Exact coordinates must be finite.')
    }

    coordinateBits.setFloat64(0, value)

    const bits = coordinateBits.getBigUint64(0)
    const exponent = Number((bits >> 52n) & 0x7ffn)
    let coefficient = bits & ((1n << 52n) - 1n)

    if (exponent !== 0) {
        coefficient |= 1n << 52n
    }

    if (coefficient === 0n) {
        return { coefficient: 0n, exponent: 0 }
    }

    const zeros = trailingZeros(coefficient)
    const magnitude = coefficient >> BigInt(zeros)

    return {
        coefficient: bits >> 63n === 0n ? magnitude : -magnitude,
        exponent: (exponent === 0 ? -1074 : exponent - 1075) + zeros,
    }
}

// Every finite double is an integer multiple of 2^-1074.
export function integerCoordinate(value: number): bigint {
    const part = binaryCoordinate(value)

    return part.coefficient << BigInt(part.exponent + 1074)
}

export function integerCoordinates<const T extends readonly number[]>(
    values: T,
): IntegerCoordinates<T> {
    const parts = values.map(binaryCoordinate)
    let exponent = Infinity

    for (const part of parts) {
        if (part.coefficient !== 0n) {
            exponent = Math.min(exponent, part.exponent)
        }
    }

    if (exponent === Infinity) {
        exponent = 0
    }

    return {
        exponent,
        values: parts.map(
            (part) => part.coefficient << BigInt(part.exponent - exponent),
        ) as IntegerCoordinates<T>['values'],
    }
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

function assertExponent(exponent: number): void {
    if (!Number.isSafeInteger(exponent)) {
        throw new RangeError('Binary exponent must be a safe integer.')
    }
}

function ratioExponent(numerator: bigint, denominator: bigint): number {
    const difference =
        numerator.toString(2).length - denominator.toString(2).length
    const belowPower =
        difference >= 0
            ? numerator < denominator << BigInt(difference)
            : numerator << BigInt(-difference) < denominator

    return difference - Number(belowPower)
}

function roundedInteger(
    { numerator, denominator }: Rational,
    shift: number,
): bigint {
    const dividend = shift < 0 ? numerator << BigInt(-shift) : numerator
    const divisor = shift > 0 ? denominator << BigInt(shift) : denominator
    let rounded = dividend / divisor
    const twiceRemainder = (dividend % divisor) * 2n
    const roundUp =
        twiceRemainder > divisor ||
        (twiceRemainder === divisor && (rounded & 1n) !== 0n)

    if (roundUp) {
        rounded += 1n
    }

    return rounded
}

function roundedQuotient(
    { numerator, denominator }: Rational,
    exponent: number,
): number {
    if (numerator === 0n) {
        return 0
    }

    const magnitude = numerator < 0n ? -numerator : numerator
    const power = ratioExponent(magnitude, denominator) + exponent

    if (power > 1023) {
        return numerator < 0n ? -Infinity : Infinity
    }

    if (power < -1075) {
        return 0
    }

    // The output grid may be finer than the operands' shared input unit.
    const quantum = Math.max(-1074, power - 52)
    const rounded = roundedInteger(
        { numerator: magnitude, denominator },
        quantum - exponent,
    )
    const result = Number(rounded) * 2 ** quantum

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
    return roundRational({ numerator, denominator }, -1074)
}

export function roundRational(input: Rational, exponent = 0): number {
    assertPositiveDenominator(input.denominator)
    assertExponent(exponent)

    return finiteCoordinate(roundedQuotient(input, exponent))
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

// Rounds (base + coefficient * sqrt(radicand)) / denominator, scaled by 2^exponent.
export function roundSurd(input: QuadraticSurd, exponent = -1074): number {
    const { base, coefficient, radicand, denominator } = input

    assertPositiveDenominator(denominator)
    assertExponent(exponent)

    if (radicand < 0n) {
        throw new RangeError('Exact square roots need a nonnegative radicand.')
    }

    if (coefficient === 0n || radicand === 0n) {
        return finiteCoordinate(
            roundedQuotient({ numerator: base, denominator }, exponent),
        )
    }

    let precision = 0

    for (;;) {
        const scaled = radicand << BigInt(2 * precision)
        const root = integerSquareRoot(scaled)
        const divisor = denominator << BigInt(precision)
        const numerator = (base << BigInt(precision)) + coefficient * root

        if (root * root === scaled) {
            return finiteCoordinate(
                roundedQuotient({ numerator, denominator: divisor }, exponent),
            )
        }

        const first = roundedQuotient(
            { numerator, denominator: divisor },
            exponent,
        )
        const second = roundedQuotient(
            { numerator: numerator + coefficient, denominator: divisor },
            exponent,
        )

        if (first === second) {
            return finiteCoordinate(first)
        }

        // Refine until both enclosing rationals round to the same double.
        precision = precision === 0 ? 32 : precision * 2
    }
}
