import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes } from '../src/dxf-io/decode-bytes'
import { tokenizeDxf, type DxfToken } from '../src/dxf-io/tokenize'
import { decodeUnicodeEscapes } from '../src/dxf-io/unicode-escape'
import { decodeText } from '../src/file-io/text-codec'

interface Manifest {
    readonly sourceVersion: string
    readonly unitCode: number
    readonly measurement: number
    readonly layers: readonly { readonly name: string }[]
    readonly entities: readonly {
        readonly handle: string
        readonly sourceType: string
        readonly classification: string
        readonly geometry: {
            readonly start?: { readonly x: number; readonly y: number }
            readonly end?: { readonly x: number; readonly y: number }
        } | null
    }[]
}

const corpus = fileURLToPath(new URL('../fixtures/dxf/r2000/', import.meta.url))
const fixtures = readdirSync(corpus, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.dxf'))
    .sort()

function decoded(path: string): string {
    const result = decodeDxfBytes(readFileSync(join(corpus, path)), decodeText)

    if (result.kind !== 'text') {
        throw new Error(result.message)
    }

    return result.text
}

function tokensOf(text: string): readonly DxfToken[] {
    const result = tokenizeDxf(text)

    if (result.kind !== 'tokens') {
        throw new Error(`Line ${result.line}: ${result.message}`)
    }

    return result.tokens
}

function headerValue(tokens: readonly DxfToken[], name: string) {
    const index = tokens.findIndex(
        (token) => token.code === 9 && token.value === name,
    )

    return tokens[index + 1]?.value
}

function records(tokens: readonly DxfToken[]): Map<string, DxfToken[]> {
    const byHandle = new Map<string, DxfToken[]>()
    let current: DxfToken[] = []

    for (const token of tokens) {
        if (token.code === 0) {
            current = [token]
        } else {
            current.push(token)
        }

        if (token.code === 5 && typeof token.value === 'string') {
            byHandle.set(token.value, current)
        }
    }

    return byHandle
}

function groupValue(record: readonly DxfToken[], code: number) {
    return record.find((token) => token.code === code)?.value
}

describe('DXF fixture tokens', () => {
    it.each(fixtures)('tokenizes %s to its expected content', (path) => {
        const manifest = JSON.parse(
            readFileSync(
                join(corpus, path.replace(/\.dxf$/, '.expected.json')),
                'utf8',
            ),
        ) as Manifest
        const text = decoded(path)
        const tokens = tokensOf(text)
        const lines = text.split('\n')

        expect(lines.at(-1)).toBe('')
        expect(tokens.map((token) => token.line)).toEqual(
            Array.from({ length: (lines.length - 1) / 2 }, (_, i) => 2 * i + 1),
        )
        expect(tokens.at(-1)).toEqual({
            code: 0,
            value: 'EOF',
            line: lines.length - 2,
        })
        expect(headerValue(tokens, '$ACADVER')).toBe(manifest.sourceVersion)
        expect(headerValue(tokens, '$INSUNITS')).toBe(manifest.unitCode)
        expect(headerValue(tokens, '$MEASUREMENT')).toBe(manifest.measurement)

        const layerNames = tokens
            .filter(
                (token) => token.code === 2 && typeof token.value === 'string',
            )
            .map((token) => decodeUnicodeEscapes(String(token.value)))

        for (const { name } of manifest.layers) {
            expect(layerNames).toContain(name)
        }

        const byHandle = records(tokens)

        for (const entity of manifest.entities) {
            const record = byHandle.get(entity.handle)

            expect(record?.[0]).toMatchObject({
                code: 0,
                value: entity.sourceType,
            })

            if (entity.sourceType === 'LINE' && entity.geometry !== null) {
                const { start, end } = entity.geometry

                expect(
                    [10, 20, 11, 21].map((code) =>
                        groupValue(record ?? [], code),
                    ),
                ).toEqual([start?.x, start?.y, end?.x, end?.y])
            }
        }
    })

    it('tokenizes CRLF copies of every fixture identically', () => {
        for (const path of fixtures) {
            const text = decoded(path)

            expect(tokensOf(text.replaceAll('\n', '\r\n'))).toEqual(
                tokensOf(text),
            )
        }
    })
})
