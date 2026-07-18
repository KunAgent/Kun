import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type TextContentItem
} from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type {
  WriteEditorSelectionState,
  WriteSelectionAnchorRect,
  WriteSelectionPageRect
} from './WriteMarkdownEditor'
import { viewportRectToPageLocalRect } from './write-pdf-selection-geometry'
import {
  applyPdfTextLayerScale,
  startPdfTextLayerRenderWithoutUiZoom
} from './write-pdf-text-layer'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Props = {
  filePath: string
  dataBase64: string
  size: number
  mtimeMs: number
  workspaceRoot: string
  viewerRef?: RefObject<HTMLDivElement | null>
  onSelectionChange: (selection: WriteEditorSelectionState) => void
}

type PageText = {
  page: number
  text: string
}

type PdfSelectionSnapshot = WriteEditorSelectionState & {
  rects?: WriteSelectionPageRect[]
}

type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function unionRects(rects: DOMRect[]): WriteSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function anchorRectFromDomRect(rect: DOMRect): WriteSelectionAnchorRect | undefined {
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return undefined
  }
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function isSelectionBackward(selection: Selection): boolean {
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!anchor || !focus) return false
  if (anchor === focus) return selection.anchorOffset > selection.focusOffset
  return Boolean(anchor.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_PRECEDING)
}

function intersects(a: ViewportRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// pdf.js text layers are made of dozens of absolutely positioned spans per
// line, plus stretched whitespace-only spans and container boxes. Painting
// `range.getClientRects()` verbatim therefore produces overlapping blotches
// and full-width trailing bands. Collect rects from real text fragments only.
const MAX_SELECTION_FRAGMENT_RECTS = 6000

function collectRangeTextRects(range: Range): DOMRect[] {
  const doc = range.startContainer.ownerDocument ?? window.document
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  const probe = doc.createRange()
  const rects: DOMRect[] = []

  let node: Node | null
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    walker.currentNode = range.startContainer
    node = range.startContainer
  } else {
    walker.currentNode = range.startContainer
    node = walker.nextNode()
  }

  while (node && rects.length < MAX_SELECTION_FRAGMENT_RECTS) {
    if (range.comparePoint(node, 0) > 0) break
    const text = node as Text
    if (
      text.data.trim() &&
      text.parentElement?.closest('.write-pdf-text-layer') &&
      range.intersectsNode(text)
    ) {
      probe.selectNodeContents(text)
      if (text === range.startContainer) probe.setStart(text, range.startOffset)
      if (text === range.endContainer) probe.setEnd(text, range.endOffset)
      for (const rect of probe.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) rects.push(rect)
      }
    }
    if (text === range.endContainer) break
    node = walker.nextNode()
  }
  return rects
}

// Merge fragment rects into one bar per visual line (split only across large
// horizontal gaps such as column gutters) so the committed highlight reads
// like a continuous text selection instead of stacked translucent chunks.
const LINE_MERGE_WINDOW = 6

function mergeRectsIntoLineBars(rects: DOMRect[]): ViewportRect[] {
  if (rects.length === 0) return []
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  type LineBucket = { top: number; bottom: number; segments: Array<{ left: number; right: number }> }
  const lines: LineBucket[] = []

  for (const rect of sorted) {
    let target: LineBucket | null = null
    for (let index = lines.length - 1; index >= 0 && index >= lines.length - LINE_MERGE_WINDOW; index -= 1) {
      const line = lines[index]
      const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top)
      if (overlap > 0 && overlap >= Math.min(line.bottom - line.top, rect.height) * 0.45) {
        target = line
        break
      }
    }
    if (target) {
      target.top = Math.min(target.top, rect.top)
      target.bottom = Math.max(target.bottom, rect.bottom)
      target.segments.push({ left: rect.left, right: rect.right })
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, segments: [{ left: rect.left, right: rect.right }] })
    }
  }

  const bars: ViewportRect[] = []
  for (const line of lines) {
    const gapLimit = Math.max(10, (line.bottom - line.top) * 0.85)
    const segments = [...line.segments].sort((a, b) => a.left - b.left)
    let current = { ...segments[0] }
    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment.left - current.right <= gapLimit) {
        current.right = Math.max(current.right, segment.right)
      } else {
        bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
        current = { ...segment }
      }
    }
    bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
  }
  return bars
}

