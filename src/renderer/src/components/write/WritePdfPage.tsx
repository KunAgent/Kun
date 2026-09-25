import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContentItem
} from 'pdfjs-dist/build/pdf.mjs'
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

export type PageText = {
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

export function bytesFromBase64(base64: string): Uint8Array {
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

export function emptyPdfSelection(): WriteEditorSelectionState {
  return {
    text: '',
    ranges: [],
    charCount: 0,
    sourceKind: 'pdf'
  }
}

export function selectionFromPdf(root: HTMLElement): PdfSelectionSnapshot {
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

export function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

export function WritePdfPage({
  document,
  pageNumber,
  scale,
  selectionRects,
  onPageText,
  onViewport
}: {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  selectionRects: WriteSelectionPageRect[]
  onPageText: (page: PageText) => void
  /** Reports the rendered CSS-pixel page size once known / after zoom. */
  onViewport?: (page: number, size: { width: number; height: number }) => void
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
      const size = { width: viewport.width, height: viewport.height }
      setPageSize(size)
      onViewport?.(pageNumber, size)

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
  }, [document, onPageText, onViewport, pageNumber, scale])

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
