import { cpus, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const calls = Number(process.argv[2] ?? 100)
let checksum = 0

if (!Number.isSafeInteger(calls) || calls < 1) {
    throw new RangeError(
        'Usage: npm run bench:polyline -- [positive queries per sample]',
    )
}

function* allPairs(first, second) {
    for (let firstIndex = 0; firstIndex < first.parts.length; firstIndex++) {
        for (
            let secondIndex = 0;
            secondIndex < second.parts.length;
            secondIndex++
        ) {
            yield { firstIndex, secondIndex }
        }
    }
}

function timeQuery(operation, query) {
    const start = performance.now()

    for (let index = 0; index < calls; index++) {
        const result = operation(query)

        checksum += result.coincident.length

        for (const { point, first, second } of result.hits) {
            checksum += point.x + point.y + first.parameter + second.parameter
        }
    }

    return (performance.now() - start) / calls
}

function median(values) {
    return values.toSorted((first, second) => first - second)[
        Math.floor(values.length / 2)
    ]
}

function measure(query, operations) {
    const samples = operations.map(() => [])

    for (const operation of operations) {
        for (let index = 0; index < 20; index++) {
            operation(query)
        }
    }

    for (let sample = 0; sample < 5; sample++) {
        const order = sample % 2 === 0 ? [0, 1] : [1, 0]

        for (const index of order) {
            samples[index].push(timeQuery(operations[index], query))
        }
    }

    return samples.map(median)
}

const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
})

try {
    const [
        { intersectCurves, collectCurveIntersections },
        { prepareIntersectionCurve },
        { intersectionCandidates },
        { scallopedPath },
    ] = await Promise.all([
        server.ssrLoadModule('/src/geometry/curve-intersection.ts'),
        server.ssrLoadModule('/src/geometry/intersection-curve.ts'),
        server.ssrLoadModule('/src/geometry/intersection-candidates.ts'),
        server.ssrLoadModule('/src/test-support/intersection-paths.ts'),
    ])
    const unculled = (query) => {
        const first = prepareIntersectionCurve(
            query.first,
            query.angularTolerance,
        )
        const second = prepareIntersectionCurve(
            query.second,
            query.angularTolerance,
        )

        return collectCurveIntersections({
            first,
            second,
            candidates: allPairs(first, second),
            modelTolerance: query.modelTolerance,
        })
    }
    const first = scallopedPath(30, { x: 0, y: 0 })
    const cases = [
        {
            name: 'Crossing paths',
            second: scallopedPath(30, { x: 0.5, y: 0.5 }),
        },
        {
            name: 'Separated paths',
            second: scallopedPath(30, { x: 0.5, y: 1000 }),
        },
    ]

    process.stdout.write(
        `${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}\n`,
    )
    process.stdout.write(
        `30 arcs per curve; model tolerance 1e-7; median of five samples, ${calls} queries/sample, 20 warmup queries/implementation.\n\n`,
    )
    process.stdout.write(
        '| Full query | Exact pairs | Hits | All pairs ms | Culled ms | Speedup |\n| --- | ---: | ---: | ---: | ---: | ---: |\n',
    )

    for (const { name, second } of cases) {
        const query = {
            first,
            second,
            angularTolerance: 0,
            modelTolerance: { distance: 1e-7 },
        }
        const result = intersectCurves(query)

        if (!isDeepStrictEqual(result, unculled(query))) {
            throw new Error(`Culling changed the benchmark result: ${name}`)
        }

        const a = prepareIntersectionCurve(first, 0)
        const b = prepareIntersectionCurve(second, 0)
        const candidates = [...intersectionCandidates(a, b)].length
        const [before, after] = measure(query, [unculled, intersectCurves])

        process.stdout.write(
            `| ${name} | 900 → ${candidates} | ${result.hits.length} | ${before.toFixed(3)} | ${after.toFixed(3)} | ${(before / after).toFixed(1)}× |\n`,
        )
    }

    process.stdout.write(`\nChecksum: ${checksum}\n`)
} finally {
    await server.close()
}
