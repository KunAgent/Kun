import type { DesignPreviewRenderState } from '../../../../design/design-preview-file'
import type { DesignArtifactFoundationRole } from '../../../../design/design-types'
import {
  executeDesignHtmlPreviewScript,
  shouldRenderDesignHtmlPreviewWebview
} from '../../DesignHtmlPreviewHost'
import {
  summarizeDesignHtmlQualityStatus,
  type DesignHtmlQualityFinding
} from '../../../../design/design-html-quality'

export const AI_CURSOR_TTL_MS = 4500
export const FRAME_AUTO_GROW_THRESHOLD = 12
export const HTML_FRAME_MIN_OVERLAY_ZOOM = 0.04
const FRAME_AUTO_GROW_MAX_WIDTH = 7_680
const FRAME_AUTO_GROW_MIN_WIDTH = 240
const FRAME_AUTO_GROW_MAX_HEIGHT = 12_000
const FRAME_AUTO_GROW_MIN_HEIGHT = 180
const HTML_FRAME_SCROLLBAR_STYLE_ID = '__kun_html_frame_auto_crop_scrollbars__'

export const HTML_FRAME_CONTENT_SIZE_QUERY = `(() => {
  try {
  const html = document.documentElement
  const body = document.body
  const nums = (...values) => values.filter((v) => Number.isFinite(v) && v > 0)
  const numericCss = (value) => {
    const n = Number.parseFloat(value || '0')
    return Number.isFinite(n) ? n : 0
  }
  const textRects = (el, style) => {
    const rects = []
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      if (!(node.textContent || '').trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const piece of Array.from(range.getClientRects())) {
        if (piece.width < 1 || piece.height < 1) continue
        const pieceRight = Number.isFinite(piece.right) ? piece.right : piece.width
        rects.push({
          bottom: piece.bottom + window.scrollY + numericCss(style.paddingBottom) + numericCss(style.borderBottomWidth),
          right: pieceRight + (window.scrollX || 0) + numericCss(style.paddingRight) + numericCss(style.borderRightWidth)
        })
      }
      if (typeof range.detach === 'function') range.detach()
    }
    return rects
  }
  // The exclusion threshold below MUST stay independent of window.innerHeight.
  // The <webview> host resizes this frame's CSS height to whatever we last
  // measured, so window.innerHeight is a self-referential signal here (it IS the
  // previous measurement, not an independent fact about the page). Using it as the
  // threshold created a shrink feedback loop: an early low reading would shrink the
  // frame, which shrinks window.innerHeight, which lowers the threshold, which
  // excludes MORE legitimate large sections next pass, converging to a permanently
  // too-small height. documentHeight (scrollHeight-based) reflects the page's real
  // natural content size and does not move just because we resized our own frame.
  const hasVisibleBoxPaint = (el, style, rect) => {
    if (el === body || el === html) return false
    const backgroundColor = style.backgroundColor || ''
    const hasBackgroundColor = backgroundColor && !/rgba?\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,\\s*0\\s*\\)|transparent/i.test(backgroundColor)
    const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none'
    if (hasBackgroundImage) return true
    if (rect.height > Math.max(480, documentHeight * 0.65)) return false
    return hasBackgroundColor
  }
  const documentHeight = Math.max(...nums(
    html?.scrollHeight,
    html?.offsetHeight,
    html?.clientHeight,
    body?.scrollHeight,
    body?.offsetHeight,
    body?.clientHeight
  ), 1)
  const candidates = body ? [body, ...Array.from(body.querySelectorAll('*'))] : []
  const visibleElementRects = candidates.flatMap((el) => {
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) return []
        const tag = el.tagName.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'template') return []
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return []
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return []
        const hasMedia = ['img', 'svg', 'canvas', 'video', 'picture'].includes(tag)
        return [
          ...textRects(el, style),
          ...(hasMedia || hasVisibleBoxPaint(el, style, rect)
            ? [{ bottom: rect.bottom + window.scrollY, right: (Number.isFinite(rect.right) ? rect.right : rect.width) + (window.scrollX || 0) }]
            : [])
        ]
      })
  const paintedHeight = visibleElementRects.length ? Math.max(...visibleElementRects.map((rect) => rect.bottom)) : 0
  const paintedWidth = visibleElementRects.length ? Math.max(...visibleElementRects.map((rect) => rect.right)) : 0
  const width = Math.max(...nums(
    html?.scrollWidth,
    html?.offsetWidth,
    html?.clientWidth,
    body?.scrollWidth,
    body?.offsetWidth,
    body?.clientWidth,
    paintedWidth,
    window.innerWidth
  ), 1)
  const height = paintedHeight > 0 ? Math.min(documentHeight, paintedHeight + 16) : documentHeight
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    documentHeight: Math.ceil(documentHeight),
    paintedHeight: Math.ceil(paintedHeight),
    paintedWidth: Math.ceil(paintedWidth)
  }
  } catch {
    return null
  }
})()`

