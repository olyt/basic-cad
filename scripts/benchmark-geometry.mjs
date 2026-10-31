import { cpus, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const iterations = Number(process.argv[2] ?? 2000)
let checksum = 0

if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new RangeError(
        'Usage: npm run bench:geometry -- [positive calls per sample]',
    )
}

async function loadGeometry(server, directory) {
    const names = [
        'line-intersection',
        'line-circle-intersection',
        'circle-intersection',
        'area',
    ]
    const modules = await Promise.all(
        names.map((name) =>
            server.ssrLoadModule(`/src/${directory}/${name}.ts`),
        ),
    )

    return {
        line: modules[0].intersectLines,
        lineCircle: modules[1].lineCircleIntersections,
        circles: modules[2].circleIntersections,
        area: modules[3].polylineSignedArea,
    }
}

function benchmarkCases({ curve, polyline }, random) {
    return Array.from({ length: 32 }, () => {
        const center = {
            x: random.between(10000, 10200),
            y: random.between(10000, 10200),
        }
        const first = curve.createCircle(center, random.between(100, 120))
        const second = curve.createCircle(
            {
                x: center.x + random.between(100, 120),
                y: center.y + random.between(-10, 10),
            },
            random.between(90, 110),
        )
        const miss = curve.createCircle({ x: center.x + 500, y: center.y }, 100)
        const line = {
            line: curve.createLine(
                { x: center.x - 200, y: center.y + 10 },
                { x: center.x + 200, y: center.y + 11 },
            ),
            domain: 'infinite',
        }
        const crossing = {
            line: curve.createLine(
                { x: center.x, y: center.y - 200 },
                { x: center.x + 10, y: center.y + 200 },
            ),
            domain: 'segment',
        }
        const points = [
            center,
            { x: center.x + 100.3, y: center.y },
            { x: center.x + 100.3, y: center.y + 60.7 },
            { x: center.x, y: center.y + 60.7 },
        ]
        const segments = points.map((point, index) =>
            curve.createLine(point, points[(index + 1) % points.length]),
        )
        const boundary = polyline.createPolyline(
            { segments, closed: true },
            { distance: 0 },
        )

        return { first, second, miss, line, crossing, boundary }
    })
}

function hitChecksum(hit) {
    let sum = hit.point.x + hit.point.y

    for (const key of ['direction', 'firstDirection', 'secondDirection']) {
        const direction = hit[key]

        if (direction) {
            sum += direction.x + direction.y
        }
    }

    return sum
}

function resultChecksum(result) {
    if (typeof result === 'number') {
        return result
    }

    const hits = Array.isArray(result) ? result : (result.hits ?? [])

    if (result.point) {
        return hitChecksum(result)
    }

    return hits.reduce((sum, hit) => sum + hitChecksum(hit), 0)
}

function timeBatch(operation, calls) {
    const start = performance.now()

    for (let index = 0; index < calls; index++) {
        const result = operation(index)

        checksum += resultChecksum(result)
    }

    return ((performance.now() - start) * 1000) / calls
}

function median(values) {
    return values.toSorted((first, second) => first - second)[
        Math.floor(values.length / 2)
    ]
}

function measure({ name, current, reference }, calls) {
    for (let index = 0; index < 32; index++) {
        if (!isDeepStrictEqual(current(index), reference(index))) {
            throw new Error(`Benchmark inputs disagree: ${name}, case ${index}`)
        }
    }

    timeBatch(reference, 500)
    timeBatch(current, 500)

    const fixed = []
    const scaled = []

    for (let sample = 0; sample < 5; sample++) {
        const order = [
            { operation: reference, samples: fixed },
            { operation: current, samples: scaled },
        ]

        if (sample % 2 === 1) {
            order.reverse()
        }

        for (const { operation, samples } of order) {
            samples.push(timeBatch(operation, calls))
        }
    }

    const before = median(fixed)
    const after = median(scaled)

    process.stdout.write(
        `| ${name} | ${before.toFixed(2)} | ${after.toFixed(2)} | ${(before / after).toFixed(1)}× |\n`,
    )
}

const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
})

try {
    const [current, reference, curve, polyline, { seededRandom }] =
        await Promise.all([
            loadGeometry(server, 'geometry'),
            loadGeometry(server, 'test-support/fixed-scale'),
            server.ssrLoadModule('/src/geometry/curve.ts'),
            server.ssrLoadModule('/src/geometry/polyline.ts'),
            server.ssrLoadModule('/src/test-support/random.ts'),
        ])
    const cases = benchmarkCases({ curve, polyline }, seededRandom(20261031))
    const queries = [
        {
            name: 'Crossing circles',
            query: (implementation, input) =>
                implementation.circles(input.first, input.second),
        },
        {
            name: 'Separate circles',
            query: (implementation, input) =>
                implementation.circles(input.first, input.miss),
        },
        {
            name: 'Line–circle',
            query: (implementation, input) =>
                implementation.lineCircle(input.line, input.first),
        },
        {
            name: 'Line–line',
            query: (implementation, input) =>
                implementation.line(input.line, input.crossing),
        },
        {
            name: 'Rectangle area',
            query: (implementation, input) =>
                implementation.area(input.boundary, { distance: 0 }),
        },
    ]

    process.stdout.write(
        `${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}\n`,
    )
    process.stdout.write(
        `Median of five samples, ${iterations} calls/sample, 32 seeded inputs, 500 warmup calls/implementation.\n\n`,
    )
    process.stdout.write(
        '| Full query | Fixed µs/call | Scaled µs/call | Speedup |\n| --- | ---: | ---: | ---: |\n',
    )

    for (const { name, query } of queries) {
        measure(
            {
                name,
                current: (index) => query(current, cases[index % cases.length]),
                reference: (index) =>
                    query(reference, cases[index % cases.length]),
            },
            iterations,
        )
    }

    process.stdout.write(`\nChecksum: ${checksum}\n`)
} finally {
    await server.close()
}
