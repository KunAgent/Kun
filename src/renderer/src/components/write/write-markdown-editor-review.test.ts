// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Compartment, EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { createMarkdownReview } from './write-markdown-editor-review'
import { buildInteractionExtensions } from './write-markdown-editor-support'
import { markdownSelectionHold } from './write-markdown-selection-hold'
const views: EditorView[] = []
afterEach(() => { for (const view of views.splice(0)) view.destroy() })
function harness(original = 'Before\n\nOld passage.\n\nAfter') {
  const editableCompartment = new Compartment(), mergeCompartment = new Compartment()
  const view = new EditorView({ state: EditorState.create({ doc: original, extensions: [history(), markdownSelectionHold,
    editableCompartment.of(buildInteractionExtensions(false)), mergeCompartment.of([])] }), parent: document.body })
  views.push(view)
  const emitted: string[] = [], readOnlyRef = { current: false }
  const review = createMarkdownReview({ viewRef: { current: view }, readOnlyRef, reviewActiveRef: { current: false },
    lastEmittedValueRef: { current: original }, onChangeRef: { current: (value) => emitted.push(value) },
    onReviewStateChangeRef: { current: undefined }, editableCompartment, mergeCompartment })
  const range = { from: original.indexOf('Old'), to: original.indexOf('Old') + 'Old passage.'.length }
  return { view, review, emitted, range, readOnlyRef }
}
describe('source selection review', () => {
  it('keeps the proposal read-only and unsaved, then accepts as exactly one undo step', () => {
    const h = harness()
    h.view.dispatch({ changes: { from: 0, insert: '!' } })
    const original = h.view.state.doc.toString()
    const range = { from: h.range.from + 1, to: h.range.to + 1 }
    expect(h.review.beginSelectionReview({ range, original: 'Old passage.', replacement: 'New passage.', instruction: 'Polish' })).toEqual({ hunks: 1 })
    expect(h.emitted).toEqual([])
    expect(h.view.state.facet(EditorState.readOnly)).toBe(true)
    expect(h.view.dom.dataset.reviewOrigin).toBe('selection')
    h.review.acceptAllDiff()
    expect(h.emitted).toEqual([original.replace('Old', 'New')])
    expect(h.view.state.facet(EditorState.readOnly)).toBe(false)
    expect(undo(h.view)).toBe(true)
    expect(h.view.state.doc.toString()).toBe(original)
    expect(undo(h.view)).toBe(true)
    expect(h.view.state.doc.toString()).toBe(original.slice(1))
  })
  it('discards byte-exactly without creating an undo entry', () => {
    const original = 'Before\n\nOld passage.\n\nAfter', h = harness(original)
    h.review.beginSelectionReview({ range: h.range, original: 'Old passage.', replacement: 'Different.', instruction: 'Edit' })
    h.review.rejectAllDiff()
    expect(h.emitted).toEqual([original])
    expect(h.view.state.doc.toString()).toBe(original)
    expect(undo(h.view)).toBe(false)
  })
  it('refuses stale, out-of-bounds, read-only and concurrent proposals', () => {
    const h = harness(), params = { range: h.range, original: 'Old passage.', replacement: 'New.', instruction: 'Edit' }
    expect(h.review.beginSelectionReview({ ...params, original: 'wrong' })).toBeNull()
    expect(h.review.beginSelectionReview({ ...params, range: { from: -1, to: 3 } })).toBeNull()
    h.readOnlyRef.current = true
    expect(h.review.beginSelectionReview(params)).toBeNull()
    h.readOnlyRef.current = false
    expect(h.review.beginSelectionReview(params)).not.toBeNull()
    expect(h.review.beginSelectionReview(params)).toBeNull()
  })
})
