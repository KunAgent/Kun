import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WritePdfRendererProps } from '../../write/write-pdf-renderer-context'
import { useWritePdfDocument } from '../../write/use-write-pdf-document'
import { useWritePdfNavigation } from '../../write/use-write-pdf-navigation'
import type { PaperHighlight } from '@shared/paper/paper-marks-types'
import type { WritePaperModeReaderSettingsV1 } from '@shared/app-settings-types-paper-mode'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { openPaperViewTab } from '../../../paper/paper-view'
import {
  nextPaperMarkId,
  removePaperHighlight,
  removePaperMarkCard,
  upsertPaperMarkCard,
  usePaperMarksStore
} from '../../../paper/paper-marks-store'
import { usePaperMarks } from '../../../paper/use-paper-marks'
import { paperUnitDirForFile, paperUnitSlugFromDir } from '../../../write/paper/paper-unit'
import { usePaperStore } from '../../../write/paper/paper-store'
import { rendererRuntimeClient } from '../../../agent/runtime-client'
import { usePaperWorkbenchChrome } from '../../../paper/paper-chrome-context'
import {
  applyPaperReaderLayout,
  readPaperReaderLayout,
  storePaperReaderLayout,
  type PaperReaderLayoutPreset
} from '../../../paper/paper-reader-layout'
import type { PaperReferenceItem } from '@shared/paper/paper-references-types'
import type { PaperFigureItemV1 } from '@shared/paper/paper-types'
import type { PaperRect, PaperVisualMark } from '@shared/paper/paper-marks-types'
import { cropPageRegionPng } from '../../../paper/paper-visual-mark'
import { usePaperImmersive } from './use-paper-immersive'
import { usePaperSelection, type PendingPaperSelection } from './use-paper-selection'
import { usePaperTranslateCard } from './use-paper-translate-card'
import { usePaperReaderPosition } from './use-paper-reader-position'
import { PaperReaderContext, type PaperReaderServices } from './paper-reader-context'
import { PaperLinkLayer } from './PaperLinkLayer'
import { PaperRegionSelectLayer } from './PaperRegionSelectLayer'
import { PaperTranslateOverlay } from './PaperTranslateOverlay'
import { usePaperPageTranslate } from './use-paper-page-translate'
import {
  claimPaperReaderSyncId,
  publishPaperReaderSync,
  subscribePaperReaderSync
} from '../../../paper/paper-reader-sync'
import { togglePaperTranslatedMirror } from '../../../paper/paper-mirror'
import { PaperPageStack } from './PaperPageStack'
import { PaperReaderOverlays } from './PaperReaderOverlays'
import { PaperTranslatedMirror } from './PaperTranslatedMirror'
import { PaperReaderDrawer } from './PaperReaderDrawer'
import { PaperFloatingControls } from './PaperFloatingControls'
import { PaperCommentGutter } from './PaperCommentGutter'

type PaperTone = WritePaperModeReaderSettingsV1['paperTone']

/** R2.x page overlays stacked over WritePdfPage (link layer, translation). */
const READER_LAYERS = [PaperTranslateOverlay, PaperLinkLayer, PaperRegionSelectLayer]

/**
 * Paper-unit PDF reader (R0 orchestrator): composes the document/navigation
 * stack with floating chrome — controls capsule, comment gutter, selection
 * menu, ask popover, translate card — while the cohesive concerns live in
 * the sibling hooks and PaperPageStack.
 */
