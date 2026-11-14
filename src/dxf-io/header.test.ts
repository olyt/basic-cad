import { describe, expect, it } from 'vitest'
import { readDxfHeader } from './header'
import { tokenizeDxf } from './tokenize'

function read(text: string) {
    const result = tokenizeDxf(`${text}0\nEOF\n`)

    if (result.kind !== 'tokens') {
        throw new Error(result.message)
    }

    return readDxfHeader(result.tokens)
}

function header(body: string) {
    return read(`0\nSECTION\n2\nHEADER\n${body}0\nENDSEC\n`)
}

describe('DXF header reader', () => {
    it('reads all five fields without changing source identifiers', () => {
        expect(
            header(
                '9\n$ACADVER\n1\nAC1015\n9\n$CLAYER\n8\n  Plan  \n' +
                    '9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n0\n' +
                    '9\n$DWGCODEPAGE\n3\nANSI_1252\n',
            ),
        ).toEqual({
            kind: 'header',
            header: {
                sourceVersion: 'AC1015',
                currentLayer: '  Plan  ',
                unitCode: 4,
                units: 'millimeters',
                measurement: 0,
                codepage: 'ANSI_1252',
            },
        })
    })

    it('keeps missing fields absent, including when HEADER is omitted', () => {
        expect(read('')).toEqual({ kind: 'header', header: {} })
        expect(header('')).toEqual({ kind: 'header', header: {} })
        expect(header('9\n$MEASUREMENT\n70\n1\n')).toEqual({
            kind: 'header',
            header: { measurement: 1 },
        })
    })

    it('preserves unitless drawings even when the metric flag is set', () => {
        expect(header('9\n$INSUNITS\n70\n0\n9\n$MEASUREMENT\n70\n1\n')).toEqual(
            {
                kind: 'header',
                header: { unitCode: 0, units: 'unitless', measurement: 1 },
            },
        )
    })

    it('maps all supported unit codes in their standard order', () => {
        const units = [
            'unitless',
            'inches',
            'feet',
            'miles',
            'millimeters',
            'centimeters',
            'meters',
            'kilometers',
            'microinches',
            'mils',
            'yards',
            'angstroms',
            'nanometers',
            'microns',
            'decimeters',
            'decameters',
            'hectometers',
            'gigameters',
            'astronomical-units',
            'light-years',
            'parsecs',
        ]

        units.forEach((value, code) => {
            expect(header(`9\n$INSUNITS\n70\n${code}\n`)).toEqual({
                kind: 'header',
                header: { unitCode: code, units: value },
            })
        })
    })

    it.each([21, 24, 99])(
        'retains unsupported unit code %s without guessing units',
        (code) => {
            expect(header(`9\n$INSUNITS\n70\n${code}\n`)).toEqual({
                kind: 'header',
                header: { unitCode: code },
            })
        },
    )

    it.each([
        '',
        '  Floor  ',
        'План😀',
        '\\U+041F\\U+043B\\U+0430\\U+043D\\U+D83D\\U+DE00',
    ])('decodes only isolated layer strings: %s', (name) => {
        expect(header(`9\n$CLAYER\n8\n${name}\n`)).toEqual({
            kind: 'header',
            header: { currentLayer: name.startsWith('\\U+') ? 'План😀' : name },
        })
    })

    it('keeps codepage text literal and accepts source versions without qualifying them', () => {
        expect(
            header(
                '9\n$ACADVER\n1\nAC1021\n9\n$DWGCODEPAGE\n3\n\\U+0041NSI_1252\n',
            ),
        ).toEqual({
            kind: 'header',
            header: { sourceVersion: 'AC1021', codepage: '\\U+0041NSI_1252' },
        })
    })

    it('skips comments and unknown multi-group variables, and ignores other sections', () => {
        expect(
            read(
                '0\nSECTION\n2\nENTITIES\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n' +
                    '0\nSECTION\n999\ncomment\n2\nHEADER\n9\n$EXTMIN\n10\n0\n20\n0\n30\n0\n' +
                    '9\n$INSUNITS\n999\nignored\n70\n4\n999\nignored too\n0\nENDSEC\n',
            ),
        ).toEqual({
            kind: 'header',
            header: { unitCode: 4, units: 'millimeters' },
        })
    })

    it.each([
        [
            '9\n$INSUNITS\n70\n-1\n',
            [8, '$INSUNITS needs a nonnegative integer.'],
        ],
        ['9\n$INSUNITS\n1\n4\n', [5, '$INSUNITS needs one group 70 value.']],
        ['9\n$MEASUREMENT\n70\n2\n', [8, 'Invalid $MEASUREMENT value.']],
        ['9\n$ACADVER\n1\nAC1015junk\n', [8, 'Invalid $ACADVER value.']],
        ['9\n$CLAYER\n', [5, '$CLAYER needs one group 8 value.']],
        [
            '9\n$DWGCODEPAGE\n1\nANSI_1252\n',
            [5, '$DWGCODEPAGE needs one group 3 value.'],
        ],
        [
            '9\n$INSUNITS\n70\n1\n9\n$INSUNITS\n70\n4\n',
            [9, 'Duplicate $INSUNITS variable.'],
        ],
        [
            '9\n$CLAYER\n8\n0\n8\nOther\n',
            [9, '$CLAYER has extra value groups.'],
        ],
    ] as const)(
        'reports malformed or ambiguous fields: %s',
        (body, [line, message]) => {
            expect(header(body)).toEqual({ kind: 'error', line, message })
        },
    )

    it('rejects duplicate and unterminated HEADER sections', () => {
        expect(
            read(
                '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nHEADER\n0\nENDSEC\n',
            ),
        ).toEqual({
            kind: 'error',
            line: 7,
            message: 'Duplicate HEADER section.',
        })
        expect(read('0\nSECTION\n2\nHEADER\n')).toEqual({
            kind: 'error',
            line: 1,
            message: 'HEADER section has no 0/ENDSEC.',
        })
    })
})
