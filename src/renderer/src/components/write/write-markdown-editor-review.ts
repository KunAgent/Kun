import type { MutableRefObject } from 'react'
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { isolateHistory, undo } from '@codemirror/commands'
import { EditorView, showPanel, type Panel } from '@codemirror/view'
import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from '@codemirror/merge'
import i18n from '../../i18n'
import type { WriteDocumentReviewHandle, WriteReviewOrigin } from './write-document-editor-handle'
import { buildInteractionExtensions, externalValueSyncAnnotation } from './write-markdown-editor-support'
import { markdownSelectionHold, selectionHoldEffect } from './write-markdown-selection-hold'

type Params = {
  viewRef: MutableRefObject<EditorView | null>
  readOnlyRef: MutableRefObject<boolean>
  reviewActiveRef: MutableRefObject<boolean>
  lastEmittedValueRef: MutableRefObject<string | null>
  onChangeRef: MutableRefObject<(value: string) => void>
  onReviewStateChangeRef: MutableRefObject<((active: boolean) => void) | undefined>
  mergeCompartment: Compartment
  editableCompartment: Compartment
}

/** The proposal has no history. Resolve against the captured state in one undoable edit. */
export function createMarkdownReview(deps: Params): WriteDocumentReviewHandle & { finish: () => void; notifyLayout: () => void } {
  const { viewRef, readOnlyRef, reviewActiveRef, lastEmittedValueRef, onChangeRef,
    onReviewStateChangeRef, mergeCompartment, editableCompartment } = deps
  let before: EditorState | null = null
  let origin: WriteReviewOrigin = 'agent'
  const listeners = new Set<() => void>()
  const finish = (reject = false): void => {
    const view = viewRef.current
    if (!view || !before || !reviewActiveRef.current) return
    const finalDoc = reject ? before.doc.toString() : view.state.doc.toString()
    // Restoring the state preserves all earlier undo entries, including typing immediately before review.
    view.setState(before)
    before = null
    view.dispatch({
      changes: finalDoc === view.state.doc.toString() ? undefined : { from: 0, to: view.state.doc.length, insert: finalDoc },
      annotations: [externalValueSyncAnnotation.of(true), isolateHistory.of('full')],
      effects: [mergeCompartment.reconfigure([]), editableCompartment.reconfigure(buildInteractionExtensions(readOnlyRef.current)), selectionHoldEffect.of(null)]
    })
    reviewActiveRef.current = false
    delete view.dom.dataset.reviewOrigin
    lastEmittedValueRef.current = finalDoc
    onChangeRef.current(finalDoc)
    onReviewStateChangeRef.current?.(false)
    for (const cb of listeners) cb()
  }
  const resolveAll = (mode: 'accept' | 'reject'): void => {
    const view = viewRef.current
    if (!view || !reviewActiveRef.current) return
    if (mode === 'reject') { finish(true); return }
    if (origin === 'selection') { finish(); return }
    for (let guard = 0; guard < 10_000; guard++) {
      const chunk = getChunks(view.state)?.chunks[0]
      if (!chunk) break
      acceptChunk(view, chunk.fromB)
    }
    finish()
  }
  const panel = (): Panel => {
    const dom = document.createElement('div')
    dom.className = 'cm-write-diff-panel'
    const label = document.createElement('span')
    label.className = 'cm-write-diff-panel-label'
    label.textContent = i18n.t('common:writeDiffReviewing')
    dom.append(label)
    for (const action of ['reject', 'accept'] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `cm-write-diff-${action}-all`
      button.textContent = i18n.t(action === 'accept' ? 'common:writeDiffAcceptAll' : 'common:writeDiffRejectAll')
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => resolveAll(action))
      dom.append(button)
    }
    return { dom, top: true }
  }
  const begin: WriteDocumentReviewHandle['beginDiffReview'] = (params) => {
    const view = viewRef.current
    if (!view || readOnlyRef.current || params.original === params.nextDoc) return false
    if (!reviewActiveRef.current) before = view.state
    origin = params.origin ?? 'agent'
    reviewActiveRef.current = true
    view.dom.dataset.reviewOrigin = origin
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: params.nextDoc },
      selection: EditorSelection.cursor(Math.min(view.state.selection.main.from, params.nextDoc.length)),
      annotations: [externalValueSyncAnnotation.of(true), Transaction.addToHistory.of(false)],
      effects: [
        editableCompartment.reconfigure(buildInteractionExtensions(true)),
        mergeCompartment.reconfigure([
          unifiedMergeView({ original: params.original, gutter: false, mergeControls: origin === 'agent',
            ...(origin === 'agent' ? { collapseUnchanged: { margin: 3, minSize: 4 } } : {}) }),
          ...(origin === 'agent' ? [showPanel.of(panel)] : [])
        ])
      ]
    })
    onReviewStateChangeRef.current?.(true)
    for (const cb of listeners) cb()
    return true
  }
  return {
    beginDiffReview: begin,
    beginSelectionReview: ({ range, original, replacement }) => {
      const view = viewRef.current
      if (!view || reviewActiveRef.current || range.from < 0 || range.to <= range.from || range.to > view.state.doc.length) return null
      const baseline = view.state.doc.toString()
      if (baseline.slice(range.from, range.to) !== original) return null
      if (!begin({ original: baseline, nextDoc: baseline.slice(0, range.from) + replacement + baseline.slice(range.to), origin: 'selection' })) return null
      return { hunks: getChunks(view.state)?.chunks.length ?? 0 }
    },
    isDiffReviewActive: () => reviewActiveRef.current,
    acceptAllDiff: () => resolveAll('accept'),
    rejectAllDiff: () => resolveAll('reject'),
    finish,
    getReviewAnchorRect: () => {
      const view = viewRef.current, chunks = view && getChunks(view.state)?.chunks
      if (!view) return null
      const held = view.state.field(markdownSelectionHold, false)?.iter()
      const from = chunks?.[0]?.fromB ?? (held?.value ? held.from : null)
      const to = chunks?.at(-1)?.toB ?? (held?.value ? held.to : null)
      if (from === null || to === null) return null
      const first = view.coordsAtPos(Math.min(from, view.state.doc.length))
      const last = view.coordsAtPos(Math.min(to, view.state.doc.length))
      if (!first || !last) return null
      const left = Math.min(first.left, last.left), right = Math.max(first.right, last.right)
      return { left, right, top: first.top, bottom: last.bottom, width: right - left, height: last.bottom - first.top }
    },
    subscribeReviewLayout: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    notifyLayout: () => { for (const cb of listeners) cb() },
    setSelectionHold: (range) => { viewRef.current?.dispatch({ effects: selectionHoldEffect.of(range) }) },
    restoreSelection: (range) => {
      const view = viewRef.current
      if (!view || range.to > view.state.doc.length) return
      view.dispatch({ selection: EditorSelection.range(range.from, range.to) })
      view.focus()
    },
    getElement: () => viewRef.current?.contentDOM ?? null,
    undoLast: () => viewRef.current ? undo(viewRef.current) : false
  }
}
