import wasmUrl from '@extend-ai/react-docx/docx_wasm_bg.wasm?url'
import {
  DocxEditorViewer,
  parseDocxForViewer,
  revealDocxSource,
  setWasmSource,
  useDocxEditor,
  type ParsedDocxDocument,
  type ViewerZoomLevel,
  type ViewerZoomState
} from '@extend-ai/react-docx'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
  type RefObject
} from 'react'
import i18n from '../i18n'
import { docxBlockIdForParagraph, docxModelText } from './workspace-docx-model'

setWasmSource(wasmUrl)

/** Padding the preview pane puts around the pages (top + bottom), in px. */
const PANE_PADDING = 48
const REVEAL_FRAMES = 40
const RESTORE_SCROLL_FRAMES = 90

export type WorkspaceDocxPagesHandle = {
  /** Scrolls to a 1-based page, mounting it first when it is outside the window. */
  goToPage: (page: number) => void
  /** Scrolls to the Nth non-empty paragraph. False when the document has none. */
  revealParagraph: (paragraph: number) => boolean
  /** The whole document as text, not only the pages that are mounted. */
  fullText: () => string
}

export type WorkspaceDocxPagesProps = {
  source: Uint8Array
  fileName: string
  zoom: ViewerZoomLevel
  /** The pane that scrolls the pages; the viewer virtualizes against it. */
  scrollRef: RefObject<HTMLDivElement | null>
  handleRef: Ref<WorkspaceDocxPagesHandle>
  onPageInfo: (page: number, pageCount: number) => void
  onZoomChange: (state: ViewerZoomState) => void
  onLoaded: () => void
  onError: (message: string) => void
}

/**
 * The browser-native Word renderer. It is split from WorkspaceDocxPreview so the
 * parser, its Wasm binary and the layout engine load only when a document opens.
 * A changed file is parsed before it replaces the one on screen, and the scroll
 * position carries over, so an edit landing on disk swaps pages in place.
 */
export function WorkspaceDocxPages({
  source,
  fileName,
  zoom,
  scrollRef,
  handleRef,
  onPageInfo,
  onZoomChange,
  onLoaded,
  onError
}: WorkspaceDocxPagesProps): ReactElement {
  const [loaded, setLoaded] = useState<{ parsed: ParsedDocxDocument; generation: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const restoreScrollRef = useRef<{ top: number; height: number } | null>(null)
  const callbacksRef = useRef({ onLoaded, onError })
  callbacksRef.current = { onLoaded, onError }

  useEffect(() => {
    const abort = new AbortController()
    const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
    parseDocxForViewer(buffer, {
      signal: abort.signal,
      useWorker: true,
      loadEmbeddedFonts: 'defer',
      fileName
    }).then((next) => {
      if (abort.signal.aborted) {
        next.dispose()
        return
      }
      const scroller = scrollRef.current
      restoreScrollRef.current = scroller && scroller.scrollTop > 0
        ? { top: scroller.scrollTop, height: scroller.scrollHeight }
        : null
      setFailure(null)
      setLoaded((current) => ({ parsed: next, generation: (current?.generation ?? 0) + 1 }))
    }, (error: unknown) => {
      if (abort.signal.aborted) return
      const message = error instanceof Error && error.message ? error.message : i18n.t('officeDocxRenderError')
      setFailure(message)
      callbacksRef.current.onError(message)
    })
    return () => abort.abort()
  }, [fileName, scrollRef, source])

  const parsed = loaded?.parsed ?? null
  useEffect(() => () => parsed?.dispose(), [parsed])

  if (!loaded || !parsed) {
    return failure ? (
      <div className="kun-office-state">
        <span className="kun-office-state__body" role="alert">
          <strong>{i18n.t('officeDocxOpenFailed')}</strong>
          <span>{failure}</span>
        </span>
      </div>
    ) : (
      <div className="kun-office-state">
        <span className="kun-office-state__body" role="status">
          <span className="kun-office-state__spinner" aria-hidden />
          {i18n.t('officeDocxOpening')}
        </span>
      </div>
    )
  }
  return (
    <DocxSurface
      key={loaded.generation}
      parsed={parsed}
      zoom={zoom}
      scrollRef={scrollRef}
      handleRef={handleRef}
      restoreScrollRef={restoreScrollRef}
      onPageInfo={onPageInfo}
      onZoomChange={onZoomChange}
      onMounted={() => callbacksRef.current.onLoaded()}
    />
  )
}

function DocxSurface({
  parsed,
  zoom,
  scrollRef,
  handleRef,
  restoreScrollRef,
  onPageInfo,
  onZoomChange,
  onMounted
}: {
  parsed: ParsedDocxDocument
  zoom: ViewerZoomLevel
  scrollRef: RefObject<HTMLDivElement | null>
  handleRef: Ref<WorkspaceDocxPagesHandle>
  restoreScrollRef: RefObject<{ top: number; height: number } | null>
  onPageInfo: (page: number, pageCount: number) => void
  onZoomChange: (state: ViewerZoomState) => void
  onMounted: () => void
}): ReactElement {
  const editor = useDocxEditor({ document: parsed, loadEmbeddedFonts: true })
  const rootRef = useRef<HTMLDivElement>(null)
  // The pane keeps the old document's height until the new pages are measured, so
  // replacing it does not clamp the reader back to the top for a frame.
  const [holdHeight] = useState(() => restoreScrollRef.current?.height ?? null)
  const editorRef = useRef(editor)
  editorRef.current = editor

  useEffect(() => {
    onPageInfo(editor.currentPage, editor.totalPages)
  }, [editor.currentPage, editor.totalPages, onPageInfo])

  useLayoutEffect(() => {
    onMounted()
    const restore = restoreScrollRef.current
    restoreScrollRef.current = null
    const scroller = scrollRef.current
    if (!scroller || restore === null) return
    const target = restore.top
    const surface = rootRef.current
    const release = (): void => { if (surface) surface.style.minHeight = '' }
    // The new pages paginate over several frames and the viewer may reset the pane
    // to the top while they do, so keep asking for the old offset until the reader
    // takes over the scroll or the layout has been stable for a while.
    let frames = 0
    let cancelled = false
    const cancel = (): void => { cancelled = true; release() }
    const interactions = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    for (const type of interactions) scroller.addEventListener(type, cancel, { once: true, passive: true })
    const step = (): void => {
      if (cancelled) return
      if (frames >= RESTORE_SCROLL_FRAMES) {
        release()
        return
      }
      frames += 1
      const max = scroller.scrollHeight - scroller.clientHeight
      if (max >= target && Math.abs(scroller.scrollTop - target) > 2) scroller.scrollTop = target
      window.requestAnimationFrame(step)
    }
    window.requestAnimationFrame(step)
    return () => {
      cancelled = true
      release()
      for (const type of interactions) scroller.removeEventListener(type, cancel)
    }
    // Runs once per parsed document: the surface is remounted when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(handleRef, () => ({
    goToPage: (page) => {
      const scroller = scrollRef.current
      if (scroller) void scrollToPage(scroller, page - 1)
    },
    revealParagraph: (paragraph) => {
      const blockId = docxBlockIdForParagraph(editorRef.current.model, paragraph)
      const root = rootRef.current?.querySelector<HTMLElement>('[data-docx-editor-root]')
      if (!blockId || !root) return false
      revealDocxSource(root, blockId)
      let frames = 0
      const settle = (): void => {
        const element = root.querySelector<HTMLElement>(`[data-docx-source-id="${blockId.replace(/["\\]/g, '\\$&')}"]`)
        if (element) {
          element.scrollIntoView({ block: 'center' })
          return
        }
        frames += 1
        if (frames < REVEAL_FRAMES) window.requestAnimationFrame(settle)
      }
      window.requestAnimationFrame(settle)
      return true
    },
    fullText: () => docxModelText(editorRef.current.model)
  }), [scrollRef])

  return (
    <div
      ref={rootRef}
      className="kun-docx-surface"
      style={holdHeight ? { minHeight: Math.max(0, holdHeight - PANE_PADDING) } : undefined}
    >
      <DocxEditorViewer
        editor={editor}
        mode="read-only"
        zoom={zoom}
        onZoomChange={onZoomChange}
        pageGapBackgroundColor="transparent"
      />
    </div>
  )
}

