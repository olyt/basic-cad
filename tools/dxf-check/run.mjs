import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const python = join(
    root,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)
const args = process.argv.slice(2)
const result = spawnSync(
    python,
    args[0] === '--test'
        ? ['-m', 'unittest', 'discover', '-s', root, '-p', 'test_*.py']
        : [join(root, 'check.py'), ...args],
    {
        stdio: 'inherit',
        env: {
            ...process.env,
            XDG_CACHE_HOME:
                process.env.XDG_CACHE_HOME ?? join(root, '.venv', '.cache'),
        },
    },
)

if (result.error) {
    console.error(
        'Cannot start the DXF checker. Follow the Python setup in README.md.',
    )
}

process.exitCode = result.status ?? 2
