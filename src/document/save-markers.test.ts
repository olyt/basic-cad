import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from './document'
import {
    commitHistory,
    createHistory,
    undoHistory,
    redoHistory,
    type DocumentHistory,
} from './history'
import { createIdState, parseId } from './id'
import {
    admitSaveMarkers,
    captureDocumentRevision,
    createSaveMarkers,
    getSaveStatus,
    markExported,
    markSaved,
    type DocumentRevision,
    type SaveMarkers,
} from './save-markers'
import { type DrawingDocument } from './schema'

const { document } = createEmptyDocument(createIdState('markers', 0), {
    modelTolerance: { distance: 1e-7 },
})

function edit(history: DocumentHistory) {
    const current = history.document

    return commitHistory(history, {
        documentId: current.id,
        baseRevision: current.revision,
        settings: {
            units: current.units === 'inches' ? 'millimeters' : 'inches',
            modelTolerance: current.modelTolerance,
            defaultLineweight: current.defaultLineweight,
            defaults: current.defaults,
        },
    })
}

const initial = createHistory(document, { capacity: 3, highWaterRevision: 0 })
const first = edit(initial)
const second = edit(first)
const fresh = Object.freeze(createSaveMarkers(document))
const originalSnapshot = Object.freeze(captureDocumentRevision(document))
const firstSnapshot = Object.freeze(captureDocumentRevision(first.document))
const secondSnapshot = Object.freeze(captureDocumentRevision(second.document))
const completions = [markSaved, markExported]
const documentId = document.id
const pending = { unsaved: true, unexported: true }
const clean = { unsaved: false, unexported: false }
const savedOnly = { unsaved: false, unexported: true }
const exportedOnly = { unsaved: true, unexported: false }

