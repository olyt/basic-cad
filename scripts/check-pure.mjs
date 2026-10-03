import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import ts from 'typescript'

const configPath = resolve(
    process.argv[2] ??
        fileURLToPath(new URL('../tsconfig.pure.json', import.meta.url)),
)
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(
    config.config ?? {},
    ts.sys,
    dirname(configPath),
)
const diagnostics = [
    ...(config.error ? [config.error] : []),
    // Pure modules arrive with their first feature; no empty source stubs are needed.
    ...parsed.errors.filter((diagnostic) => diagnostic.code !== 18003),
]

// A dependency or reference directive must not reintroduce browser or Node.js
// globals: code that compiles against them would fail in the other environment.
const forbiddenEnvironments = [
    {
        code: 90001,
        pattern: /[/\\]lib\.(dom|webworker)[.]/,
        messageText: 'Pure modules must not load DOM or WebWorker libraries.',
    },
    {
        code: 90002,
        pattern: /[/\\]node_modules[/\\]@types[/\\]node[/\\]/,
        messageText:
            'Pure modules must not load Node.js type definitions. Check reference directives and the types of imported packages.',
    },
]

if (parsed.fileNames.length > 0) {
    const program = ts.createProgram(parsed.fileNames, parsed.options)
    diagnostics.push(...ts.getPreEmitDiagnostics(program))
    const loadedFiles = program
        .getSourceFiles()
        .map((source) => source.fileName)
    for (const { code, pattern, messageText } of forbiddenEnvironments) {
        if (loadedFiles.some((fileName) => pattern.test(fileName))) {
            diagnostics.push({
                category: ts.DiagnosticCategory.Error,
                code,
                file: undefined,
                start: undefined,
                length: undefined,
                messageText,
            })
        }
    }
}

if (diagnostics.length > 0) {
    process.stderr.write(
        ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: ts.sys.getCurrentDirectory,
            getNewLine: () => ts.sys.newLine,
        }),
    )
    process.exitCode = 1
} else {
    process.stdout.write(
        parsed.fileNames.length > 0
            ? `Pure-module typecheck passed (${parsed.fileNames.length} source files).\n`
            : 'Pure-module typecheck: no source files yet.\n',
    )
}