export function htmlFrameShouldSuppressDocumentScrollbars({
  measuredHeight,
  documentHeight
}: {
  measuredHeight: number
  documentHeight: number
}): boolean {
  return documentHeight > measuredHeight + FRAME_AUTO_GROW_THRESHOLD
}

export function htmlFrameShouldApplyScrollbarSuppression({
  autoResizeEnabled,
  suppressScrollbars
}: {
  autoResizeEnabled: boolean
  suppressScrollbars: boolean
}): boolean {
  return autoResizeEnabled && suppressScrollbars
}

export function buildHtmlFrameScrollbarSuppressionScript(suppress: boolean): string {
  const css = `
    html,
    body {
      overflow: hidden !important;
      min-height: 0 !important;
    }
    ::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
  `
  return `(() => {
    try {
    const id = ${JSON.stringify(HTML_FRAME_SCROLLBAR_STYLE_ID)}
    const existing = document.getElementById(id)
    if (!${JSON.stringify(suppress)}) {
      if (existing) existing.remove()
      return
    }
    const style = existing || document.createElement('style')
    style.id = id
    style.textContent = ${JSON.stringify(css)}
    ;(document.head || document.documentElement).appendChild(style)
    } catch {
      return
    }
  })()`
}

type HtmlFrameWebviewScriptHost = {
  executeJavaScript?: (code: string) => Promise<unknown>
}

export function executeHtmlFrameWebviewScript(
  webview: HtmlFrameWebviewScriptHost | null | undefined,
  code: string
): Promise<unknown> | null {
  return executeDesignHtmlPreviewScript(webview, code)
}

export type HtmlFrameMeasurementDecision = {
  nextWidth: number
  nextHeight: number
  documentHeight: number
  suppressScrollbars: boolean
}

export function resolveHtmlFrameMeasurementDecision(value: unknown): HtmlFrameMeasurementDecision | null {
  if (!value || typeof value !== 'object') return null
  const measured = value as { width?: unknown; height?: unknown; documentHeight?: unknown }
  if (typeof measured.width !== 'number' || !Number.isFinite(measured.width)) return null
  if (typeof measured.height !== 'number' || !Number.isFinite(measured.height)) return null
  const documentHeight =
    typeof measured.documentHeight === 'number' && Number.isFinite(measured.documentHeight)
      ? measured.documentHeight
      : measured.height
  const rawMeasuredHeight = Math.max(1, Math.ceil(measured.height))
  const nextWidth = Math.max(
    FRAME_AUTO_GROW_MIN_WIDTH,
    Math.min(FRAME_AUTO_GROW_MAX_WIDTH, Math.ceil(measured.width))
  )
  const nextHeight = Math.max(
    FRAME_AUTO_GROW_MIN_HEIGHT,
    Math.min(FRAME_AUTO_GROW_MAX_HEIGHT, rawMeasuredHeight)
  )
  return {
    nextWidth,
    nextHeight,
    documentHeight,
    suppressScrollbars: htmlFrameShouldSuppressDocumentScrollbars({
      measuredHeight: rawMeasuredHeight,
      documentHeight
    })
  }
}