function pageRectsFromViewportRects(root: HTMLElement, rects: ViewportRect[]): WriteSelectionPageRect[] {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]')).map((element) => {
    const rect = element.getBoundingClientRect()
    const styleWidth = Number.parseFloat(element.style.width)
    const styleHeight = Number.parseFloat(element.style.height)
    return {
      page: Number(element.dataset.writePdfPage ?? ''),
      rect,
      localSize: {
        width: styleWidth > 0 ? styleWidth : element.offsetWidth || rect.width,
        height: styleHeight > 0 ? styleHeight : element.offsetHeight || rect.height
      }
    }
  }).filter((page) => Number.isFinite(page.page) && page.page > 0)
  const out: WriteSelectionPageRect[] = []

  for (const rect of rects) {
    const page = pages.find((item) => intersects(rect, item.rect))
    if (!page) continue
    const left = Math.max(rect.left, page.rect.left)
    const right = Math.min(rect.right, page.rect.right)
    const top = Math.max(rect.top, page.rect.top)
    const bottom = Math.min(rect.bottom, page.rect.bottom)
    if (right <= left || bottom <= top) continue
    const localRect = viewportRectToPageLocalRect(
      { left, right, top, bottom },
      page.rect,
      page.localSize
    )
    out.push({
      page: page.page,
      ...localRect
    })
  }
  return out
}

function pageFromNode(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement
  const pageElement = element?.closest<HTMLElement>('[data-write-pdf-page]')
  const page = Number(pageElement?.dataset.writePdfPage ?? '')
  return Number.isFinite(page) && page > 0 ? page : null
}

function emptyPdfSelection(): WriteEditorSelectionState {
  return {
    text: '',
    ranges: [],
    charCount: 0,
    sourceKind: 'pdf'
  }
}