/**
 * Where an element starts inside a scroll pane, in the pane's own pixels. Rects are
 * scaled by the app's body zoom and by the viewer's own zoom while scroll offsets
 * are not, so the pane's rect-to-layout ratio converts them.
 */
function offsetWithin(element: HTMLElement, scroller: HTMLElement): number {
  const box = scroller.getBoundingClientRect()
  const scale = scroller.offsetHeight > 0 && box.height > 0 ? box.height / scroller.offsetHeight : 1
  return (element.getBoundingClientRect().top - box.top) / scale + scroller.scrollTop
}

function mountedPages(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-docx-page-wrapper]'))
    .sort((a, b) => Number(a.dataset.docxPageIndex) - Number(b.dataset.docxPageIndex))
}

function findPage(scroller: HTMLElement, pageIndex: number): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-docx-page-wrapper][data-docx-page-index="${pageIndex}"]`)
}

/**
 * Pages outside the virtualized window are not in the DOM, so jump to where the
 * page should be from the stride of the pages that are, wait for it to mount,
 * then align it exactly.
 */
async function scrollToPage(scroller: HTMLElement, pageIndex: number): Promise<void> {
  let page = findPage(scroller, pageIndex)
  if (!page) {
    const mounted = mountedPages(scroller)
    const anchor = mounted[0]
    if (!anchor) return
    const next = mounted[1]
    const anchorIndex = Number(anchor.dataset.docxPageIndex)
    const anchorTop = offsetWithin(anchor, scroller)
    let stride = anchor.getBoundingClientRect().height / bodyScale(scroller)
    if (next) {
      const span = Number(next.dataset.docxPageIndex) - anchorIndex
      if (span > 0) stride = (offsetWithin(next, scroller) - anchorTop) / span
    }
    scroller.scrollTop = Math.max(0, anchorTop + (pageIndex - anchorIndex) * stride)
    for (let frame = 0; frame < 30 && !page; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      page = findPage(scroller, pageIndex)
    }
  }
  if (page) scroller.scrollTop = Math.max(0, offsetWithin(page, scroller) - 8)
}

function bodyScale(scroller: HTMLElement): number {
  const height = scroller.getBoundingClientRect().height
  return scroller.offsetHeight > 0 && height > 0 ? height / scroller.offsetHeight : 1
}
