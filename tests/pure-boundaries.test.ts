import { spawnSync } from 'node:child_process'
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const lint = new ESLint({ cwd: root })
const temporaryDirectories: string[] = []
const pureModules = ['geometry', 'document', 'commands', 'dxf-io']

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true })
    }
})

function checkPure(files: Record<string, string>) {
    const directory = mkdtempSync(join(tmpdir(), 'basic-cad-boundaries-'))
    temporaryDirectories.push(directory)
    for (const config of ['tsconfig.json', 'tsconfig.pure.json']) {
        copyFileSync(join(root, config), join(directory, config))
    }
    // Real type definitions, so fixtures can load @types/node the way a
    // dependency would. Cleanup removes the link, not its target.
    mkdirSync(join(directory, 'node_modules'))
    symlinkSync(
        join(root, 'node_modules/@types'),
        join(directory, 'node_modules/@types'),
        'junction',
    )
    for (const [file, contents] of Object.entries(files)) {
        const path = join(directory, file)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, contents)
    }
    const result = spawnSync(
        process.execPath,
        [
            join(root, 'scripts/check-pure.mjs'),
            join(directory, 'tsconfig.pure.json'),
        ],
        { encoding: 'utf8', timeout: 10_000 },
    )
    if (result.error) throw result.error
    return result
}

describe('pure-module typechecking', () => {
    it('handles the empty scaffold without adding fake source modules', () => {
        const result = checkPure({})
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('no source files yet')
    })

    it('accepts standard JavaScript and imports between pure modules', () => {
        const result = checkPure({
            'src/geometry/value.ts': 'export const value = Math.hypot(3, 4)',
            'src/document/model.ts':
                "import { value } from '../geometry/value'; export const model = new Map([['length', value]])",
            'src/geometry/value.test.ts': 'window.alert("test environment")',
            'src/ui/panel.ts': 'document.title = "browser environment"',
        })
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
    })

    it.each(pureModules)('rejects DOM usage in %s', (module) => {
        const result = checkPure({
            [`src/${module}/invalid.ts`]:
                'export const element: HTMLElement = document.body; window.alert("invalid")',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain("Cannot find name 'HTMLElement'")
        expect(result.stderr).toContain("Cannot find name 'document'")
        expect(result.stderr).toContain("Cannot find name 'window'")
    })

    it('does not inherit Vite or Node globals', () => {
        const result = checkPure({
            'src/commands/invalid.ts':
                'export const env = import.meta.env; export const cwd = process.cwd()',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain("Property 'env' does not exist")
        expect(result.stderr).toContain("Cannot find name 'process'")
    })

    it('rejects declarations that reintroduce the DOM library', () => {
        const result = checkPure({
            'src/geometry/environment.d.ts': '/// <reference lib="dom" />',
            'src/geometry/invalid.ts': 'export const body = document.body',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
            'must not load DOM or WebWorker libraries',
        )
    })

    it('rejects declarations that reintroduce Node.js types', () => {
        const result = checkPure({
            'src/geometry/environment.d.ts': '/// <reference types="node" />',
            'src/geometry/invalid.ts': 'export const cwd = process.cwd()',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
            'must not load Node.js type definitions',
        )
    })

    it('rejects dependencies whose types load Node.js', () => {
        const result = checkPure({
            'node_modules/server-lib/package.json':
                '{"name":"server-lib","types":"index.d.ts"}',
            'node_modules/server-lib/index.d.ts':
                '/// <reference types="node" />\nexport declare const ready: boolean',
            'src/document/invalid.ts':
                "import { ready } from 'server-lib'\nexport const cwd = ready ? process.cwd() : ''",
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
            'must not load Node.js type definitions',
        )
    })

    it('fails invalid configuration even when no modules exist', () => {
        const result = checkPure({
            'tsconfig.pure.json':
                '{"compilerOptions":{"lib":["not-a-real-lib"]}}',
        })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('--lib')
    })
})

describe('pure-module import boundaries', () => {
    it.each(pureModules)('rejects Vue imports in %s', async (module) => {
        const [result] = await lint.lintText("export { ref } from 'vue'", {
            filePath: join(root, `src/${module}/invalid.ts`),
        })
        expect(result?.messages).toContainEqual(
            expect.objectContaining({ ruleId: 'no-restricted-imports' }),
        )
    })

    it.each([
        "import 'vue/dist/vue.esm-bundler.js'",
        "export { ref } from '@vue/reactivity'",
        "export type { Component } from 'vue'",
        "import '../ui/panel'",
        "export * from '../../ui/panel'",
        "import '@/ui/panel'",
        "import 'src/ui/panel'",
        "import '../viewport/engine'",
        "import '../file-io/open'",
        "import '../recovery/storage'",
        "import '../main'",
        "import '../App.vue'",
        "export const load = () => import('vue')",
        "export type Component = import('vue').Component",
        "export const vue = require('vue')",
        "import vue = require('vue'); export { vue }",
    ])('rejects %s', async (code) => {
        const [result] = await lint.lintText(code, {
            filePath: join(root, 'src/geometry/invalid.ts'),
        })
        expect(
            result?.messages.some((message) =>
                ['no-restricted-imports', 'no-restricted-syntax'].includes(
                    message.ruleId ?? '',
                ),
            ),
        ).toBe(true)
    })

    it('allows imports between pure modules and Vue imports in the UI', async () => {
        for (const [file, code] of [
            ['src/commands/valid.ts', "export * from '../geometry/value'"],
            ['src/ui/valid.ts', "export { ref } from 'vue'"],
        ] as const) {
            const [result] = await lint.lintText(code, {
                filePath: join(root, file),
            })
            expect(result?.messages).toEqual([])
        }
    })
})
