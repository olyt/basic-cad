import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes } from '../src/dxf-io/decode-bytes'
import { decodeUnicodeEscapes } from '../src/dxf-io/unicode-escape'
import { decodeText } from '../src/file-io/text-codec'

const corpus = fileURLToPath(new URL('../fixtures/dxf/r2000/', import.meta.url))
const fixtures = readdirSync(corpus, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.dxf'))
    .sort()

function decodedLines(path: string): Set<string> {
    const bytes = readFileSync(join(corpus, path))
    const result = decodeDxfBytes(bytes, decodeText)

    if (result.kind !== 'text') {
        throw new Error(result.message)
    }

    // Windows-1252 maps each byte to one UTF-16 code unit.
    expect(result.text).toHaveLength(bytes.length)

    return new Set(result.text.split('\n').map(decodeUnicodeEscapes))
}

describe('DXF fixture decoding', () => {
    it('covers both R2000 corpora', () => {
        expect(fixtures).toHaveLength(8)
    })

    it.each(fixtures)('decodes %s to its expected layer names', (path) => {
        const manifest = JSON.parse(
            readFileSync(
                join(corpus, path.replace(/\.dxf$/, '.expected.json')),
                'utf8',
            ),
        ) as { layers: { name: string }[] }
        const lines = decodedLines(path)

        for (const { name } of manifest.layers) {
            expect(lines).toContain(name)
        }
    })

    it('decodes CRLF copies of every fixture identically', () => {
        for (const path of fixtures) {
            const bytes = readFileSync(join(corpus, path))
            const crlf = Buffer.from(
                bytes.toString('latin1').replaceAll('\n', '\r\n'),
                'latin1',
            )
            const text = decodeText(bytes, 'windows-1252')

            expect(decodeDxfBytes(crlf, decodeText)).toEqual({
                kind: 'text',
                text: text.replaceAll('\n', '\r\n'),
            })
        }
    })
})
