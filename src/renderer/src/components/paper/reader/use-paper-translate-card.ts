import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { PAPER_TEXT_FILE_NAME } from '@shared/paper/paper-types'
import { useWriteWorkspaceStore, writeJoinPath } from '../../../write/write-workspace-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { usePaperMarksStore } from '../../../paper/paper-marks-store'
import { translatePaperDocument } from '../../../paper/paper-translate-actions'
import { confirmDialog } from '../../../lib/confirm-dialog'
import { paperUnitSlugFromDir } from '../../../write/paper/paper-unit'
import type { PendingPaperSelection } from './use-paper-selection'

export type PaperTranslateCardState = {
  anchor: { x: number; y: number }
  quote: string
  translation: string
  model?: string
  loading: boolean
  error: string | null
  /**
   * R1.3: auto-collapsed to a small 「译」 chip after 700ms without hover
   * (never while streaming). Clicking the chip reopens the same card.
   */
  collapsed: boolean
}

const TRANSLATE_CARD_AUTO_COLLAPSE_MS = 700

/**
 * Reader translation state (R0): the floating translate card beside a
 * selection or page, the bottom toast notices, whole-document translation
 * (with on-demand preprocessing), cancel, and annotations export.
 */
export function usePaperTranslateCard({
  unitDir,
  workspaceRoot,
  t
}: {
  unitDir: string
  workspaceRoot: string
  t: TFunction
}): {
  translateCard: PaperTranslateCardState | null
  setTranslateCard: (card: PaperTranslateCardState | null) => void
  translateNotice: string
  setTranslateNotice: (notice: string) => void
  setTranslateCardHovered: (hovered: boolean) => void
  reopenTranslateCard: () => void
  runSelectionTranslate: (sel: PendingPaperSelection) => Promise<void>
  runDocumentTranslate: () => Promise<void>
  cancelDocumentTranslate: () => void
  exportAnnotations: () => Promise<void>
} {
  const [translateCard, setTranslateCard] = useState<PaperTranslateCardState | null>(null)
  const [translateNotice, setTranslateNotice] = useState('')
  const [cardHovered, setCardHovered] = useState(false)
  const translateRequestRef = useRef('')

  // R1.3: once the translation resolves, a card nobody hovers folds down to
  // the mini chip after 700ms; streaming never collapses.
  useEffect(() => {
    if (!translateCard || translateCard.loading || translateCard.collapsed || cardHovered) {
      return
    }
    const timer = window.setTimeout(() => {
      setTranslateCard((card) => (card ? { ...card, collapsed: true } : card))
    }, TRANSLATE_CARD_AUTO_COLLAPSE_MS)
    return () => window.clearTimeout(timer)
  }, [translateCard, cardHovered])

  const setTranslateCardHovered = useCallback((hovered: boolean): void => {
    setCardHovered(hovered)
  }, [])

  const reopenTranslateCard = useCallback((): void => {
    setTranslateCard((card) => (card ? { ...card, collapsed: false } : card))
  }, [])

  // Selection translation → floating card beside the anchor. The mark card is
  // persisted by translatePaperSelection itself.
  const runSelectionTranslate = useCallback(async (sel: PendingPaperSelection): Promise<void> => {
    window.getSelection()?.removeAllRanges()
    setTranslateCard({
      anchor: sel.anchor,
      quote: sel.text,
      translation: '',
      loading: true,
      error: null,
      collapsed: false
    })
    const { translatePaperSelection } = await import('../../../paper/paper-translate-actions')
    const result = await translatePaperSelection({
      unitDir,
      page: sel.page,
      rects: sel.rects,
      text: sel.text
    })
    setTranslateCard((card) => card && card.loading ? {
      ...card,
      loading: false,
      translation: result.ok ? result.translation : '',
      error: result.ok ? null : result.message
    } : card)
  }, [unitDir])

  const readPaperTextChars = useCallback(async (): Promise<number> => {
    try {
      const read = await window.kunGui.readWorkspaceFile({
        workspaceRoot,
        path: writeJoinPath(unitDir, PAPER_TEXT_FILE_NAME)
      })
      return read.ok ? read.content.length : 0
    } catch {
      return 0
    }
  }, [workspaceRoot, unitDir])

  const runDocumentTranslate = useCallback(async (): Promise<void> => {
    setTranslateNotice('')
    let chars = await readPaperTextChars()
    if (!chars) {
      // Whole-document translation reads paper.md — produce it on demand
      // (same auto-preprocess path as interpretPaper) instead of dead-ending.
      const settings = useWriteWorkspaceStore.getState().paperReading
      const allowed = settings.autoPreprocess
        ? true
        : await confirmDialog(t('writePaperReaderTranslateNeedsPreprocess'))
      if (!allowed) {
        setTranslateNotice(t('writePaperReaderTranslateNoText'))
        return
      }
      const { preprocessPaper } = await import('../../../write/paper/paper-actions')
      if (!(await preprocessPaper({ workspaceRoot, settings, t, unitDir }))) return
      chars = await readPaperTextChars()
      if (!chars) {
        setTranslateNotice(t('writePaperReaderTranslateNoText'))
        return
      }
    }
    const confirmed = await confirmDialog(
      t('writePaperReaderTranslateConfirm', {
        chars,
        tokens: Math.ceil(chars / 4)
      })
    )
    if (!confirmed) return

    const requestId = `translate-doc-${Date.now().toString(36)}`
    translateRequestRef.current = requestId
    usePaperStore.getState().beginJob('translate-document', requestId)
    try {
      const result = await translatePaperDocument({ unitDir, requestId })
      if (!result.ok) {
        setTranslateNotice(result.message)
        return
      }
      setTranslateNotice(result.outputPath)
      // Open the translated markdown in the right editor group (plan §6.5).
      const root = useWriteWorkspaceStore.getState().workspaceRoot
      if (root) {
        await useWriteWorkspaceStore.getState().openFile(
          root,
          writeJoinPath(writeJoinPath(root, unitDir), result.outputPath),
          { groupId: 'secondary', viewMode: 'rich' }
        )
      }
    } finally {
      usePaperStore.getState().endJob(requestId)
    }
  }, [readPaperTextChars, t, unitDir, workspaceRoot])

  const cancelDocumentTranslate = useCallback((): void => {
    if (translateRequestRef.current) {
      void window.kunGui?.paperCancel?.({ requestId: translateRequestRef.current })
    }
  }, [])

  const exportAnnotations = useCallback(async (): Promise<void> => {
    const { items, cards } = usePaperMarksStore.getState()
    if (items.length === 0 && Object.keys(cards).length === 0) return
    const { appendPaperNotes } = await import('../../../paper/paper-notes-append')
    const notesPath = `${unitDir}/${paperUnitSlugFromDir(unitDir)}-NOTES.md`
    await appendPaperNotes({ workspaceRoot, notesPath, items, cards })
    setTranslateNotice(t('writePaperReaderNotesExported'))
  }, [unitDir, workspaceRoot, t])

  return {
    translateCard,
    setTranslateCard,
    translateNotice,
    setTranslateNotice,
    setTranslateCardHovered,
    reopenTranslateCard,
    runSelectionTranslate,
    runDocumentTranslate,
    cancelDocumentTranslate,
    exportAnnotations
  }
}