function selectionFromPdf(root: HTMLElement): PdfSelectionSnapshot {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return emptyPdfSelection()
  const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
  const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
  if (!anchorInside || !focusInside) return emptyPdfSelection()

  const text = selection.toString().trim()
  if (!text) return emptyPdfSelection()
  const range = selection.getRangeAt(0)
  const pageA = pageFromNode(selection.anchorNode)
  const pageB = pageFromNode(selection.focusNode)
  const pageStart = Math.min(pageA ?? pageB ?? 1, pageB ?? pageA ?? 1)
  const pageEnd = Math.max(pageA ?? pageB ?? pageStart, pageB ?? pageA ?? pageStart)
  const textRects = collectRangeTextRects(range)
  const backward = isSelectionBackward(selection)
  const focusRect = textRects.length > 0
    ? textRects[backward ? 0 : textRects.length - 1]
    : null
  const rects = pageRectsFromViewportRects(root, mergeRectsIntoLineBars(textRects))
  const anchorRect = (focusRect ? anchorRectFromDomRect(focusRect) : undefined)
    ?? unionRects(textRects)
    ?? anchorRectFromDomRect(range.getBoundingClientRect())
  return {
    text,
    ranges: [{
      from: 0,
      to: text.length,
      startLine: pageStart,
      startColumn: 1,
      endLine: pageEnd,
      endColumn: text.length + 1,
      text,
      charCount: text.length,
      page: pageStart
    }],
    charCount: text.length,
    sourceKind: 'pdf',
    pageStart,
    pageEnd,
    anchorRect,
    rects
  }
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

function WritePdfPage({
  document,
  pageNumber,
  scale,
  selectionRects,
  onPageText
}: {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  selectionRects: WriteSelectionPageRect[]
  onPageText: (page: PageText) => void
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerHostRef = useRef<HTMLDivElement | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null
    let textLayerBuilder: { cancel: () => void } | null = null

    const renderPage = async (): Promise<void> => {
      const canvas = canvasRef.current
      const textLayerHost = textLayerHostRef.current
      if (!canvas || !textLayerHost) return
      const page: PDFPageProxy = await document.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const outputScale = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setPageSize({ width: viewport.width, height: viewport.height })

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
      const task = page.render({ canvasContext: context, viewport })
      renderTask = task
      await task.promise
      if (cancelled) return

      textLayerHost.replaceChildren()
      const textContent = await page.getTextContent()
      if (cancelled) return
      // pdf_viewer.mjs reads the namespace that build/pdf.mjs installs on
      // globalThis, so load the builder only after the core module is active.
      const { TextLayerBuilder } = await import('pdfjs-dist/web/pdf_viewer.mjs')
      if (cancelled) return
      const builder = new TextLayerBuilder({
        pdfPage: page,
        onAppend: (div) => {
          if (!cancelled) textLayerHost.replaceChildren(div)
        }
      })
      textLayerBuilder = builder
      builder.div.classList.add('write-pdf-text-layer')
      applyPdfTextLayerScale(builder.div.style, viewport)
      const textLayerRender = startPdfTextLayerRenderWithoutUiZoom(
        () => builder.render({ viewport })
      )
      await textLayerRender
      if (!cancelled) {
        const text = textContent.items
          .map((item: TextContentItem) => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim()
        onPageText({ page: pageNumber, text })
      }
      page.cleanup()
    }

    void renderPage().catch(() => undefined)
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayerBuilder?.cancel()
    }
  }, [document, onPageText, pageNumber, scale])

  return (
    <div
      className="write-pdf-page"
      data-write-pdf-page={pageNumber}
      ref={(node) => {
        if (node && pageSize) {
          node.style.width = `${pageSize.width}px`
          node.style.height = `${pageSize.height}px`
        }
      }}
    >
      <canvas ref={canvasRef} className="write-pdf-canvas" />
      <div ref={textLayerHostRef} className="write-pdf-text-layer-host" />
      <div className="write-pdf-overlay-layer" aria-hidden="true">
        {selectionRects.map((rect, index) => (
          <span
            key={`${pageNumber}-${index}-${rect.x}-${rect.y}`}
            className="write-pdf-selection-rect"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function WritePdfViewer({
  filePath,
  dataBase64,
  size,
  mtimeMs,
  workspaceRoot,
  viewerRef,
  onSelectionChange
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const localViewerRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const selectionSyncTimerRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1.15)
  const [pageInput, setPageInput] = useState('1')
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [pageTexts, setPageTexts] = useState<PageText[]>([])
  const [committedSelectionRects, setCommittedSelectionRects] = useState<WriteSelectionPageRect[]>([])
  // Precise fragment rects are shown while dragging and kept after focus moves
  // into the assist popup, while the DOM Selection remains the text source.
  const pageCount = pdfDocument?.numPages ?? 0
  const rootRef = viewerRef ?? localViewerRef

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfDocument(null)
    setPageTexts([])
    setCommittedSelectionRects([])
    onSelectionChange(emptyPdfSelection())
    const task = getDocument({
      data: bytesFromBase64(dataBase64),
      isEvalSupported: false
    })
    void task.promise.then((pdf) => {
      if (cancelled) {
        void pdf.destroy()
        return
      }
      setPdfDocument(pdf)
      setPageInput('1')
      setCurrentPage(1)
      setLoading(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [dataBase64, filePath, mtimeMs, onSelectionChange])

  useEffect(() => {
    return () => {
      if (pdfDocument) void pdfDocument.destroy()
    }
  }, [pdfDocument])

  useEffect(() => {
    setCommittedSelectionRects([])
    onSelectionChange(emptyPdfSelection())
  }, [onSelectionChange, scale])

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return pageTexts
      .filter((page) => page.text.toLowerCase().includes(query))
      .map((page) => page.page)
      .sort((a, b) => a - b)
  }, [pageTexts, searchQuery])
  const allPageTextLoaded = pageCount > 0 && pageTexts.length >= pageCount
  const pdfHasText = pageTexts.some((page) => page.text.trim().length > 0)
  const committedRectsByPage = useMemo(() => {
    const byPage = new Map<number, WriteSelectionPageRect[]>()
    for (const rect of committedSelectionRects) {
      const pageRects = byPage.get(rect.page)
      if (pageRects) pageRects.push(rect)
      else byPage.set(rect.page, [rect])
    }
    return byPage
  }, [committedSelectionRects])

  const updatePageText = useCallback((page: PageText): void => {
    setPageTexts((current) => {
      const existing = current.find((item) => item.page === page.page)
      if (existing?.text === page.text) return current
      const next = current.filter((item) => item.page !== page.page)
      next.push(page)
      return next.sort((a, b) => a.page - b.page)
    })
  }, [])

  const scrollToPage = useCallback((page: number): void => {
    const clamped = Math.max(1, Math.min(pageCount || 1, Math.round(page)))
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pageCount])

  const updateCurrentPageFromScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller || pageRefs.current.size === 0) return
    const scrollerRect = scroller.getBoundingClientRect()
    const targetY = scrollerRect.top + scrollerRect.height * 0.42
    let bestPage = 1
    let bestDistance = Number.POSITIVE_INFINITY

    pageRefs.current.forEach((node, page) => {
      const rect = node.getBoundingClientRect()
      const distance = targetY >= rect.top && targetY <= rect.bottom
        ? 0
        : Math.min(Math.abs(targetY - rect.top), Math.abs(targetY - rect.bottom))
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = page
      }
    })

    setCurrentPage((value) => value === bestPage ? value : bestPage)
    setPageInput((value) => value === String(bestPage) ? value : String(bestPage))
  }, [])

  const schedulePageSync = useCallback((): void => {
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateCurrentPageFromScroll()
    })
  }, [updateCurrentPageFromScroll])

  const jumpSearch = (direction: 1 | -1): void => {
    if (searchMatches.length === 0) return
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
    setSearchIndex(nextIndex)
    scrollToPage(searchMatches[nextIndex])
  }

  useEffect(() => {
    setSearchIndex(0)
    if (searchMatches.length > 0) scrollToPage(searchMatches[0])
  }, [scrollToPage, searchMatches])

  const syncSelection = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const next = selectionFromPdf(root)
    onSelectionChange(next)
    if (next.text.trim()) {
      setCommittedSelectionRects(next.rects ?? [])
    } else {
      setCommittedSelectionRects([])
    }
  }, [onSelectionChange, rootRef])

  const syncSelectionSoon = useCallback((): void => {
    if (selectionSyncTimerRef.current != null) {
      window.clearTimeout(selectionSyncTimerRef.current)
    }
    selectionSyncTimerRef.current = window.setTimeout(() => {
      selectionSyncTimerRef.current = null
      syncSelection()
    }, 0)
  }, [syncSelection])

  useEffect(() => {
    const handleSelectionChange = (): void => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root) return
      if (!selection || selection.rangeCount === 0) {
        return
      }
      const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
      const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
      if (anchorInside || focusInside) {
        syncSelectionSoon()
        return
      }
      // If selection moved elsewhere (e.g. into the assist popup input), keep
      // the committed snapshot visible in the overlay.
    }
    window.document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      window.document.removeEventListener('selectionchange', handleSelectionChange)
      if (selectionSyncTimerRef.current != null) {
        window.clearTimeout(selectionSyncTimerRef.current)
        selectionSyncTimerRef.current = null
      }
    }
  }, [rootRef, syncSelectionSoon])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  const beginPdfSelection = useCallback((): void => {
    setCommittedSelectionRects([])
    onSelectionChange(emptyPdfSelection())
  }, [onSelectionChange])

  return (
    <div
      ref={rootRef}
      className="write-pdf-viewer flex h-full min-h-0 min-w-0 flex-col"
    >
      <div className="write-pdf-toolbar shrink-0 border-b border-ds-border-muted bg-white/88 px-3 py-2 dark:bg-ds-card/95">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">
            {formatSize(size)} · {workspaceRoot ? filePath.replace(`${workspaceRoot}/`, '') : filePath}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfZoomOut')}
              aria-label={t('writePdfZoomOut')}
              onClick={() => setScale((value) => Math.max(0.65, Number((value - 0.1).toFixed(2))))}
            >
              <Minus className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <span className="min-w-[52px] text-center text-[12px] font-semibold text-ds-muted">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfZoomIn')}
              aria-label={t('writePdfZoomIn')}
              onClick={() => setScale((value) => Math.min(2.4, Number((value + 0.1).toFixed(2))))}
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfPrevPage')}
              aria-label={t('writePdfPrevPage')}
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                scrollToPage(Number(pageInput))
              }}
            >
              <input
                className="write-pdf-page-input"
                value={pageInput}
                aria-label={t('writePdfPageInput')}
                onChange={(event) => setPageInput(event.target.value)}
              />
              <span className="text-[12px] text-ds-faint">/ {pageCount || '-'}</span>
            </form>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfNextPage')}
              aria-label={t('writePdfNextPage')}
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={!pageCount || currentPage >= pageCount}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
          <div className="flex min-w-[180px] flex-1 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 dark:bg-white/6 sm:max-w-[260px]">
            <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
              value={searchQuery}
              placeholder={t('writePdfSearchPlaceholder')}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <span className="shrink-0 text-[11px] text-ds-faint">
              {searchQuery.trim() ? `${searchMatches.length ? searchIndex + 1 : 0}/${searchMatches.length}` : ''}
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfPrevMatch')}
              aria-label={t('writePdfPrevMatch')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(-1)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={t('writePdfNextMatch')}
              aria-label={t('writePdfNextMatch')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(1)}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="write-pdf-scroller min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
        onPointerDown={beginPdfSelection}
        onPointerUp={syncSelectionSoon}
        onMouseUp={syncSelectionSoon}
        onKeyUp={syncSelectionSoon}
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
            {Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1).map((pageNumber) => (
              <div
                key={pageNumber}
                ref={(node) => {
                  if (node) pageRefs.current.set(pageNumber, node)
                  else pageRefs.current.delete(pageNumber)
                }}
              >
                <WritePdfPage
                  document={pdfDocument}
                  pageNumber={pageNumber}
                  scale={scale}
                  selectionRects={committedRectsByPage.get(pageNumber) ?? []}
                  onPageText={updatePageText}
                />
                <div className="mt-1 select-none text-center text-[11px] text-ds-faint">
                  {t('writePdfPageLabel', { page: pageNumber })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
