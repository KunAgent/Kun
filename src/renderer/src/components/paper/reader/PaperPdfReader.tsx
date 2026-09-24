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
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperMarksStore, newPaperHighlight, removePaperHighlight } from '../../../paper/paper-marks-store'
import { usePaperMarks } from '../../../paper/use-paper-marks'
import {
  findPaperUnitDir,
  paperUnitDirFromKnownUnits,
  paperUnitDirForFile
} from '../../../write/paper/paper-unit'
import { usePaperStore } from '../../../write/paper/paper-store'
import {
  paperReaderAutoMarkReading,
  paperReaderRecordOpened,
  paperReaderRecordPage
} from '../../../paper/paper-reader-actions'
import { PaperPageMarksLayer } from './PaperPageMarksLayer'
import { PaperSelectionMenu } from './PaperSelectionMenu'
import { PaperReaderDrawer } from './PaperReaderDrawer'
import { PaperReaderBottomBar } from './PaperReaderBottomBar'
import { PaperReaderToolbar } from './PaperReaderToolbar'

const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const

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
 * Paper-mode PDF reader (§3.4.3): WritePdfViewer's document/navigation stack
 * plus a marks layer, selection menu, drawer, and bottom bar. Only used for
 * PDFs inside a paper unit; other PDFs render the ordinary viewer.
 */
export function PaperPdfReader(props: WritePdfRendererProps): ReactElement {
  const { filePath, workspaceRoot } = props
  const entriesByDir = useWriteWorkspaceStore((s) => s.entriesByDir)
  const unitDirs = usePaperModeStore((s) => s.entries.map((e) => e.unitDir))
  const knownUnits = usePaperStore((s) => s.unitsByDir)
  const unitDirAbs = useMemo(() => {
    return (
      findUnitDir(filePath, workspaceRoot, entriesByDir, unitDirs, Object.keys(knownUnits))
    )
  }, [filePath, workspaceRoot, entriesByDir, unitDirs, knownUnits])
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
  size,
  mtimeMs,
  workspaceRoot,
  viewerRef,
  onSelectionChange,
  unitDirAbs
}: WritePdfRendererProps & { unitDirAbs: string }): ReactElement {
  const { t } = useTranslation('common')
  const unitRelDir = paperUnitDirForFile(unitDirAbs, workspaceRoot)
  const marks = usePaperMarksStore((s) => s.items)
  const setView = usePaperModeStore((s) => s.setView)
  const entries = usePaperModeStore((s) => s.entries)
  const libraryEntry = entries.find((e) => e.unitDir === unitRelDir)

  usePaperMarks(workspaceRoot, unitRelDir)

  const localRootRef = useRef<HTMLDivElement | null>(null)
  const rootRef = viewerRef ?? localRootRef
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1.15)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pending, setPending] = useState<PendingSelection | null>(null)
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
    setPending(null)
    setSelectionRects([])
    window.getSelection()?.removeAllRanges()
    publishSelection(emptyPdfSelection())
  }, [pending, publishSelection])

  // 「加入对话」: keep the published selection (composer chip) and focus it.
  const askAssistant = useCallback((): void => {
    setPending(null)
    window.document
      .querySelector<HTMLTextAreaElement>('.ds-composer-textarea')
      ?.focus()
  }, [])

  const marksByPage = useMemo(() => {
    const map = new Map<number, PaperHighlight[]>()
    for (const mark of marks) {
      const list = map.get(mark.page)
      if (list) list.push(mark)
      else map.set(mark.page, [mark])
    }
    return map
  }, [marks])

  return (
    <div ref={rootRef} className="write-pdf-viewer flex h-full min-h-0 min-w-0 flex-col">
      <PaperReaderToolbar
        t={t}
        filePath={filePath}
        workspaceRoot={workspaceRoot}
        size={size}
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
        onBackToLibrary={() => setView('library')}
      />
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
                  <div className="relative w-fit">
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
      <PaperReaderBottomBar
        workspaceRoot={workspaceRoot}
        unitDir={unitRelDir}
        t={t}
      />
      {pending ? (
        <PaperSelectionMenu
          anchor={pending.anchor}
          containerRef={rootRef}
          selectionLength={pending.text.length}
          onHighlight={addHighlight}
          onAnnotate={(comment) => addHighlight('yellow', comment)}
          onAsk={askAssistant}
          onTranslate={async () => {
            const sel = pending
            setPending(null)
            window.getSelection()?.removeAllRanges()
            const { translatePaperSelection } = await import('../../../paper/paper-translate-actions')
            await translatePaperSelection({
              unitDir: unitRelDir,
              page: sel.page,
              rects: sel.rects,
              text: sel.text
            })
          }}
          onClose={() => setPending(null)}
          t={t}
        />
      ) : null}
    </div>
  )
}
