import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
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
])
