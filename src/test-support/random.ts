// Seeded (Mulberry32) so a property-test failure reproduces from its seed.
export interface TestRandom {
    // Uniform in [min, max).
    between(min: number, max: number): number
    // Log-uniform between 10^minExponent and 10^maxExponent.
    magnitude(minExponent: number, maxExponent: number): number
    sign(): 1 | -1
}

export function seededRandom(seed: number): TestRandom {
    let state = seed >>> 0

    function next(): number {
        state = (state + 0x6d2b79f5) >>> 0

        let mixed = Math.imul(state ^ (state >>> 15), state | 1)

        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }

    return {
        between: (min, max) => min + (max - min) * next(),
        magnitude: (minExponent, maxExponent) =>
            10 ** (minExponent + (maxExponent - minExponent) * next()),
        sign: () => (next() < 0.5 ? -1 : 1),
    }
}
