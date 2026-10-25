import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useTranslation } from 'react-i18next'
import { createSelectionEditStore, type SelectionEditSession } from '../../../write/selection-edit-store'
import { buildWriteInlineEditDraft, buildWriteInlineEditCompletionRequest } from '../../../write/inline-edit'
import { createWriteRecentEdit, type WriteRecentEdit } from '../../../write/recent-edits'
import type { WriteDocumentReviewHandle } from '../write-document-editor-handle'
import type { WriteEditorSelectionState } from '../write-markdown-editor-types'

export const WRITE_SELECTION_REVIEW_ENABLED = true

type Options = {
  documentKey: string
  filePath: string
  workspaceRoot: string
  fileContent: string
  selection: WriteEditorSelectionState
  readOnly: boolean
  model?: string
  recentEdits: WriteRecentEdit[]
  getHandle: () => WriteDocumentReviewHandle | null
  getEditContent: () => string
  setSelection: (selection: WriteEditorSelectionState) => void
  setError: (error: string | null) => void
  toChat: (instruction: string, selection: WriteEditorSelectionState) => void
  onReviewInvalidated?: () => void
  recordEdits: (edits: WriteRecentEdit[]) => void
}
export type SelectionEditInput = { instruction: string; label?: string; source?: SelectionEditSession['source'] }

