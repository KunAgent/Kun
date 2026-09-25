import { useCallback, useRef, useState, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import type { PaperRect } from '@shared/paper/paper-marks-types'
import { PAPER_TEXT_FILE_NAME } from '@shared/paper/paper-types'
import type { PageText } from '../../write/WritePdfPage'
import { useWriteWorkspaceStore, writeJoinPath } from '../../../write/write-workspace-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { translatePaperDocument } from '../../../paper/paper-translate-actions'
import { confirmDialog } from '../../../lib/confirm-dialog'

export type PaperTranslateCardRequest = {
  page: number
  rects: PaperRect[]
  text: string
}

export type PaperTranslateCardState = {
  anchor: { x: number; y: number }
  quote: string
  translation: string
  model?: string
  loading: boolean
  error: string | null
  /** IPC error code — 'config' offers an in-card settings shortcut. */
  errorCode?: string
  /** Original request, kept so the settings dialog can retry it. */
  request: PaperTranslateCardRequest
}

export type PaperTranslateNotice = {
  message: string
  /** True when the failure was 'config' — the pill gains a configure button. */
  config: boolean
}

/**
 * Reader translation flows (plan §6.5): selection/page requests render in a
 * floating card; whole-document runs as a `translate-document` paper job with
 * a bottom notice. `config` failures park a retry in `translateRetryRef` so
 * the settings dialog can rerun the exact request after the user saves a
 * provider/model.
 */
export function usePaperReaderTranslate({
  t,
  unitRelDir,
  workspaceRoot,
  pageTexts,
  rootRef
}: {
  t: TFunction
  unitRelDir: string
  workspaceRoot: string
  pageTexts: PageText[]
  rootRef: RefObject<HTMLElement | null>
}) {
  const [card, setCard] = useState<PaperTranslateCardState | null>(null)
  const [notice, setNotice] = useState<PaperTranslateNotice | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const translateRequestRef = useRef('')
  const translateRetryRef = useRef<(() => void) | null>(null)
  const translateJob = usePaperStore((s) => s.busy['translate-document'])

  const runCardRequest = useCallback(async (
    anchor: { x: number; y: number },
    quote: string,
    request: PaperTranslateCardRequest
  ): Promise<void> => {
    setCard({ anchor, quote, translation: '', loading: true, error: null, request })
    const { translatePaperSelection } = await import('../../../paper/paper-translate-actions')
    const result = await translatePaperSelection({
      unitDir: unitRelDir,
      page: request.page,
      rects: request.rects,
      text: request.text
    })
    if (!result.ok && result.code === 'config') {
      translateRetryRef.current = () => void runCardRequest(anchor, quote, request)
    }
    setCard((current) => current && current.loading ? {
      ...current,
      loading: false,
      translation: result.ok ? result.translation : '',
      error: result.ok
        ? null
        : result.code === 'config' ? t('writePaperTranslateNoModel') : result.message,
      errorCode: result.ok ? undefined : result.code
    } : current)
  }, [unitRelDir, t])

  // Page-edge 「译」 rail: translate the loaded text of a single page.
  const runPageTranslate = useCallback((page: number): void => {
    const text = pageTexts.find((item) => item.page === page)?.text ?? ''
    if (!text.trim()) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-write-pdf-page="${page}"]`)
    const bounds = el?.getBoundingClientRect()
    const anchor = bounds
      ? { x: bounds.right - 24, y: bounds.top + bounds.height / 2 }
      : { x: 0, y: 0 }
    void runCardRequest(anchor, text.slice(0, 240), {
      page,
      rects: [],
      text: text.slice(0, 8000)
    })
  }, [pageTexts, rootRef, runCardRequest])

  const readPaperTextChars = useCallback(async (): Promise<number> => {
    try {
      const read = await window.kunGui.readWorkspaceFile({
        workspaceRoot,
        path: writeJoinPath(unitRelDir, PAPER_TEXT_FILE_NAME)
      })
      return read.ok ? read.content.length : 0
    } catch {
      return 0
    }
  }, [workspaceRoot, unitRelDir])

  const executeDocumentTranslate = useCallback(async (): Promise<void> => {
    const requestId = `translate-doc-${Date.now().toString(36)}`
    translateRequestRef.current = requestId
    usePaperStore.getState().beginJob('translate-document', requestId)
    try {
      const result = await translatePaperDocument({ unitDir: unitRelDir, requestId })
      if (!result.ok) {
        const config = result.code === 'config'
        // Config failures keep a retry so the settings dialog can rerun the
        // job immediately after the user picks a model.
        translateRetryRef.current = config ? () => void executeDocumentTranslate() : null
        setNotice({
          message: config ? t('writePaperTranslateNoModel') : result.message,
          config
        })
        return
      }
      setNotice({ message: result.outputPath, config: false })
      // Open the translated markdown in the right editor group (plan §6.5).
      const root = useWriteWorkspaceStore.getState().workspaceRoot
      if (root) {
        await useWriteWorkspaceStore.getState().openFile(
          root,
          writeJoinPath(writeJoinPath(root, unitRelDir), result.outputPath),
          { groupId: 'secondary', viewMode: 'rich' }
        )
      }
    } finally {
      usePaperStore.getState().endJob(requestId)
    }
  }, [unitRelDir, t])

  const runDocumentTranslate = useCallback(async (): Promise<void> => {
    setNotice(null)
    let chars = await readPaperTextChars()
    if (!chars) {
      // Whole-document translation reads paper.md — produce it on demand
      // (same auto-preprocess path as interpretPaper) instead of dead-ending.
      const settings = useWriteWorkspaceStore.getState().paperReading
      const allowed = settings.autoPreprocess
        ? true
        : await confirmDialog(t('writePaperReaderTranslateNeedsPreprocess'))
      if (!allowed) {
        setNotice({ message: t('writePaperReaderTranslateNoText'), config: false })
        return
      }
      const { preprocessPaper } = await import('../../../write/paper/paper-actions')
      if (!(await preprocessPaper({ workspaceRoot, settings, t, unitDir: unitRelDir }))) return
      chars = await readPaperTextChars()
      if (!chars) {
        setNotice({ message: t('writePaperReaderTranslateNoText'), config: false })
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
  }, [workspaceRoot, unitRelDir, t, readPaperTextChars, executeDocumentTranslate])

  const cancelDocumentTranslate = useCallback((): void => {
    if (translateRequestRef.current) {
      void window.kunGui?.paperCancel?.({ requestId: translateRequestRef.current })
    }
  }, [])

  const openSettings = useCallback((): void => setSettingsOpen(true), [])
  const closeSettings = useCallback((): void => setSettingsOpen(false), [])
  const onSettingsSaved = useCallback((): void => {
    const retry = translateRetryRef.current
    translateRetryRef.current = null
    retry?.()
  }, [])

  return {
    card,
    closeCard: () => setCard(null),
    notice,
    setNotice,
    settingsOpen,
    openSettings,
    closeSettings,
    onSettingsSaved,
    runCardRequest,
    runPageTranslate,
    runDocumentTranslate,
    cancelDocumentTranslate,
    translateJob
  }
}