describe('saved and exported revision markers', () => {
    it.each([document, second.document])(
        'starts pending at revision $revision without an inferred baseline',
        (current) => {
            const markers = createSaveMarkers(Object.freeze(current))

            expect(markers).toEqual({
                documentId,
                lastSaved: null,
                lastExported: null,
            })
            expect(getSaveStatus(current, markers)).toEqual(pending)
        },
    )

    it('updates channels independently and keeps frozen inputs unchanged', () => {
        const saved = markSaved(fresh, originalSnapshot)
        const exported = markExported(Object.freeze(saved), originalSnapshot)

        expect(saved).toEqual({
            documentId,
            lastSaved: 0,
            lastExported: null,
        })
        expect(getSaveStatus(document, saved)).toEqual(savedOnly)
        expect(getSaveStatus(document, exported)).toEqual(clean)
        expect(saved).not.toBe(fresh)
        expect(exported).not.toBe(saved)
        expect(fresh).toEqual({
            documentId,
            lastSaved: null,
            lastExported: null,
        })
    })

    it('applies a late completion to its captured revision rather than the current head', () => {
        const saved = markSaved(fresh, firstSnapshot)
        const exported = markExported(saved, secondSnapshot)

        expect(getSaveStatus(second.document, saved)).toEqual(pending)
        expect(getSaveStatus(second.document, exported)).toEqual(exportedOnly)
        expect(exported.lastSaved).toBe(1)
    })

    it('becomes clean on undo to the saved revision and dirty again on redo', () => {
        const markers = markExported(
            markSaved(fresh, firstSnapshot),
            firstSnapshot,
        )
        const undone = undoHistory(second)

        expect(getSaveStatus(undone.document, markers)).toEqual(clean)
        expect(getSaveStatus(redoHistory(undone).document, markers)).toEqual(
            pending,
        )
    })

    it('keeps a new branch dirty after discarding a saved revision', () => {
        const markers = markSaved(fresh, secondSnapshot)
        const undone = undoHistory(second)
        const branch = edit(undone)

        expect(getSaveStatus(undone.document, markers).unsaved).toBe(true)
        expect(branch.document.revision).toBe(3)
        expect(branch.document.units).toBe(second.document.units)
        expect(getSaveStatus(branch.document, markers).unsaved).toBe(true)
    })

    it('uses reported completion order independently in each channel, allowing older or revisited snapshots', () => {
        const saved = markSaved(
            markExported(fresh, originalSnapshot),
            secondSnapshot,
        )
        const olderSaved = markSaved(saved, firstSnapshot)
        const exported = markExported(olderSaved, secondSnapshot)
        const olderExported = markExported(exported, originalSnapshot)
        const latest = markSaved(
            markExported(olderExported, secondSnapshot),
            secondSnapshot,
        )

        expect(olderSaved).toEqual({
            documentId,
            lastSaved: 1,
            lastExported: 0,
        })
        expect(olderExported).toEqual({
            documentId,
            lastSaved: 1,
            lastExported: 0,
        })
        expect(latest).toEqual({
            documentId,
            lastSaved: 2,
            lastExported: 2,
        })
        expect(getSaveStatus(first.document, olderSaved).unsaved).toBe(false)
    })

    it('rejects foreign document state and callbacks without changing either marker set', () => {
        const other = {
            ...document,
            id: parseId('document', 'document:other:0'),
        }
        const foreign = Object.freeze(createSaveMarkers(other))
        const foreignSnapshot = captureDocumentRevision(other)

        for (const complete of completions) {
            expect(() => complete(fresh, foreignSnapshot)).toThrow(RangeError)
            expect(() => complete(foreign, originalSnapshot)).toThrow(
                RangeError,
            )
        }

        expect(() => getSaveStatus(document, foreign)).toThrow(RangeError)
        expect(() => getSaveStatus(other, fresh)).toThrow(RangeError)
        expect(fresh.lastSaved).toBeNull()
        expect(foreign.lastExported).toBeNull()
    })

    it.each([0, Number.MAX_SAFE_INTEGER])(
        'admits and copies marker boundary %s',
        (revision) => {
            const input = Object.freeze({
                ...fresh,
                lastSaved: revision,
                lastExported: revision,
                extra: true,
            })
            const admitted = admitSaveMarkers(input)

            expect(admitted).toEqual({
                documentId,
                lastSaved: revision,
                lastExported: revision,
            })
            expect(admitted).not.toBe(input)
            expect(getSaveStatus({ ...document, revision }, admitted)).toEqual(
                clean,
            )
        },
    )

    it('requires every recovery field even when the document revision is zero', () => {
        for (const key of Object.keys(fresh)) {
            const input: Record<string, unknown> = { ...fresh }

            delete input[key]
            expect(() => admitSaveMarkers(input)).toThrow(RangeError)

            for (const complete of completions) {
                expect(() =>
                    complete(input as unknown as SaveMarkers, originalSnapshot),
                ).toThrow(RangeError)
            }

            expect(() =>
                getSaveStatus(document, input as unknown as SaveMarkers),
            ).toThrow(RangeError)
        }
    })

    it.each([
        undefined,
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        '0',
    ])(
        'rejects missing or invalid counters throughout the boundary: %j',
        (revision) => {
            const invalid = { ...document, revision } as DrawingDocument

            expect(() => captureDocumentRevision(invalid)).toThrow(RangeError)
            expect(() => createSaveMarkers(invalid)).toThrow(RangeError)
            expect(() => getSaveStatus(invalid, fresh)).toThrow(RangeError)

            for (const field of ['lastSaved', 'lastExported']) {
                expect(() =>
                    admitSaveMarkers({ ...fresh, [field]: revision }),
                ).toThrow(RangeError)
            }

            for (const complete of completions) {
                expect(() =>
                    complete(fresh, {
                        documentId,
                        revision,
                    } as DocumentRevision),
                ).toThrow(RangeError)
            }
        },
    )

    it.each(['entity:markers:0', 'document:markers:00'])(
        'requires canonical document identity %s',
        (id) => {
            expect(() =>
                admitSaveMarkers({ ...fresh, documentId: id }),
            ).toThrow(RangeError)
            expect(() =>
                captureDocumentRevision({ ...document, id } as DrawingDocument),
            ).toThrow(RangeError)

            for (const complete of completions) {
                expect(() =>
                    complete(fresh, {
                        documentId: id,
                        revision: 0,
                    } as DocumentRevision),
                ).toThrow(RangeError)
            }
        },
    )

    it('captures metadata fields exactly once without reading drawing geometry', () => {
        const reads: PropertyKey[] = []
        const input = new Proxy(document, {
            get(target, key) {
                reads.push(key)

                return Reflect.get(target, key)
            },
        })

        expect(captureDocumentRevision(input)).toEqual(originalSnapshot)
        expect(reads.sort()).toEqual(['id', 'revision'])
    })
})
