import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WritePdfRendererProps } from '../../write/write-pdf-renderer-context'
import { WritePdfViewer } from '../../write/WritePdfViewer'
import { WritePdfPage, emptyPdfSelection, selectionFromPdf } from '../../write/WritePdfPage'
import { useWritePdfDocument } from '../../write/use-write-pdf-document'
import { useWritePdfNavigation } from '../../write/use-write-pdf-navigation'
import type {
  WriteEditorSelectionState,
  WriteSelectionPageRect
} from '../../write/write-markdown-editor-types'
import type { PaperHighlight, PaperRect } from '@shared/paper/paper-marks-types'
import type { WritePaperModeReaderSettingsV1 } from '@shared/app-settings-types-paper-mode'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { openPaperViewTab } from '../../../paper/paper-view'
import {
  nextPaperMarkId,
  usePaperMarksStore,
  newPaperHighlight,
  removePaperHighlight
} from '../../../paper/paper-marks-store'
import { usePaperMarks } from '../../../paper/use-paper-marks'
import {
  findPaperUnitDir,
  paperUnitDirFromKnownUnits,
  paperUnitDirForFile,
  paperUnitSlugFromDir
} from '../../../write/paper/paper-unit'
import { usePaperStore } from '../../../write/paper/paper-store'
import {
  paperReaderAutoMarkReading,
  paperReaderRecordOpened,
  paperReaderRecordPage
} from '../../../paper/paper-reader-actions'
import { rendererRuntimeClient } from '../../../agent/runtime-client'
import { PaperPageMarksLayer } from './PaperPageMarksLayer'
import { PaperSelectionMenu } from './PaperSelectionMenu'
import { PaperReaderDrawer } from './PaperReaderDrawer'
import { PaperFloatingControls } from './PaperFloatingControls'
import { PaperTranslateCard } from './PaperTranslateCard'
import { PaperTranslateSettingsDialog } from './PaperTranslateSettingsDialog'
import { usePaperReaderTranslate } from './usePaperReaderTranslate'
import { PaperAskPopover } from './PaperAskPopover'
import { PaperCommentGutter } from './PaperCommentGutter'

const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
type PaperTone = WritePaperModeReaderSettingsV1['paperTone']

