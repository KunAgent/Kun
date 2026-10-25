import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ViewerZoomLevel, ViewerZoomState } from '@extend-ai/react-pptx'
import i18n from '../i18n'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspaceOfficeSelection,
  WorkspacePresentationViewReference,
  WorkspacePresentationViewSource
} from '@shared/office-document'
import {
  OFFICE_ICON_BUTTON,
  OfficePageNav,
  OfficeToolbarStatus,
  OfficeZoomLevelControls,
  WorkspaceOfficeToolbar
} from './WorkspaceOfficeToolbar'
import { openWorkspaceOfficeExternalLink } from './workspace-office-external-link'
import {
  emptyWorkspaceOfficeSelection,
  selectionFromOfficeDom
} from './workspace-office-selection'
import { subscribeKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'

const WorkspacePptxDeck = lazy(() =>
  import('./WorkspacePptxDeck').then((module) => ({ default: module.WorkspacePptxDeck }))
)

const FULLSCREEN_CONTROLS_TIMEOUT_MS = 2_000
/**
 * After a jump the deck scrolls and reports the slide nearest the top. The
 * last slides cannot reach the top, so those reports are ignored briefly.
 */
const NAVIGATION_SETTLE_MS = 700
/** Below this width the slide rail would squeeze the slides, so it hides. */
export const PPTX_RAIL_MIN_VIEWER_WIDTH = 520
const EMPTY_CHANGED_SLIDES: readonly number[] = []

export function WorkspacePptxPreview({
  result,
  loading,
  refreshError,
  onSelectionChange,
  onPresentationViewChange,
  keyboardActive = true,
  changedSlides = EMPTY_CHANGED_SLIDES
}: {
  result: WorkspaceOfficePreviewSuccess
  loading: boolean
  refreshError?: string | null
  onSelectionChange?: (selection: WorkspaceOfficeSelection) => void
  onPresentationViewChange?: (
    view: WorkspacePresentationViewReference | null,
    source: WorkspacePresentationViewSource
  ) => void
  keyboardActive?: boolean
  changedSlides?: readonly number[]
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const deckHostRef = useRef<HTMLDivElement>(null)
  const controlsTimerRef = useRef<number | null>(null)
  const navigationRef = useRef<{ slide: number; until: number } | null>(null)
  const presentationViewChangeRef = useRef(onPresentationViewChange)
  presentationViewChangeRef.current = onPresentationViewChange
  const [slide, setSlide] = useState(1)
  // A reload of the same deck (Kun or another app saved it) keeps the slide on screen.
  const slideRef = useRef(1)
  slideRef.current = slide
  const loadedPathRef = useRef<string | null>(null)
  const [slideCount, setSlideCount] = useState(0)
  const slideCountRef = useRef(0)
  slideCountRef.current = slideCount
  const [zoom, setZoom] = useState<ViewerZoomLevel>('fit-page')
  const [resolvedZoom, setResolvedZoom] = useState(100)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [narrow, setNarrow] = useState(false)
  const changedSlideSet = useMemo(() => new Set(changedSlides), [changedSlides])
  // A re-read of unchanged bytes keeps the parsed deck instead of parsing it again.
  const sourceRef = useRef<{ key: string; data: Uint8Array } | null>(null)
  const sourceKey = `${result.path}\n${result.sourceSha256}`
  if (sourceRef.current?.key !== sourceKey) sourceRef.current = { key: sourceKey, data: result.data }
  const source = sourceRef.current.data

  const clearPresentationView = useCallback((): void => {
    presentationViewChangeRef.current?.(null, {
      path: result.path,
      sourceSha256: result.sourceSha256
    })
  }, [result.path, result.sourceSha256])

  const emitPresentationView = useCallback((nextSlide: number, nextSlideCount: number): void => {
    presentationViewChangeRef.current?.({
      kind: 'presentation',
      path: result.path,
      sourceName: result.name,
      sourceFormat: result.sourceFormat === 'ppt' ? 'ppt' : 'pptx',
      sourceSha256: result.sourceSha256,
      slide: nextSlide,
      slideCount: nextSlideCount
    }, { path: result.path, sourceSha256: result.sourceSha256 })
  }, [result.name, result.path, result.sourceFormat, result.sourceSha256])

  useEffect(() => {
    clearPresentationView()
    return clearPresentationView
  }, [clearPresentationView, source])

  const handleLoad = useCallback((count: number): void => {
    const safeCount = Math.max(1, count)
    const keptSlide = loadedPathRef.current === result.path
      ? Math.min(Math.max(1, slideRef.current), safeCount)
      : 1
    loadedPathRef.current = result.path
    setSlideCount(safeCount)
    setSlide(keptSlide)
    setInteractionError(null)
    emitPresentationView(keptSlide, safeCount)
  }, [emitPresentationView, result.path])

  const clearSelection = useCallback((): void => {
    onSelectionChange?.(emptyWorkspaceOfficeSelection('presentation', result.sourceFormat))
    window.getSelection()?.removeAllRanges()
  }, [onSelectionChange, result.sourceFormat])

  const goToSlide = useCallback((next: number): void => {
    const count = slideCountRef.current
    if (count < 1) return
    const safeSlide = Math.min(count, Math.max(1, next))
    if (safeSlide === slideRef.current) return
    navigationRef.current = { slide: safeSlide, until: performance.now() + NAVIGATION_SETTLE_MS }
    slideRef.current = safeSlide
    setSlide(safeSlide)
    emitPresentationView(safeSlide, count)
    clearSelection()
  }, [clearSelection, emitPresentationView])

  // Scrolling the continuous deck moves the current slide without a click.
  const handleDeckSlideChange = useCallback((index: number): void => {
    const count = slideCountRef.current
    const next = index + 1
    if (count < 1 || next === slideRef.current) return
    const navigation = navigationRef.current
    if (navigation && next !== navigation.slide && performance.now() < navigation.until) return
    slideRef.current = next
    setSlide(next)
    emitPresentationView(next, count)
  }, [emitPresentationView])

  const handleZoomChange = useCallback((state: ViewerZoomState): void => {
    setResolvedZoom(state.resolvedZoom)
  }, [])

  useEffect(() => subscribeKnowledgeSourceNavigation(result.path, (location) => {
    if (location.kind !== 'presentation' || slideCountRef.current < 1) return false
    goToSlide(location.slideStart)
    return true
  }), [goToSlide, result.path])

  useEffect(() => {
    if (!onSelectionChange) return
    const empty = (): void => onSelectionChange(
      emptyWorkspaceOfficeSelection('presentation', result.sourceFormat)
    )
    const sync = (): void => {
      const host = deckHostRef.current
      const selection = window.getSelection()
      if (!host || !selection?.anchorNode || !host.contains(selection.anchorNode)) return
      onSelectionChange(selectionFromOfficeDom(
        host,
        'presentation',
        result.sourceFormat,
        (node) => ({ slide: slideOfNode(node) ?? slideRef.current })
      ))
    }
    empty()
    document.addEventListener('selectionchange', sync)
    return () => {
      document.removeEventListener('selectionchange', sync)
      empty()
    }
  }, [onSelectionChange, result.sourceFormat, result.sourceSha256])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setNarrow(root.clientWidth > 0 && root.clientWidth < PPTX_RAIL_MIN_VIEWER_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const scheduleControlsHide = useCallback((): void => {
    clearControlsTimer(controlsTimerRef)
    controlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      controlsTimerRef.current = null
    }, FULLSCREEN_CONTROLS_TIMEOUT_MS)
  }, [])

  const revealFullscreenControls = useCallback((): void => {
    if (!isFullscreen) return
    setControlsVisible(true)
    scheduleControlsHide()
  }, [isFullscreen, scheduleControlsHide])

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      const active = document.fullscreenElement === rootRef.current
      setIsFullscreen(active)
      setControlsVisible(true)
      clearControlsTimer(controlsTimerRef)
      if (active) scheduleControlsHide()
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      clearControlsTimer(controlsTimerRef)
    }
  }, [scheduleControlsHide])

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    const root = rootRef.current
    if (!root) return
    try {
      if (document.fullscreenElement === root) {
        if (typeof document.exitFullscreen !== 'function') throw new Error('Fullscreen is not supported.')
        await document.exitFullscreen()
      } else {
        if (typeof root.requestFullscreen !== 'function') throw new Error('Fullscreen is not supported.')
        await root.requestFullscreen()
      }
      setInteractionError(null)
    } catch (cause) {
      setInteractionError(errorMessage(cause))
    }
  }, [])

  useEffect(() => {
    if (!keyboardActive) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableKeyboardTarget(event.target)) return
      let nextSlide: number | null = null
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) nextSlide = slideRef.current - 1
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar'].includes(event.key)) nextSlide = slideRef.current + 1
      if (event.key === 'Home') nextSlide = 1
      if (event.key === 'End') nextSlide = slideCountRef.current
      if (nextSlide !== null) {
        event.preventDefault()
        goToSlide(nextSlide)
        return
      }
      if (event.key.toLowerCase() === 'f' && !event.repeat) {
        event.preventDefault()
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToSlide, keyboardActive, toggleFullscreen])

  const status = interactionError || refreshError
  return (
    <div
      ref={rootRef}
      data-pptx-fullscreen={isFullscreen ? 'true' : 'false'}
      onPointerMove={revealFullscreenControls}
      className={`kun-pptx relative flex min-h-0 flex-1 flex-col ${isFullscreen ? 'bg-black' : ''}`}
    >
      {!isFullscreen ? (
        <WorkspaceOfficeToolbar
          leading={(
            <>
              <OfficePageNav
                summary={i18n.t('officeSlideSummary', { slide, count: slideCount })}
                prevLabel={i18n.t('officePreviousSlide')}
                nextLabel={i18n.t('officeNextSlide')}
                canPrev={slide > 1}
                canNext={slide < slideCount}
                onPrev={() => goToSlide(slide - 1)}
                onNext={() => goToSlide(slide + 1)}
              />
              {result.convertedFromLegacy ? (
                <span className="ml-1 shrink-0 rounded border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ds-faint">
                  {result.sourceFormat} → {result.renderFormat}
                </span>
              ) : null}
            </>
          )}
          status={<OfficeToolbarStatus loading={loading} message={status} />}
          trailing={(
            <>
              <OfficeZoomLevelControls zoom={zoom} resolvedZoom={resolvedZoom} onChange={setZoom} />
              <span aria-hidden className="mx-1 h-4 w-px bg-ds-border-muted" />
              <button
                type="button"
                aria-label={i18n.t('officeEnterFullscreen')}
                title={i18n.t('officeEnterFullscreen')}
                disabled={slideCount === 0}
                className={OFFICE_ICON_BUTTON}
                onClick={() => void toggleFullscreen()}
              >
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </>
          )}
        />
      ) : null}
      <div
        ref={deckHostRef}
        data-pptx-canvas-viewport="true"
        onClick={openWorkspaceOfficeExternalLink}
        className="kun-pptx__body relative min-h-0 min-w-0 flex-1"
      >
        <Suspense fallback={<div className="kun-pptx__placeholder" role="status">{i18n.t('officePptOpening')}</div>}>
          <WorkspacePptxDeck
            key={result.path}
            source={source}
            mode={isFullscreen ? 'slide' : 'continuous'}
            slideIndex={Math.max(0, slide - 1)}
            zoom={isFullscreen ? 'fit-page' : zoom}
            showThumbnails={!isFullscreen && !narrow && slideCount > 1}
            changedSlides={changedSlideSet}
            onLoad={handleLoad}
            onSlideChange={handleDeckSlideChange}
            onSelectSlide={goToSlide}
            onZoomChange={handleZoomChange}
            onError={setInteractionError}
          />
        </Suspense>
      </div>
      {isFullscreen ? (
        <div
          data-pptx-fullscreen-controls={controlsVisible ? 'visible' : 'hidden'}
          className={`absolute inset-x-0 bottom-5 z-20 flex justify-center transition-opacity ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <div className="flex items-center gap-3 rounded-full bg-black/75 px-4 py-2 text-xs text-white shadow-xl backdrop-blur">
            <button
              type="button"
              aria-label={i18n.t('officePreviousSlide')}
              disabled={slide <= 1}
              className="rounded p-0.5 hover:bg-white/15 disabled:opacity-40"
              onClick={() => goToSlide(slide - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">{i18n.t('officeSlideSummary', { slide, count: slideCount })}</span>
            <button
              type="button"
              aria-label={i18n.t('officeNextSlide')}
              disabled={slide >= slideCount}
              className="rounded p-0.5 hover:bg-white/15 disabled:opacity-40"
              onClick={() => goToSlide(slide + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {status ? <span className="max-w-80 truncate text-red-200">{status}</span> : null}
            <button
              type="button"
              aria-label={i18n.t('officeExitFullscreen')}
              className="rounded p-1 hover:bg-white/15"
              onClick={() => void toggleFullscreen()}
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function slideOfNode(node: Node | null): number | undefined {
  const element = node instanceof Element ? node : node?.parentElement
  const index = element?.closest<HTMLElement>('[data-rpv-slide-index]')?.dataset.rpvSlideIndex
  const parsed = index === undefined ? Number.NaN : Number(index)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed + 1 : undefined
}

function clearControlsTimer(timerRef: { current: number | null }): void {
  if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  timerRef.current = null
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select')) return true
  const editable = target.closest<HTMLElement>('[contenteditable]')
  return Boolean(editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false')
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message || i18n.t('officePptRenderError')
}