export function useSelectionEdit(options: Options) {
  const { t } = useTranslation('common')
  const [store] = useState(createSelectionEditStore)
  const session = useStore(store, (state) => state.session)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const ownerCleanupRef = useRef<(() => void) | undefined>(undefined)
  const ownerRef = useRef<WriteDocumentReviewHandle | null>(null)
  const [applied, setApplied] = useState<{ documentKey: string; content: string | null; handle: WriteDocumentReviewHandle } | null>(null)

  const clear = (): void => {
    store.getState().clear()
    ownerRef.current?.setSelectionHold(null)
  }
  useEffect(() => () => {
    // Keep the old handle: a file/surface switch must not reject the newly mounted editor's review.
    const pending = store.getState().session
    store.getState().clear()
    ownerRef.current?.setSelectionHold(null)
    if (pending?.phase === 'review') {
      ownerRef.current?.rejectAllDiff()
      ownerCleanupRef.current?.()
    }
    ownerRef.current = null
  }, [options.documentKey, store])

  const run = async (input: SelectionEditInput, previous?: SelectionEditSession): Promise<void> => {
    const current = optionsRef.current, instruction = input.instruction.trim()
    const selection = previous?.selection ?? current.selection
    const handle = current.getHandle()
    if (!instruction || store.getState().session || !current.filePath) return
    if (current.readOnly) { current.toChat(instruction, selection); return }
    if (!WRITE_SELECTION_REVIEW_ENABLED) { current.toChat(instruction, selection); return }
    if (!handle || handle.isDiffReviewActive()) { current.setError(t('writeInlineEditReviewPending')); return }
    if (selection.ranges.length !== 1) {
      current.setError(t(selection.ranges.length ? 'writeInlineEditMultiSelection' : 'writeInlineEditNoSelection')); return
    }
    if (typeof window.kunGui?.requestWriteInlineCompletion !== 'function') { current.setError(t('writeInlineEditUnavailable')); return }
    const range = selection.ranges[0], editContent = current.getEditContent()
    if (editContent.slice(range.from, range.to) !== range.text) { current.setError(t('writeInlineEditChanged')); return }
    const baseline = previous?.baseline ?? current.fileContent
    if (baseline !== current.fileContent) { current.setError(t('writeInlineEditChanged')); return }
    const token = store.getState().begin({
      documentKey: current.documentKey, baseline, selection, instruction,
      source: input.source ?? previous?.source ?? { kind: 'typed' }, label: input.label ?? previous?.label ?? t('writeEditLabelCustom')
    })
    ownerRef.current = handle
    ownerCleanupRef.current = current.onReviewInvalidated
    setApplied(null)
    current.setError(null)
    handle.setSelectionHold(range)
    const draft = buildWriteInlineEditDraft(editContent, range, instruction, {
      workspaceRoot: current.workspaceRoot, currentFilePath: current.filePath, model: current.model,
      recentEdits: current.recentEdits, language: 'markdown'
    })
    const valid = (): boolean => store.getState().token === token &&
      optionsRef.current.documentKey === current.documentKey && current.getHandle() === handle
    const fail = (message: string): void => {
      if (!valid()) return
      clear(); optionsRef.current.setError(message)
      if (optionsRef.current.fileContent === baseline) {
        handle.restoreSelection(range); optionsRef.current.setSelection(selection)
      }
    }
    try {
      const result = await window.kunGui.requestWriteInlineCompletion(buildWriteInlineEditCompletionRequest(draft.request))
      if (!valid()) return
      if (!result.ok) { fail(t('writeInlineEditFailed', { message: result.message })); return }
      const replacement = result.action?.kind === 'edit' ? result.action.replacement : result.completion
      if (!replacement.trim() || /<<<(?:EDIT|SHORT|LONG|PREFIX|SUFFIX)|>>>/.test(replacement)) { fail(t('writeInlineEditEmpty')); return }
      if (optionsRef.current.fileContent !== baseline || current.getEditContent() !== editContent) { fail(t('writeInlineEditChanged')); return }
      if (replacement === draft.scope.text) { fail(t('writeEditUnchanged')); return }
      handle.setSelectionHold(null)
      const review = handle.beginSelectionReview({ range, original: range.text, replacement, instruction })
      if (!review) { fail(t('writeInlineEditChanged')); return }
      store.getState().result(token, replacement, review.hunks)
      optionsRef.current.setSelection({ text: '', ranges: [], charCount: 0 })
    } catch (error) { fail(t('writeInlineEditFailed', { message: error instanceof Error ? error.message : String(error) })) }
  }
  const reject = (): void => {
    const pending = store.getState().session
    if (!pending || pending.documentKey !== optionsRef.current.documentKey) return
    ownerRef.current?.rejectAllDiff(); clear()
    optionsRef.current.setSelection({ text: '', ranges: [], charCount: 0 })
  }
  const stop = (): void => {
    const pending = store.getState().session
    if (!pending || pending.documentKey !== optionsRef.current.documentKey) return
    clear()
    if (optionsRef.current.fileContent === pending.baseline) {
      ownerRef.current?.restoreSelection(pending.selection.ranges[0])
      optionsRef.current.setSelection(pending.selection)
    }
  }
  const retry = (followUp?: string): void => {
    const pending = store.getState().session
    if (!pending || pending.phase !== 'review' || pending.documentKey !== optionsRef.current.documentKey) return
    const instruction = followUp?.trim() ? `${pending.instruction}\n\n${t('writeEditFollowUpPrompt', { proposed: pending.proposed, instruction: followUp.trim() })}` : pending.instruction
    ownerRef.current?.rejectAllDiff(); clear()
    void run({ instruction }, pending)
  }
  const accept = (): void => {
    const pending = store.getState().session, handle = ownerRef.current, current = optionsRef.current
    if (!pending || pending.phase !== 'review' || !handle || pending.documentKey !== current.documentKey) return
    handle.acceptAllDiff(); clear()
    const range = pending.selection.ranges[0]
    const record = createWriteRecentEdit({ source: 'inline-edit', filePath: current.filePath,
      from: range.from, to: range.to, deletedText: range.text, insertedText: pending.proposed ?? '',
      beforeContext: '', afterContext: '', instruction: pending.instruction, scopeKind: 'selection' })
    if (record) current.recordEdits([record])
    current.setSelection({ text: '', ranges: [], charCount: 0 })
    handle.getElement()?.focus()
    // onChange is synchronous in the editor; the controlled prop catches up on the next render.
    setApplied({ documentKey: current.documentKey, content: null, handle })
  }
  useEffect(() => {
    if (!applied) return
    if (applied.documentKey !== options.documentKey) { setApplied(null); return }
    if (applied.content === null) { setApplied({ ...applied, content: options.fileContent }); return }
    if (applied.content !== options.fileContent) setApplied(null)
  }, [applied, options.documentKey, options.fileContent])
  return { session, start: run, stop, reject, retry, followUp: retry, accept, applied: Boolean(applied),
    dismissToast: () => setApplied(null), undo: () => { applied?.handle.undoLast(); setApplied(null) },
    getHandle: () => ownerRef.current,
    toChat: () => {
      const pending = store.getState().session
      if (!pending || pending.documentKey !== optionsRef.current.documentKey) return
      reject(); optionsRef.current.toChat(pending.instruction, pending.selection)
    }
  }
}
export type SelectionEditController = ReturnType<typeof useSelectionEdit>