type PendingSelection = {
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
 * Paper-mode PDF reader (U1/U2): WritePdfViewer's document/navigation stack
 * with floating chrome instead of fixed bars — a top-right control pill, a
 * bottom-center page/tone capsule, per-page translate rails, a comment
 * gutter, and selection-adjacent translate/ask cards.
 */
export function PaperPdfReader(props: WritePdfRendererProps): ReactElement {
  const { filePath, workspaceRoot } = props
  const entriesByDir = useWriteWorkspaceStore((s) => s.entriesByDir)
  const entries = usePaperModeStore((s) => s.entries)
  const knownUnits = usePaperStore((s) => s.unitsByDir)
  const unitDirAbs = useMemo(() => {
    return (
      findUnitDir(
        filePath,
        workspaceRoot,
        entriesByDir,
        entries.map((e) => e.unitDir),
        Object.keys(knownUnits)
      )
    )
  }, [filePath, workspaceRoot, entriesByDir, entries, knownUnits])
  if (!unitDirAbs) {
    return <WritePdfViewer {...props} />
  }
  return <PaperUnitPdfReader {...props} unitDirAbs={unitDirAbs} />
}

function findUnitDir(
  filePath: string,
  workspaceRoot: string,
  entriesByDir: Record<string, import('@shared/workspace-file').WorkspaceEntry[]>,
  libraryUnitDirs: readonly string[],
  knownUnitDirs: readonly string[]
): string | null {
  return (
    findPaperUnitDir(workspaceRoot, filePath, entriesByDir)
    ?? paperUnitDirFromKnownUnits(workspaceRoot, filePath, libraryUnitDirs)
    ?? paperUnitDirFromKnownUnits(workspaceRoot, filePath, knownUnitDirs)
  )
}

function PaperUnitPdfReader({
  filePath,
  dataBase64,
  mtimeMs,
  workspaceRoot,
  viewerRef,
  onSelectionChange,
  unitDirAbs
}: WritePdfRendererProps & { unitDirAbs: string }): ReactElement {
  const { t } = useTranslation('common')
  const unitRelDir = paperUnitDirForFile(unitDirAbs, workspaceRoot)
  const marks = usePaperMarksStore((s) => s.items)
  const marksCount = usePaperMarksStore((s) => s.items.length + Object.keys(s.cards).length)
  const entries = usePaperModeStore((s) => s.entries)
  const libraryEntry = entries.find((e) => e.unitDir === unitRelDir)
  const tone = useWriteWorkspaceStore((s) => s.paperMode.reader.paperTone)

  usePaperMarks(workspaceRoot, unitRelDir)

  const localRootRef = useRef<HTMLDivElement | null>(null)
  const rootRef = viewerRef ?? localRootRef
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1.15)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [selectionRects, setSelectionRects] = useState<WriteSelectionPageRect[]>([])
  const selectionTimerRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const [restoredPage, setRestoredPage] = useState<number | null>(null)

  // Stable selection publisher — the document hook reloads when it changes.
  const selectionCallbackRef = useRef(onSelectionChange)
  selectionCallbackRef.current = onSelectionChange
  const publishSelection = useCallback((selection: WriteEditorSelectionState): void => {
    selectionCallbackRef.current(selection)
  }, [])

  const {
    pdfDocument,
    loading,
    error,
    pageCount,
    pageTexts,
    allPageTextLoaded,
    pdfHasText,
    updatePageText
  } = useWritePdfDocument({
    filePath,
    dataBase64,
    mtimeMs,
    publishSelection
  })

  const {
    currentPage,
    pageInput,
    setPageInput,
    searchQuery,
    setSearchQuery,
    searchMatches,
    searchIndex,
    pageRefs,
    scrollToPage,
    schedulePageSync,
    jumpSearch
  } = useWritePdfNavigation({ filePath, pdfDocument, pageCount, pageTexts, scrollerRef })

  const {
    card: translateCard,
    closeCard,
    notice: translateNotice,
    setNotice: setTranslateNotice,
    settingsOpen: translateSettingsOpen,
    openSettings: openTranslateSettings,
    closeSettings: closeTranslateSettings,
    onSettingsSaved: onTranslateSettingsSaved,
    runCardRequest,
    runPageTranslate,
    runDocumentTranslate,
    cancelDocumentTranslate,
    translateJob
  } = usePaperReaderTranslate({ t, unitRelDir, workspaceRoot, pageTexts, rootRef })

  // Position memory: restore lastPage once the document is ready.
  useEffect(() => {
    if (!pdfDocument || restoredPage !== null) return
    setRestoredPage(-1)
    void paperReaderRecordOpened(unitRelDir)
    if (libraryEntry) void paperReaderAutoMarkReading(libraryEntry)
    if (typeof window.kunGui?.paperLocalStateRead !== 'function') return
    void window.kunGui.paperLocalStateRead({ libraryRoot: workspaceRoot }).then((state) => {
      const lastPage = state.units[unitRelDir]?.lastPage
      if (lastPage && lastPage > 1) scrollToPage(lastPage)
    }).catch(() => undefined)
  }, [pdfDocument, restoredPage, scrollToPage, unitRelDir, workspaceRoot, libraryEntry])

  // Persist page position (debounced through the record action).
  const lastRecordedPageRef = useRef(0)
  useEffect(() => {
    if (!currentPage || currentPage === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = currentPage
    const timer = window.setTimeout(() => {
      void paperReaderRecordPage(unitRelDir, currentPage, pageCount)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [currentPage, pageCount, unitRelDir])

  // Paper/page context for the assistant composer chip (U5).
  useEffect(() => {
    if (!currentPage) return
    usePaperModeStore.getState().setReaderPage({ unitDir: unitRelDir, page: currentPage, pageCount })
  }, [currentPage, pageCount, unitRelDir])
  useEffect(() => () => usePaperModeStore.getState().setReaderPage(null), [unitRelDir])

  // Paper tone is a scroller data attribute consumed by CSS.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.dataset.paperTone = tone
  }, [tone])

  const setTone = (next: PaperTone): void => {
    useWriteWorkspaceStore.setState((s) => ({
      paperMode: { ...s.paperMode, reader: { ...s.paperMode.reader, paperTone: next } }
    }))
    void rendererRuntimeClient
      .setSettings({ write: { paperMode: { reader: { paperTone: next } } } })
      .catch(() => undefined)
  }

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
    setPending({
      text: next.text,
      page: first?.page ?? next.pageStart ?? 1,
      rects: normalized,
      localRects: rects,
      anchor
    })
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
    }
  }, [captureSelectionSoon, rootRef])

  const clearPendingSelection = useCallback((): void => {
    setPending(null)
    setAskOpen(false)
    setSelectionRects([])
    window.getSelection()?.removeAllRanges()
    publishSelection(emptyPdfSelection())
  }, [publishSelection])

  const addHighlight = useCallback((color: (typeof HIGHLIGHT_COLORS)[number], comment?: string): void => {
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

  // Selection translation → floating card beside the anchor. The mark card
  // is persisted by translatePaperSelection itself.
  const runSelectionTranslate = useCallback((): void => {
    const sel = pending
    if (!sel) return
    setPending(null)
    setAskOpen(false)
    window.getSelection()?.removeAllRanges()
    void runCardRequest(sel.anchor, sel.text, {
      page: sel.page,
      rects: sel.rects,
      text: sel.text
    })
  }, [pending, runCardRequest])

  const exportAnnotations = async (): Promise<void> => {
    const { items, cards } = usePaperMarksStore.getState()
    if (items.length === 0 && Object.keys(cards).length === 0) return
    const { appendPaperNotes } = await import('../../../paper/paper-notes-append')
    const notesPath = `${unitRelDir}/${paperUnitSlugFromDir(unitRelDir)}-NOTES.md`
    await appendPaperNotes({ workspaceRoot, notesPath, items, cards })
    setTranslateNotice({ message: t('writePaperReaderNotesExported'), config: false })
  }

  const marksByPage = useMemo(() => {
    const map = new Map<number, PaperHighlight[]>()
    for (const mark of marks) {
      const list = map.get(mark.page)
      if (list) list.push(mark)
      else map.set(mark.page, [mark])
    }
    return map
  }, [marks])

  const translating = Boolean(translateJob && translateJob.status === 'running')

  return (
    <div ref={rootRef} className="write-pdf-viewer relative flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        {drawerOpen ? (
          <PaperReaderDrawer
            workspaceRoot={workspaceRoot}
            unitDir={unitRelDir}
            pdfDocument={pdfDocument}
            onJumpToPage={scrollToPage}
            onDeleteMark={(id) => removePaperHighlight(id)}
            t={t}
          />
        ) : null}
        <div
          ref={scrollerRef}
          className="write-pdf-scroller min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
          onPointerDown={() => {
            draggingRef.current = true
            setPending(null)
            setAskOpen(false)
            setSelectionRects([])
          }}
          onPointerUp={() => {
            draggingRef.current = false
            captureSelectionSoon()
          }}
          onMouseUp={() => {
            draggingRef.current = false
            captureSelectionSoon()
          }}
          onKeyUp={captureSelectionSoon}
          onScroll={schedulePageSync}
        >
          {loading ? (
            <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-[13px] text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              {t('writePdfLoading')}
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-[13px] text-red-600 dark:text-red-300">
              {t('writePdfLoadFailed', { message: error })}
            </div>
          ) : pdfDocument ? (
            <div className="mx-auto flex w-max max-w-full flex-col items-center gap-5">
              {allPageTextLoaded && !pdfHasText ? (
                <div className="max-w-[560px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/36 dark:text-amber-100">
                  {t('writePdfNoTextLayer')}
                </div>
              ) : null}
              {Array.from({ length: pdfDocument.numPages }, (_, i) => i + 1).map((pageNumber) => (
                <div
                  key={pageNumber}
                  ref={(node) => {
                    if (node) pageRefs.current.set(pageNumber, node)
                    else pageRefs.current.delete(pageNumber)
                  }}
                >
                  <div className="group/page relative w-fit">
                    <WritePdfPage
                      document={pdfDocument}
                      pageNumber={pageNumber}
                      scale={scale}
                      selectionRects={selectionRects.filter((r) => r.page === pageNumber)}
                      onPageText={updatePageText}
                    />
                    <PaperPageMarksLayer
                      marks={marksByPage.get(pageNumber) ?? []}
                      onDelete={(id) => removePaperHighlight(id)}
                    />
                    {pdfHasText ? (
                      <button
                        type="button"
                        title={t('writePaperReaderTranslatePage')}
                        aria-label={t('writePaperReaderTranslatePage')}
                        onClick={() => void runPageTranslate(pageNumber)}
                        className="absolute right-1 top-1/2 z-[3] flex h-16 w-4 -translate-y-1/2 items-center justify-center rounded-l-md border-y border-l border-ds-border bg-ds-card/85 text-ds-faint opacity-0 shadow-sm transition group-hover/page:opacity-100 hover:text-accent"
                      >
                        <span className="text-[10px] font-medium leading-none" style={{ writingMode: 'vertical-rl' }}>
                          {t('writePaperReaderTranslatePageMark')}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 select-none text-center text-[11px] text-ds-faint">
                    {t('writePdfPageLabel', { page: pageNumber })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <PaperFloatingControls
        t={t}
        scale={scale}
        setScale={setScale}
        currentPage={currentPage}
        pageInput={pageInput}
        setPageInput={setPageInput}
        pageCount={pageCount}
        scrollToPage={scrollToPage}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchMatches={searchMatches}
        searchIndex={searchIndex}
        jumpSearch={jumpSearch}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
        onBackToLibrary={() => openPaperViewTab('library')}
        tone={tone}
        setTone={setTone}
        translating={translating}
        translateLabel={translateJob?.message ?? (translateNotice?.message || null)}
        onTranslateDocument={() => void runDocumentTranslate()}
        onCancelTranslate={cancelDocumentTranslate}
        marksCount={marksCount}
        onExportNotes={() => void exportAnnotations()}
      />

      <PaperCommentGutter
        marks={marks}
        currentPage={currentPage}
        onJumpToPage={scrollToPage}
        onDelete={(id) => removePaperHighlight(id)}
        t={t}
      />

      {translateNotice ? (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1 text-[11px] text-ds-muted shadow">
          <span>{translateNotice.message}</span>
          {translateNotice.config ? (
            <button
              type="button"
              className="pointer-events-auto font-medium text-accent hover:underline"
              onClick={openTranslateSettings}
            >
              {t('writePaperTranslateConfigure')}
            </button>
          ) : null}
        </div>
      ) : null}

      {pending && !askOpen ? (
        <PaperSelectionMenu
          anchor={pending.anchor}
          containerRef={rootRef}
          selectionLength={pending.text.length}
          onHighlight={addHighlight}
          onAnnotate={(comment) => addHighlight('yellow', comment)}
          onAsk={() => setAskOpen(true)}
          onAddToChat={addToConversation}
          onTranslate={() => void runSelectionTranslate()}
          onClose={() => setPending(null)}
          t={t}
        />
      ) : null}
      {pending && askOpen ? (
        <PaperAskPopover
          anchor={pending.anchor}
          containerRef={rootRef}
          onSubmit={submitQuickAsk}
          onClose={() => setAskOpen(false)}
          t={t}
        />
      ) : null}
      {translateCard ? (
        <PaperTranslateCard
          anchor={translateCard.anchor}
          containerRef={rootRef}
          quote={translateCard.quote}
          translation={translateCard.translation}
          model={translateCard.model}
          loading={translateCard.loading}
          error={translateCard.error}
          onConfigure={
            translateCard.errorCode === 'config' ? openTranslateSettings : undefined
          }
          onClose={closeCard}
          t={t}
        />
      ) : null}
      {translateSettingsOpen ? (
        <PaperTranslateSettingsDialog
          onClose={closeTranslateSettings}
          onSaved={onTranslateSettingsSaved}
        />
      ) : null}
    </div>
  )
}
