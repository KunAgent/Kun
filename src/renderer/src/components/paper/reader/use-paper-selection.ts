import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  WriteEditorSelectionState,
  WriteSelectionPageRect
} from '../../write/write-markdown-editor-types'
import type { PaperHighlightColor, PaperRect } from '@shared/paper/paper-marks-types'
import { emptyPdfSelection, selectionFromPdf } from '../../write/WritePdfPage'
import {
  nextPaperMarkId,
  usePaperMarksStore,
  newPaperHighlight
} from '../../../paper/paper-marks-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'

export type PendingPaperSelection = {
  text: string
  page: number
  /** Normalized 0..1 rects for marks persistence. */
  rects: PaperRect[]
  /** Page-local px rects for the overlay while the popup is open. */
  localRects: WriteSelectionPageRect[]
  /** Anchor position for the floating menu (viewport coords). */
  anchor: { x: number; y: number }
}

/**
 * Reader selection state (R0): captures the PDF text selection once the drag
 * ends, converts it to normalized mark rects, and owns the pending selection
 * driving the floating menu / ask popover. Esc, scroll/drag, or an explicit
 * close clears it. Also publishes the raw selection upstream for the
 * composer quote pipeline.
 */
export function usePaperSelection({
  rootRef,
  workspaceRoot,
  onSelectionChange,
  onAutoTranslate
}: {
  rootRef: RefObject<HTMLElement | null>
  workspaceRoot: string
  onSelectionChange: ((selection: WriteEditorSelectionState) => void) | undefined
  /** R1.3: fired 250ms after a stable selection when auto-translate is on. */
  onAutoTranslate?: (sel: PendingPaperSelection) => void
}): {
  pending: PendingPaperSelection | null
  askOpen: boolean
  setAskOpen: (open: boolean) => void
  selectionRects: WriteSelectionPageRect[]
  publishSelection: (selection: WriteEditorSelectionState) => void
  captureSelectionSoon: () => void
  beginDrag: () => void
  endDrag: () => void
  clearPendingSelection: () => void
  addHighlight: (color: PaperHighlightColor, comment?: string) => void
  addToConversation: () => void
  submitQuickAsk: (question: string) => void
  dismissPending: () => void
} {
  const [pending, setPending] = useState<PendingPaperSelection | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [selectionRects, setSelectionRects] = useState<WriteSelectionPageRect[]>([])
  const selectionTimerRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const autoTranslateTimerRef = useRef<number | null>(null)
  const autoTranslateKeyRef = useRef('')
  const autoTranslateRef = useRef(onAutoTranslate)
  autoTranslateRef.current = onAutoTranslate

  // Stable selection publisher — the document hook reloads when it changes.
  const selectionCallbackRef = useRef(onSelectionChange)
  selectionCallbackRef.current = onSelectionChange
  const publishSelection = useCallback((selection: WriteEditorSelectionState): void => {
    selectionCallbackRef.current?.(selection)
  }, [])

  const dismissPending = useCallback((): void => setPending(null), [])

  // Selection → normalized mark rects. Local px rects normalize against the
  // page element's rendered size so zoom never shifts stored geometry.
  const captureSelection = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const next = selectionFromPdf(root)
    publishSelection(next)
    const rects = next.rects ?? []
    if (!next.text.trim() || rects.length === 0) {
      setSelectionRects([])
      return
    }
    setSelectionRects(rects)
    const anchorRect = next.anchorRect
    const anchor = anchorRect
      ? { x: anchorRect.left, y: anchorRect.bottom }
      : { x: 0, y: 0 }
    const normalized = rects.flatMap((rect): PaperRect[] => {
      const el = root.querySelector<HTMLElement>(`[data-write-pdf-page="${rect.page}"]`)
      const w = el?.offsetWidth ?? 0
      const h = el?.offsetHeight ?? 0
      if (!w || !h) return []
      return [[
        Math.min(1, Math.max(0, rect.x / w)),
        Math.min(1, Math.max(0, rect.y / h)),
        Math.min(1, Math.max(0, rect.width / w)),
        Math.min(1, Math.max(0, rect.height / h))
      ]]
    })
    if (normalized.length === 0) return
    // Show the floating menu only once the drag ends, not mid-selection.
    if (draggingRef.current) return
    const first = rects[0]
    const sel: PendingPaperSelection = {
      text: next.text,
      page: first?.page ?? next.pageStart ?? 1,
      rects: normalized,
      localRects: rects,
      anchor
    }
    setPending(sel)

    // R1.3 auto-translate: once the selection is stable for 250ms and the
    // text is short enough (2–2000 chars), fire the translate card without
    // waiting for the menu. Same page+text never fires twice.
    if (autoTranslateTimerRef.current != null) {
      window.clearTimeout(autoTranslateTimerRef.current)
      autoTranslateTimerRef.current = null
    }
    const length = sel.text.trim().length
    if (autoTranslateRef.current && length >= 2 && length <= 2000) {
      const key = `${sel.page}:${sel.text}`
      if (key !== autoTranslateKeyRef.current) {
        autoTranslateTimerRef.current = window.setTimeout(() => {
          autoTranslateTimerRef.current = null
          autoTranslateKeyRef.current = key
          // The translate card replaces the selection menu.
          setPending(null)
          setAskOpen(false)
          autoTranslateRef.current?.(sel)
        }, 250)
      }
    }
  }, [publishSelection, rootRef])

  const captureSelectionSoon = useCallback((): void => {
    if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = window.setTimeout(captureSelection, 0)
  }, [captureSelection])

  useEffect(() => {
    const onDocSelection = (): void => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root || !selection || selection.rangeCount === 0) return
      const inside = [selection.anchorNode, selection.focusNode].some(
        (node) => node && root.contains(node)
      )
      if (inside) captureSelectionSoon()
    }
    window.document.addEventListener('selectionchange', onDocSelection)
    return () => {
      window.document.removeEventListener('selectionchange', onDocSelection)
      if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current)
      if (autoTranslateTimerRef.current != null) window.clearTimeout(autoTranslateTimerRef.current)
    }
  }, [captureSelectionSoon, rootRef])

  const clearPendingSelection = useCallback((): void => {
    if (autoTranslateTimerRef.current != null) {
      window.clearTimeout(autoTranslateTimerRef.current)
      autoTranslateTimerRef.current = null
    }
    setPending(null)
    setAskOpen(false)
    setSelectionRects([])
    window.getSelection()?.removeAllRanges()
    publishSelection(emptyPdfSelection())
  }, [publishSelection])

  // Esc clears an open selection popup.
  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clearPendingSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, clearPendingSelection])

  const beginDrag = useCallback((): void => {
    draggingRef.current = true
    if (autoTranslateTimerRef.current != null) {
      window.clearTimeout(autoTranslateTimerRef.current)
      autoTranslateTimerRef.current = null
    }
    setPending(null)
    setAskOpen(false)
    setSelectionRects([])
  }, [])

  const endDrag = useCallback((): void => {
    draggingRef.current = false
    captureSelectionSoon()
  }, [captureSelectionSoon])

  const addHighlight = useCallback((color: PaperHighlightColor, comment?: string): void => {
    if (!pending) return
    const mark = newPaperHighlight({
      color,
      page: pending.page,
      rects: pending.rects,
      quote: pending.text
    })
    if (comment) mark.comment = comment
    usePaperMarksStore.setState((s) => ({ items: [...s.items, mark], dirty: true }))
    clearPendingSelection()
  }, [pending, clearPendingSelection])

  // 「加入对话」: convert the published selection into a composer quote chip
  // (opens the assistant panel as a side effect).
  const addToConversation = useCallback((): void => {
    useWriteWorkspaceStore.getState().quoteCurrentSelection(workspaceRoot)
    setPending(null)
    setAskOpen(false)
  }, [workspaceRoot])

  // Quick ask: persist an `ask` mark card, quote the passage, submit the
  // question to the paper-scoped thread.
  const submitQuickAsk = useCallback((question: string): void => {
    const sel = pending
    if (!sel) return
    const markId = nextPaperMarkId()
    usePaperMarksStore.setState((s) => ({
      dirty: true,
      cards: {
        ...s.cards,
        [markId]: {
          id: markId,
          kind: 'ask',
          page: sel.page,
          rects: sel.rects,
          quote: sel.text.slice(0, 8000),
          question,
          createdAt: new Date().toISOString()
        }
      }
    }))
    useWriteWorkspaceStore.getState().quoteCurrentSelection(workspaceRoot)
    const bridge = usePaperModeStore.getState().composerBridge
    if (bridge?.submit) bridge.submit(question)
    else bridge?.setInput(question)
  }, [pending, workspaceRoot])

  return {
    pending,
    askOpen,
    setAskOpen,
    selectionRects,
    publishSelection,
    captureSelectionSoon,
    beginDrag,
    endDrag,
    clearPendingSelection,
    addHighlight,
    addToConversation,
    submitQuickAsk,
    dismissPending
  }
}