export function qualityBadgeClasses(kind: ReturnType<typeof summarizeDesignHtmlQualityStatus>['kind']): string {
  if (kind === 'critical') return 'border-red-300/70 bg-red-50/92 text-red-700 dark:border-red-400/35 dark:bg-red-950/80 dark:text-red-200'
  if (kind === 'warning') return 'border-amber-300/70 bg-amber-50/92 text-amber-800 dark:border-amber-400/35 dark:bg-amber-950/80 dark:text-amber-200'
  if (kind === 'passed') return 'border-emerald-300/70 bg-emerald-50/92 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-950/80 dark:text-emerald-200'
  return 'border-ds-border bg-white/88 text-[#526070] dark:border-white/15 dark:bg-[#20252e] dark:text-white/70'
}

export function qualityFindingClasses(severity: DesignHtmlQualityFinding['severity']): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50/75 text-red-700 dark:border-red-400/30 dark:bg-red-950/70 dark:text-red-200'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50/75 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/70 dark:text-amber-200'
  return 'border-sky-200 bg-sky-50/75 text-sky-700 dark:border-sky-400/30 dark:bg-sky-950/70 dark:text-sky-200'
}

export function qualityFindingLabel(severity: DesignHtmlQualityFinding['severity']): string {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'note'
}

export function shouldRenderHtmlFrameWebview({
  fileUrl,
  previewState,
  hasRenderableContent
}: {
  fileUrl: string
  previewState: DesignPreviewRenderState
  hasRenderableContent: boolean
}): boolean {
  return shouldRenderDesignHtmlPreviewWebview({
    fileUrl,
    renderState: previewState,
    hasRenderableContent
  })
}

/**
 * The full-frame brush-sketch placeholder takes over while a screen frame is
 * generating and no webview is mounted yet (the skeleton HTML file is never
 * painted anymore). Errors and failures fall back to the plain placeholder so
 * their messages stay readable.
 */
export function htmlFrameShouldShowGeneratingCanvas({
  webviewMounted,
  hasArtifact,
  transparentGeneratingSurface,
  drawingActive,
  previewError,
  failedMessage
}: {
  webviewMounted: boolean
  hasArtifact: boolean
  transparentGeneratingSurface: boolean
  drawingActive: boolean
  previewError: string
  failedMessage: string
}): boolean {
  return (
    !webviewMounted &&
    hasArtifact &&
    transparentGeneratingSurface &&
    drawingActive &&
    !previewError &&
    !failedMessage
  )
}

export function htmlFrameOverlayPointerEvents({
  panning,
  interactive
}: {
  panning: boolean
  interactive: boolean
}): 'auto' | 'none' {
  if (panning) return 'none'
  return interactive ? 'auto' : 'none'
}

export function htmlFrameOverlayCanMountAtZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= HTML_FRAME_MIN_OVERLAY_ZOOM
}

export type HtmlFramePreviewAsyncEpoch = {
  shapeId: string
  artifactId: string
  artifactRelativePath: string
  previewWebviewUrl: string
  previewRevision: number
  webviewMountNonce: number
}

export function htmlFramePreviewAsyncEpochMatches(
  captured: HtmlFramePreviewAsyncEpoch | null,
  current: HtmlFramePreviewAsyncEpoch | null
): boolean {
  return Boolean(
    captured &&
      current &&
      captured.shapeId === current.shapeId &&
      captured.artifactId === current.artifactId &&
      captured.artifactRelativePath === current.artifactRelativePath &&
      captured.previewWebviewUrl === current.previewWebviewUrl &&
      captured.previewRevision === current.previewRevision &&
      captured.webviewMountNonce === current.webviewMountNonce
  )
}

export function htmlFrameShouldPromotePreviewToReady({
  previewStatus,
  previewRenderState,
  drawingActive,
  artifactRelativePath,
  previewRelativePath
}: {
  previewStatus?: 'pending' | 'ready' | 'error'
  previewRenderState: DesignPreviewRenderState
  drawingActive: boolean
  artifactRelativePath?: string
  previewRelativePath?: string
}): boolean {
  const artifactPath = artifactRelativePath?.trim()
  return Boolean(
    previewStatus === 'pending' &&
      previewRenderState === 'renderable' &&
      !drawingActive &&
      artifactPath &&
      previewRelativePath === artifactPath
  )
}