export function PaperUnitPdfReader({
  filePath,
  dataBase64,
  mtimeMs,
  workspaceRoot,
  pdfView,
  viewerRef,
  onSelectionChange,
  unitDirAbs
}: WritePdfRendererProps & { unitDirAbs: string }): ReactElement {
  const { t } = useTranslation('common')
  // R2.3: the secondary-group twin renders overlay-only and mirrors scroll.
  const translated = pdfView === 'translated'
  const unitRelDir = paperUnitDirForFile(unitDirAbs, workspaceRoot)
  const marks = usePaperMarksStore((s) => s.items)
  const markCards = usePaperMarksStore((s) => s.cards)
  const marksCount = usePaperMarksStore((s) => s.items.length + Object.keys(s.cards).length)
  const [regionSelectActive, setRegionSelectActive] = useState(false)
  const [regionNotice, setRegionNotice] = useState('')
  const entries = usePaperModeStore((s) => s.entries)
  const libraryEntry = entries.find((e) => e.unitDir === unitRelDir)
  const tone = useWriteWorkspaceStore((s) => s.paperMode.reader.paperTone)
  const translateJob = usePaperStore((s) => s.busy['translate-document'])

  usePaperMarks(workspaceRoot, unitRelDir)

  const localRootRef = useRef<HTMLDivElement | null>(null)
  const rootRef = viewerRef ?? localRootRef
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1.15)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [layoutPreset, setLayoutPreset] = useState<PaperReaderLayoutPreset>(readPaperReaderLayout)
  const workbenchChrome = usePaperWorkbenchChrome()
  const { immersive, toggleImmersive } = usePaperImmersive({ rootRef, chrome: workbenchChrome })

  const autoTranslateSelection = useWriteWorkspaceStore(
    (s) => s.paperMode.translate.autoTranslateSelection === true
  )
  // Filled below by the translate hook; keeps the selection hook ordered
  // first (it feeds useWritePdfDocument's publishSelection).
  const selectionTranslateRef = useRef<(sel: PendingPaperSelection) => void>(() => {})
  const selection = usePaperSelection({
    rootRef,
    workspaceRoot,
    onSelectionChange,
    onAutoTranslate: autoTranslateSelection
      ? (sel) => selectionTranslateRef.current(sel)
      : undefined
  })

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
    publishSelection: selection.publishSelection
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

  usePaperReaderPosition({
    pdfDocument,
    unitDir: unitRelDir,
    workspaceRoot,
    libraryEntry,
    currentPage,
    pageCount,
    scrollToPage,
    enabled: !translated
  })

  const {
    translateCard,
    setTranslateCard,
    translateNotice,
    setTranslateNotice,
    setTranslateCardHovered,
    reopenTranslateCard,
    settingsOpen: translateSettingsOpen,
    openSettings: openTranslateSettings,
    closeSettings: closeTranslateSettings,
    onSettingsSaved: onTranslateSettingsSaved,
    runSelectionTranslate,
    runDocumentTranslate,
    cancelDocumentTranslate,
    exportAnnotations
  } = usePaperTranslateCard({
    unitDir: unitRelDir,
    workspaceRoot,
    t
  })
  selectionTranslateRef.current = (sel) => {
    selection.dismissPending()
    selection.setAskOpen(false)
    void runSelectionTranslate(sel)
  }

  // R2.2 per-page overlay translation (block-level, mask + batched IPC).
  const pageTranslate = usePaperPageTranslate({
    pdfDocument,
    unitDir: unitRelDir,
    workspaceRoot
  })
  const { translateAllFrom } = pageTranslate

  // R2.3 twin sync: scroll ratios flow both ways over the per-path channel;
  // zoom flows primary → mirror only (the mirror has no zoom controls).
  const syncIdRef = useRef(claimPaperReaderSyncId())
  const applyingScrollRef = useRef(false)
  const publishRafRef = useRef<number | null>(null)

  const publishScrollSync = useCallback((): void => {
    if (publishRafRef.current != null) return
    publishRafRef.current = window.requestAnimationFrame(() => {
      publishRafRef.current = null
      const el = scrollerRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      publishPaperReaderSync(filePath, {
        originId: syncIdRef.current,
        scrollRatio: max > 0 ? el.scrollTop / max : 0
      })
    })
  }, [filePath])

  const applyScale = useCallback((next: number | ((value: number) => number)): void => {
    setScale((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (!translated && value !== current) {
        publishPaperReaderSync(filePath, { originId: syncIdRef.current, zoom: value })
      }
      return value
    })
  }, [filePath, translated])

  useEffect(() => subscribePaperReaderSync(filePath, (message) => {
    if (message.originId === syncIdRef.current) return
    if (message.requestSync && !translated) {
      // The mirror just mounted — answer with the current position + zoom.
      const el = scrollerRef.current
      const max = el ? el.scrollHeight - el.clientHeight : 0
      publishPaperReaderSync(filePath, {
        originId: syncIdRef.current,
        scrollRatio: el && max > 0 ? el.scrollTop / max : 0,
        zoom: scale
      })
      return
    }
    const el = scrollerRef.current
    if (typeof message.scrollRatio === 'number' && el) {
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) {
        applyingScrollRef.current = true
        el.scrollTop = message.scrollRatio * max
        // Double rAF: the programmatic scroll event lands before this clears.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            applyingScrollRef.current = false
          })
        })
      }
    }
    if (translated && typeof message.zoom === 'number' && message.zoom > 0) {
      setScale(message.zoom)
    }
  }), [filePath, translated, scale])

  // The mirror announces itself once mounted so the primary replies with its
  // current scroll ratio + zoom even if the user never scrolls again.
  useEffect(() => {
    if (translated && pdfDocument) {
      publishPaperReaderSync(filePath, { originId: syncIdRef.current, requestSync: true })
    }
  }, [translated, pdfDocument, filePath])

  // The mirror auto-translates every page; overlays render where `done`.
  const autoTranslatedRef = useRef(false)
  useEffect(() => {
    if (!translated || !pdfDocument || pageCount < 1 || autoTranslatedRef.current) return
    autoTranslatedRef.current = true
    translateAllFrom(1, pageCount)
  }, [translated, pdfDocument, pageCount, translateAllFrom])

  useEffect(() => () => {
    if (publishRafRef.current != null) window.cancelAnimationFrame(publishRafRef.current)
  }, [])

  const onScrollerScroll = useCallback((): void => {
    schedulePageSync()
    if (!applyingScrollRef.current) publishScrollSync()
  }, [schedulePageSync, publishScrollSync])

  // Paper tone is a scroller data attribute consumed by CSS.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.dataset.paperTone = tone
  }, [tone])

  const setTone = useCallback((next: PaperTone): void => {
    useWriteWorkspaceStore.setState((s) => ({
      paperMode: { ...s.paperMode, reader: { ...s.paperMode.reader, paperTone: next } }
    }))
    void rendererRuntimeClient
      .setSettings({ write: { paperMode: { reader: { paperTone: next } } } })
      .catch(() => undefined)
  }, [])

  const unitPdfFile = useMemo(() => {
    const rel = filePath.startsWith(unitDirAbs)
      ? filePath.slice(unitDirAbs.length).replace(/^[/\\]+/, '')
      : ''
    return rel.toLowerCase().endsWith('.pdf') ? rel : undefined
  }, [filePath, unitDirAbs])

  // Layout presets (R1.1): ⌥1/2/3 while the reader is focused, or the
  // floating-controls menu. The choice persists for the next paper.
  const applyLayout = useCallback((preset: PaperReaderLayoutPreset): void => {
    setLayoutPreset(preset)
    storePaperReaderLayout(preset)
    void applyPaperReaderLayout(
      preset,
      { workspaceRoot, unitDir: unitRelDir, pdfFile: unitPdfFile },
      workbenchChrome
    )
  }, [workspaceRoot, unitRelDir, unitPdfFile, workbenchChrome])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (translated || !event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const root = rootRef.current
      if (!root || (target && !root.contains(target))) return
      const preset = event.key === '1' ? 'read' : event.key === '2' ? 'notes' : event.key === '3' ? 'assistant' : null
      if (preset) {
        event.preventDefault()
        applyLayout(preset)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyLayout, rootRef, translated])

  // R1.2: F toggles immersive mode while the reader is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (translated || (event.key !== 'f' && event.key !== 'F')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const root = rootRef.current
      if (!root || (target && !root.contains(target))) return
      event.preventDefault()
      toggleImmersive()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleImmersive, rootRef, translated])

  // R2.4: ⌘. toggles region-select mode; Esc leaves it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const root = rootRef.current
      if (event.key === 'Escape' && regionSelectActive) {
        event.preventDefault()
        setRegionSelectActive(false)
        return
      }
      const isShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && event.key === '.'
      if (!isShortcut || translated) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!root || (target && !root.contains(target))) return
      event.preventDefault()
      setRegionSelectActive((active) => !active)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [regionSelectActive, rootRef, translated])

  // Immersive reading caps the page column at ~1080px: shrink zoom to fit
  // when the rendered page is wider.
  useEffect(() => {
    if (!immersive) return
    const pageEl = rootRef.current?.querySelector<HTMLElement>('[data-write-pdf-page]')
    const width = pageEl?.offsetWidth ?? 0
    if (width > 1080) {
      setScale((value) => Number((value * (1080 / width)).toFixed(2)))
    }
  }, [immersive, rootRef])

  // R2.5 reader services shared by page layers: lazy references/figures
  // caches (per unit), page jumps with a flash pulse, and suppression while
  // the pointer is owned by the selection flow.
  const referencesPromiseRef = useRef<Promise<PaperReferenceItem[]> | null>(null)
  const figuresPromiseRef = useRef<Promise<PaperFigureItemV1[]> | null>(null)
  const [flashPage, setFlashPage] = useState<number | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    referencesPromiseRef.current = null
    figuresPromiseRef.current = null
  }, [unitRelDir])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  const jumpToPageWithFlash = useCallback((page: number): void => {
    scrollToPage(page)
    setFlashPage(page)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashPage(null), 1400)
  }, [scrollToPage])

  const referencesPage = useMemo(() => {
    const sorted = [...pageTexts].sort((a, b) => a.page - b.page)
    for (const page of sorted) {
      if (/^\s*(?:references|bibliography|参考文献)\s*$/im.test(page.text)) {
        return page.page
      }
    }
    return null
  }, [pageTexts])

  // R2.4: render the dragged region at 2x, persist PNG + card, then open the
  // gutter card editor for a comment.
  const captureRegion = useCallback((page: number, rect: PaperRect): void => {
    const doc = pdfDocument
    if (!doc) return
    void (async () => {
      try {
        const pageProxy = await doc.getPage(page)
        const capture = await cropPageRegionPng(pageProxy, rect)
        const api = window.kunGui?.paperSaveVisualMark
        if (!capture || typeof api !== 'function') return
        const result = await api({
          workspaceRoot,
          unitDir: unitRelDir,
          mark: { id: nextPaperMarkId(), page, rect },
          pngBase64: capture.base64
        })
        if (!result.ok) {
          setRegionNotice(result.message)
          return
        }
        setRegionNotice('')
        upsertPaperMarkCard(result.mark, capture.dataUrl)
        setRegionSelectActive(false)
      } catch (cause) {
        setRegionNotice(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [pdfDocument, workspaceRoot, unitRelDir])

  const visualMarksByPage = useMemo(() => {
    const map = new Map<number, PaperVisualMark[]>()
    for (const card of Object.values(markCards)) {
      const mark = card as PaperVisualMark
      if (mark?.kind !== 'visual' || typeof mark.page !== 'number' || !mark.rect) continue
      const list = map.get(mark.page)
      if (list) list.push(mark)
      else map.set(mark.page, [mark])
    }
    return map
  }, [markCards])

  const readerServices = useMemo<PaperReaderServices>(() => ({
    workspaceRoot,
    unitDir: unitRelDir,
    pdfDocument,
    jumpToPage: jumpToPageWithFlash,
    getReferences: () => {
      if (!referencesPromiseRef.current) {
        const api = window.kunGui?.paperFetchReferences
        referencesPromiseRef.current = (typeof api === 'function'
          ? api({ workspaceRoot, unitDir: unitRelDir, force: false, kind: 'references' })
              .then((result) => (result.ok ? result.items : []))
          : Promise.resolve([] as PaperReferenceItem[])).catch(() => [] as PaperReferenceItem[])
      }
      return referencesPromiseRef.current
    },
    getFigures: () => {
      if (!figuresPromiseRef.current) {
        const api = window.kunGui?.paperReadUnit
        figuresPromiseRef.current = (typeof api === 'function'
          ? api({ workspaceRoot, unitDir: unitRelDir })
              .then((result) => (result.ok ? result.figures?.items ?? [] : []))
          : Promise.resolve([] as PaperFigureItemV1[])).catch(() => [] as PaperFigureItemV1[])
      }
      return figuresPromiseRef.current
    },
    // R2.5 mutual exclusion: no link/citation cards while the pointer is
    // owned by selection, the selection menu, ask popover, or region mode.
    linksSuppressed: Boolean(selection.pending) || selection.askOpen || regionSelectActive,
    referencesPage,
    getPageBlocks: pageTranslate.getPageBlocks,
    pageTranslations: (page: number) =>
      pageTranslate.statusByPage.get(page) === 'done'
        ? pageTranslate.translationsByPage.get(page) ?? null
        : null,
    regionSelectActive,
    captureRegion
  }), [
    workspaceRoot,
    unitRelDir,
    pdfDocument,
    jumpToPageWithFlash,
    selection.pending,
    selection.askOpen,
    referencesPage,
    regionSelectActive,
    captureRegion,
    pageTranslate.getPageBlocks,
    pageTranslate.statusByPage,
    pageTranslate.translationsByPage
  ])

  const marksByPage = useMemo(() => {
    const map = new Map<number, PaperHighlight[]>()
    for (const mark of marks) {
      const list = map.get(mark.page)
      if (list) list.push(mark)
      else map.set(mark.page, [mark])
    }
    return map
  }, [marks])

  const translateSelection = (): void => {
    const sel = selection.pending
    if (!sel) return
    selection.dismissPending()
    selection.setAskOpen(false)
    void runSelectionTranslate(sel)
  }

  const translating = Boolean(translateJob && translateJob.status === 'running')

  // R2.3 translated mirror: pages + translation overlay only — no marks,
  // selection, drawer, gutter, or floating chrome. Scroll/zoom follow the
  // primary reader through the sync bus.
  if (translated) {
    return (
      <PaperTranslatedMirror
        readerServices={readerServices}
        localRootRef={localRootRef}
        scrollerRef={scrollerRef}
        onScrollerScroll={onScrollerScroll}
        loading={loading}
        error={error}
        pdfDocument={pdfDocument}
        scale={scale}
        pageRefs={pageRefs}
        onPageText={updatePageText}
        pdfHasText={pdfHasText}
        statusByPage={pageTranslate.statusByPage}
        t={t}
      />
    )
  }

  return (
    <PaperReaderContext.Provider value={readerServices}>
    <div
      ref={rootRef}
      data-immersive={immersive ? 'true' : undefined}
      className="write-pdf-viewer relative flex h-full min-h-0 min-w-0 flex-col"
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {drawerOpen ? (
          <PaperReaderDrawer
            workspaceRoot={workspaceRoot}
            unitDir={unitRelDir}
            paperTitle={libraryEntry?.meta.title ?? ''}
            pdfFile={unitPdfFile}
            pdfDocument={pdfDocument}
            onJumpToPage={scrollToPage}
            onDeleteMark={(id) => {
              removePaperHighlight(id)
              removePaperMarkCard(id)
            }}
            t={t}
          />
        ) : null}
        <div
          ref={scrollerRef}
          className="write-pdf-scroller min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
          onPointerDown={selection.beginDrag}
          onPointerUp={selection.endDrag}
          onMouseUp={selection.endDrag}
          onKeyUp={selection.captureSelectionSoon}
          onScroll={onScrollerScroll}
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
              <PaperPageStack
                pdfDocument={pdfDocument}
                scale={scale}
                selectionRects={selection.selectionRects}
                marksByPage={marksByPage}
                visualMarksByPage={visualMarksByPage}
                pageRefs={pageRefs}
                onPageText={updatePageText}
                onDeleteMark={(id) => removePaperHighlight(id)}
                pdfHasText={pdfHasText}
                layers={READER_LAYERS}
                flashPage={flashPage}
                pageTranslateStatus={(p) => pageTranslate.statusByPage.get(p) ?? 'idle'}
                onPageTranslateToggle={pageTranslate.togglePageOverlay}
                t={t}
              />
            </div>
          ) : null}
        </div>
      </div>

      <PaperFloatingControls
        t={t}
        scale={scale}
        setScale={applyScale}
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
        layoutPreset={layoutPreset}
        onApplyLayout={applyLayout}
        immersive={immersive}
        onToggleImmersive={toggleImmersive}
        tone={tone}
        setTone={setTone}
        translating={translating}
        translateLabel={translateJob?.message ?? translateNotice?.message ?? null}
        onTranslateDocument={() => void runDocumentTranslate()}
        onCancelTranslate={cancelDocumentTranslate}
        onToggleMirror={() => togglePaperTranslatedMirror(filePath)}
        pageTranslating={pageTranslate.translatingAll}
        pageTranslateProgress={
          pageTranslate.allProgress
            ? `${pageTranslate.allProgress.done}/${pageTranslate.allProgress.total}`
            : null
        }
        onTranslatePagesToggle={() => {
          if (pageTranslate.translatingAll) pageTranslate.stopTranslateAll()
          else pageTranslate.translateAllFrom(currentPage, pageCount)
        }}
        marksCount={marksCount}
        onExportNotes={() => void exportAnnotations()}
        regionSelectActive={regionSelectActive}
        onToggleRegionSelect={() => setRegionSelectActive((active) => !active)}
      />

      <PaperCommentGutter
        marks={marks}
        visualMarks={[...visualMarksByPage.values()].flat()}
        currentPage={currentPage}
        containerRef={rootRef}
        workspaceRoot={workspaceRoot}
        unitDir={unitRelDir}
        paperTitle={libraryEntry?.meta.title ?? paperUnitSlugFromDir(unitRelDir)}
        pdfFile={unitPdfFile}
        onJumpToPage={scrollToPage}
        onDelete={(id) => {
          removePaperHighlight(id)
          removePaperMarkCard(id)
        }}
        t={t}
      />

      <PaperReaderOverlays
        selection={selection}
        translateSelection={translateSelection}
        translateCard={translateCard}
        setTranslateCard={setTranslateCard}
        setTranslateCardHovered={setTranslateCardHovered}
        reopenTranslateCard={reopenTranslateCard}
        translateNotice={translateNotice}
        regionNotice={regionNotice}
        translateSettingsOpen={translateSettingsOpen}
        openTranslateSettings={openTranslateSettings}
        closeTranslateSettings={closeTranslateSettings}
        onTranslateSettingsSaved={onTranslateSettingsSaved}
        rootRef={rootRef}
        t={t}
      />
    </div>
    </PaperReaderContext.Provider>
  )
}
