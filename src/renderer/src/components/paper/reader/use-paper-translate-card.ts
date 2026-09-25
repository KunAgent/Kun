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
  /** IPC error code — 'config' offers an in-card settings shortcut. */
  errorCode?: string
  /**
   * R1.3: auto-collapsed to a small 「译」 chip after 700ms without hover
   * (never while streaming). Clicking the chip reopens the same card.
   */
  collapsed: boolean
}

export type PaperTranslateNotice = {
  message: string
  /** True when the failure was 'config' — the pill gains a configure button. */
  config: boolean
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
  translateNotice: PaperTranslateNotice | null
  setTranslateNotice: (notice: PaperTranslateNotice | null) => void
  setTranslateCardHovered: (hovered: boolean) => void
  reopenTranslateCard: () => void
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  onSettingsSaved: () => void
  runSelectionTranslate: (sel: PendingPaperSelection) => Promise<void>
  runDocumentTranslate: () => Promise<void>
  cancelDocumentTranslate: () => void
  exportAnnotations: () => Promise<void>
} {
  const [translateCard, setTranslateCard] = useState<PaperTranslateCardState | null>(null)
  const [translateNotice, setTranslateNotice] = useState<PaperTranslateNotice | null>(null)
  const [cardHovered, setCardHovered] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const translateRequestRef = useRef('')
  /** Retried after the settings dialog saves a provider/model. */
  const translateRetryRef = useRef<(() => void) | null>(null)

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
    // Config failures park a retry so the settings dialog can rerun the exact
    // request immediately after the user picks a provider/model.
    translateRetryRef.current = !result.ok && result.code === 'config'
      ? () => void runSelectionTranslate(sel)
      : null
    setTranslateCard((card) => card && card.loading ? {
      ...card,
      loading: false,
      translation: result.ok ? result.translation : '',
      error: result.ok
        ? null
        : result.code === 'config' ? t('writePaperTranslateNoModel') : result.message,
      errorCode: result.ok ? undefined : result.code
    } : card)
  }, [unitDir, t])

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

  const executeDocumentTranslate = useCallback(async (): Promise<void> => {
    const requestId = `translate-doc-${Date.now().toString(36)}`
    translateRequestRef.current = requestId
    usePaperStore.getState().beginJob('translate-document', requestId)
    try {
      const result = await translatePaperDocument({ unitDir, requestId })
      if (!result.ok) {
        const config = result.code === 'config'
        translateRetryRef.current = config ? () => void executeDocumentTranslate() : null
        setTranslateNotice({
          message: config ? t('writePaperTranslateNoModel') : result.message,
          config
        })
        return
      }
      setTranslateNotice({ message: result.outputPath, config: false })
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
  }, [unitDir, t])

  const runDocumentTranslate = useCallback(async (): Promise<void> => {
    setTranslateNotice(null)
    let chars = await readPaperTextChars()
    if (!chars) {
      // Whole-document translation reads paper.md — produce it on demand
      // (same auto-preprocess path as interpretPaper) instead of dead-ending.
      const settings = useWriteWorkspaceStore.getState().paperReading
      const allowed = settings.autoPreprocess
        ? true
        : await confirmDialog(t('writePaperReaderTranslateNeedsPreprocess'))
      if (!allowed) {
        setTranslateNotice({ message: t('writePaperReaderTranslateNoText'), config: false })
        return
      }
      const { preprocessPaper } = await import('../../../write/paper/paper-actions')
      if (!(await preprocessPaper({ workspaceRoot, settings, t, unitDir }))) return
      chars = await readPaperTextChars()
      if (!chars) {
        setTranslateNotice({ message: t('writePaperReaderTranslateNoText'), config: false })
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
    await executeDocumentTranslate()
  }, [readPaperTextChars, t, unitDir, workspaceRoot, executeDocumentTranslate])

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
    setTranslateNotice({ message: t('writePaperReaderNotesExported'), config: false })
  }, [unitDir, workspaceRoot, t])

  const openSettings = useCallback((): void => setSettingsOpen(true), [])
  const closeSettings = useCallback((): void => setSettingsOpen(false), [])
  const onSettingsSaved = useCallback((): void => {
    const retry = translateRetryRef.current
    translateRetryRef.current = null
    retry?.()
  }, [])

  return {
    translateCard,
    setTranslateCard,
    translateNotice,
    setTranslateNotice,
    setTranslateCardHovered,
    reopenTranslateCard,
    settingsOpen,
    openSettings,
    closeSettings,
    onSettingsSaved,
    runSelectionTranslate,
    runDocumentTranslate,
    cancelDocumentTranslate,
    exportAnnotations
  }
}
