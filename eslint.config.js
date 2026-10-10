import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import sonarjs from 'eslint-plugin-sonarjs'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default defineConfig([
    globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', '**/.venv/**']),
    js.configs.recommended,
    tseslint.configs.recommended,
    vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
            },
        },
    },
    {
        files: ['src/{geometry,document,commands,dxf-io}/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['vue', 'vue/**', '@vue/**'],
                            message: 'Pure CAD modules must not depend on Vue.',
                        },
                        {
                            regex: '(^|/)(ui|viewport|file-io|recovery|main(?:\\.ts)?)(/|$)|\\.vue(?:\\?.*)?$',
                            message:
                                'Pure CAD modules must not import browser or UI modules.',
                        },
                    ],
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'ImportExpression, TSImportType',
                    message:
                        'Keep imports static in pure CAD modules so dependency boundaries can be checked.',
                },
                {
                    selector:
                        'CallExpression[callee.name="require"], TSImportEqualsDeclaration',
                    message:
                        'Use static ES imports in pure CAD modules so dependency boundaries can be checked.',
                },
            ],
        },
    },
    prettier,
    {
        plugins: { '@stylistic': stylistic, sonarjs },
        rules: {
            'sonarjs/cognitive-complexity': ['error', 10],
            '@stylistic/padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: '*', next: 'block-like' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
                {
                    blankLine: 'always',
                    prev: '*',
                    next: ['const', 'let', 'var'],
                },
                {
                    blankLine: 'always',
                    prev: ['const', 'let', 'var'],
                    next: '*',
                },
                {
                    blankLine: 'any',
                    prev: ['const', 'let', 'var'],
                    next: ['const', 'let', 'var'],
                },
                { blankLine: 'always', prev: '*', next: 'return' },
            ],
            curly: ['error', 'all'],
            'no-nested-ternary': 'error',
            eqeqeq: ['error', 'always'],
        },
    },
    {
        files: ['**/*.ts', '**/*.vue'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.node.json'],
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': [
                'error',
                { ignoreVoid: false },
            ],
            '@typescript-eslint/no-misused-promises': 'error',
        },
    },
])
