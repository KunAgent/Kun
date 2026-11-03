import '@extend-ai/react-pptx/styles.css'
import wasmUrl from '@extend-ai/react-pptx/pptx_wasm_bg.wasm?url'
import {
  parsePresentation,
  ReactPptxViewer,
  setWasmSource,
  type ParsedPresentation,
  type PptxViewerController,
  type ThumbnailRenderContext,
  type ViewerZoomLevel,
  type ViewerZoomState
} from '@extend-ai/react-pptx'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import i18n from '../i18n'
import { secureWorkspaceOfficeLinks } from './workspace-office-external-link'

setWasmSource(wasmUrl)

/** Thumbnail width inside the slide rail, in CSS pixels. */
const THUMBNAIL_WIDTH = 112

export type WorkspacePptxDeckProps = {
  source: Uint8Array
  mode: 'continuous' | 'slide'
  /** Zero-based slide shown by the deck. */
  slideIndex: number
  zoom: ViewerZoomLevel
  showThumbnails: boolean
  /** 1-based slides marked as changed in the rail. */
  changedSlides: ReadonlySet<number>
  onLoad: (slideCount: number) => void
  onSlideChange: (index: number) => void
  /** 1-based slide picked from the rail. */
  onSelectSlide: (slide: number) => void
  onZoomChange: (state: ViewerZoomState) => void
  onError: (message: string) => void
}

/**
 * The browser-native slide renderer. It is split from WorkspacePptxPreview so
 * the parser, its Wasm binary and its stylesheet load only when a deck opens.
 * A changed deck is parsed before it replaces the one on screen, so an edit
 * landing on disk swaps slides in place instead of blanking the viewer.
 */
export function WorkspacePptxDeck({
  source,
  mode,
  slideIndex,
  zoom,
  showThumbnails,
  changedSlides,
  onLoad,
  onSlideChange,
  onSelectSlide,
  onZoomChange,
  onError
}: WorkspacePptxDeckProps): ReactElement {
  const [controller, setController] = useState<PptxViewerController | null>(null)
  const [parsed, setParsed] = useState<ParsedPresentation | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const abort = new AbortController()
    parsePresentation(source, { signal: abort.signal }).then((next) => {
      if (abort.signal.aborted) return
      setFailure(null)
      setParsed(next)
    }, (error: unknown) => {
      if (abort.signal.aborted) return
      const message = error instanceof Error && error.message ? error.message : i18n.t('officePptRenderError')
      setFailure(message)
      onErrorRef.current(message)
    })
    return () => abort.abort()
  }, [source])

  useEffect(() => {
    setController(null)
  }, [parsed, mode])

  const renderThumbnail = useCallback((context: ThumbnailRenderContext): ReactElement => (
    <DeckThumbnail
      controller={controller}
      index={context.slideIndex}
      current={context.isCurrent}
      changed={changedSlides.has(context.slideIndex + 1)}
      onSelect={() => onSelectSlide(context.slideIndex + 1)}
    />
  ), [changedSlides, controller, onSelectSlide])

  if (!parsed) {
    return failure ? (
      <div className="kun-pptx-deck__state">
        <span className="kun-pptx-deck__status" role="alert">
          <strong>{i18n.t('officePptOpenFailed')}</strong>
          <span>{failure}</span>
        </span>
      </div>
    ) : (
      <div className="kun-pptx-deck__state">
        <span className="kun-pptx-deck__status" role="status">
          <span className="kun-pptx-deck__spinner" aria-hidden />
          {i18n.t('officePptOpening')}
        </span>
      </div>
    )
  }

  return (
    <ReactPptxViewer
      className="kun-pptx-deck"
      source={parsed}
      mode={mode}
      slideIndex={slideIndex}
      zoom={zoom}
      height="100%"
      showToolbar={false}
      showThumbnails={showThumbnails}
      virtualization
      renderThumbnail={renderThumbnail}
      onReady={setController}
      onLoad={(presentation) => onLoad(presentation.document.slides.length)}
      onSlideChange={onSlideChange}
      onZoomChange={onZoomChange}
      onSlideRendered={(_index, element) => secureWorkspaceOfficeLinks(element)}
      onError={(error) => onError(error.message || i18n.t('officePptRenderError'))}
      renderLoading={() => (
        <span className="kun-pptx-deck__status" role="status">
          <span className="kun-pptx-deck__spinner" aria-hidden />
          {i18n.t('officePptOpening')}
        </span>
      )}
      renderError={(error) => (
        <span className="kun-pptx-deck__status" role="alert">
          <strong>{i18n.t('officePptOpenFailed')}</strong>
          <span>{error.message || i18n.t('officePptRenderError')}</span>
        </span>
      )}
    />
  )
}

function DeckThumbnail({
  controller,
  index,
  current,
  changed,
  onSelect
}: {
  controller: PptxViewerController | null
  index: number
  current: boolean
  changed: boolean
  onSelect: () => void
}): ReactElement {
  const canvasRef = useRef<HTMLSpanElement>(null)
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending')

  useEffect(() => {
    const target = canvasRef.current
    if (!target || !controller) return
    let disposed = false
    let cleanup: (() => void) | undefined
    setState('pending')
    controller.renderThumbnail(index, target, { width: THUMBNAIL_WIDTH }).then((nextCleanup) => {
      if (disposed) {
        nextCleanup()
        return
      }
      cleanup = nextCleanup
      setState('ready')
    }, () => {
      if (!disposed) setState('failed')
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [controller, index])

  const slide = index + 1
  const label = i18n.t('officeGoToSlide', { slide })
  return (
    <button
      type="button"
      className="rpv-thumbnail"
      data-active={current || undefined}
      data-slide-changed={changed ? 'true' : undefined}
      data-thumbnail-state={state}
      aria-label={changed ? `${label} · ${i18n.t('officeSlideChanged')}` : label}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
    >
      <span className="rpv-thumbnail__number">{String(slide).padStart(2, '0')}</span>
      <span className="rpv-thumbnail__canvas" ref={canvasRef} />
      {changed ? <span className="kun-pptx-deck__changed" aria-hidden /> : null}
    </button>
  )
}