export function htmlFrameWebviewCanvasStyle({
  canvasWidth,
  visualCanvasHeight,
  zoom,
  interactive
}: {
  canvasWidth: number
  visualCanvasHeight: number
  zoom: number
  interactive: boolean
}): {
  display: 'flex'
  width: number
  height: number
  transform: string
  transformOrigin: 'left top'
  pointerEvents: 'auto' | 'none'
} {
  return {
    // Electron's <webview> hosts its guest in a shadow <iframe> styled
    // `flex: 1 1 auto; width: 100%` with NO height — it only fills the host
    // when the host stays `display: flex`. Forcing block (e.g. a Tailwind
    // `block` class) collapses the guest viewport to the 150px replaced-
    // element default, painting the page as a short strip inside the frame.
    display: 'flex',
    width: canvasWidth,
    height: visualCanvasHeight,
    transform: `scale(${zoom})`,
    transformOrigin: 'left top',
    pointerEvents: interactive ? 'auto' : 'none'
  }
}

export function shouldAutoResizeHtmlFrame({
  sizeMode
}: {
  sizeMode?: 'auto' | 'manual' | 'manual-width-auto-height'
  role?: DesignArtifactFoundationRole
  previewStatus?: 'pending' | 'ready' | 'error'
  parallelStatus?: 'queued' | 'running' | 'done' | 'failed'
}): boolean {
  return sizeMode !== 'manual'
}

/**
 * Only foundation reference docs (design system / logo) may auto-grow their
 * frame WIDTH from measured content — they legitimately need to widen to show
 * component grids/specimens. Regular screens represent a fixed device
 * viewport (e.g. a 390px-wide phone mockup); a device mockup's width should
 * stay pinned to the device target regardless of measured content, the same
 * way resizing a browser window doesn't change a phone's screen size. This
 * must stay consistent with design-board.ts's genericFrameSizeForArtifact,
 * which is the other half of this width policy.
 */
export function htmlFrameAllowsWidthAutoGrow(foundationRole: DesignArtifactFoundationRole | undefined): boolean {
  return Boolean(foundationRole)
}

export function htmlFrameDrawingActive({
  foundationRole,
  previewStatus,
  parallelStatus,
  pagesRunPhase,
  pagesRunStep,
  chatBusy
}: {
  foundationRole?: DesignArtifactFoundationRole
  previewStatus?: 'pending' | 'ready' | 'error'
  parallelStatus?: 'queued' | 'running' | 'done' | 'failed'
  pagesRunPhase?: 'foundation' | 'planning' | 'generating'
  pagesRunStep?: 'spec' | 'system' | 'logo'
  chatBusy: boolean
}): boolean {
  if (parallelStatus === 'queued' || parallelStatus === 'running') return true
  if (
    pagesRunPhase === 'foundation' &&
    (
      (pagesRunStep === 'system' && foundationRole === 'design-system') ||
      (pagesRunStep === 'logo' && foundationRole === 'logo')
    )
  ) {
    return true
  }
  return !foundationRole && !parallelStatus && previewStatus === 'pending' && chatBusy
}

/**
 * Runs inside the live webview to locate the section the agent just wrote: the
 * LAST element tagged `data-ds-section` (sections are written top-to-bottom), or
 * the last top-level body child as a fallback for untagged HTML. Returns its
 * label + rect in the webview's CSS px, which maps 1:1 to the overlay content div.
 */
export const AI_SECTION_QUERY = `(() => {
  try {
  const tagged = document.querySelectorAll('[data-ds-section]')
  let el = null
  let label = ''
  if (tagged.length) {
    el = tagged[tagged.length - 1]
    label = el.getAttribute('data-ds-section') || ''
  } else if (document.body) {
    const kids = Array.prototype.slice.call(document.body.children).filter((n) => {
      const r = n.getBoundingClientRect()
      return r.height > 8 && r.width > 8
    })
    el = kids.length ? kids[kids.length - 1] : null
  }
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  return { label: label, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  } catch {
    return null
  }
})()`

/**
 * Chromium stores zoom by origin inside a session. Design frames all load
 * file:// HTML, so sharing one partition lets one frame's zoom overwrite
 * another's. A stable per-frame in-memory partition keeps native zoom local.
 */
export function htmlFrameWebviewPartition(shapeId: string): string {
  const safeId = shapeId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `kun-proto-frame-${safeId || 'frame'}`
}
