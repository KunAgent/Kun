export const BROWSER_PREVIEW_GAP = 12
export const BROWSER_PREVIEW_RADIUS = 12
export const BROWSER_PREVIEW_CHROME = 16
const ASPECT_RATIO = 16 / 10
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 240

export interface BrowserPreviewSize { width: number; height: number }
export interface BrowserPreviewPosition { x: number; y: number }
export interface BrowserPreviewFrame extends BrowserPreviewSize, BrowserPreviewPosition {}
export interface BrowserPreviewGeometry { width: number; position: BrowserPreviewPosition }
export type BrowserPreviewResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function sizeFor(width: number, container: BrowserPreviewSize): BrowserPreviewSize {
  const availableWidth = Math.max(1, container.width - BROWSER_PREVIEW_GAP * 2)
  const availableHeight = Math.max(1, container.height - BROWSER_PREVIEW_GAP * 2)
  const maxWidth = Math.min(availableWidth, Math.max(1, availableHeight - BROWSER_PREVIEW_CHROME) * ASPECT_RATIO)
  const fitted = clamp(width, Math.min(MIN_WIDTH, maxWidth), maxWidth)
  return { width: Math.round(fitted), height: Math.min(availableHeight, Math.round(fitted / ASPECT_RATIO) + BROWSER_PREVIEW_CHROME) }
}

export function moveBrowserPreview(
  position: BrowserPreviewPosition, frame: BrowserPreviewSize, container: BrowserPreviewSize
): BrowserPreviewPosition {
  const gapX = Math.min(BROWSER_PREVIEW_GAP, Math.max(0, (container.width - frame.width) / 2))
  const gapY = Math.min(BROWSER_PREVIEW_GAP, Math.max(0, (container.height - frame.height) / 2))
  return {
    x: Math.round(clamp(position.x, gapX, Math.max(gapX, container.width - frame.width - gapX))),
    y: Math.round(clamp(position.y, gapY, Math.max(gapY, container.height - frame.height - gapY)))
  }
}

export function resolveBrowserPreviewFrame(
  container: BrowserPreviewSize, geometry?: BrowserPreviewGeometry, needsAttention = false
): BrowserPreviewFrame {
  const size = sizeFor(Math.max(geometry?.width ?? DEFAULT_WIDTH, needsAttention ? 480 : 0), container)
  const position = geometry?.position ?? {
    x: container.width - size.width - BROWSER_PREVIEW_GAP,
    y: container.height - size.height - BROWSER_PREVIEW_GAP
  }
  return { ...size, ...moveBrowserPreview(position, size, container) }
}

export function resizeBrowserPreview(
  start: BrowserPreviewFrame, direction: BrowserPreviewResizeDirection,
  delta: BrowserPreviewPosition, container: BrowserPreviewSize
): BrowserPreviewFrame {
  const horizontal = direction.includes('w') ? -1 : direction.includes('e') ? 1 : 0
  const vertical = direction.includes('n') ? -1 : direction.includes('s') ? 1 : 0
  const widthDelta = horizontal && vertical
    ? (horizontal * delta.x + vertical * delta.y / ASPECT_RATIO) / (1 + 1 / ASPECT_RATIO ** 2)
    : horizontal ? horizontal * delta.x : vertical * delta.y * ASPECT_RATIO
  const center = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  const maxWidth = horizontal < 0 ? start.x + start.width - BROWSER_PREVIEW_GAP
    : horizontal > 0 ? container.width - start.x - BROWSER_PREVIEW_GAP
      : Math.min(center.x - BROWSER_PREVIEW_GAP, container.width - center.x - BROWSER_PREVIEW_GAP) * 2
  const maxHeight = vertical < 0 ? start.y + start.height - BROWSER_PREVIEW_GAP
    : vertical > 0 ? container.height - start.y - BROWSER_PREVIEW_GAP
      : Math.min(center.y - BROWSER_PREVIEW_GAP, container.height - center.y - BROWSER_PREVIEW_GAP) * 2
  const size = sizeFor(start.width + widthDelta, {
    width: maxWidth + BROWSER_PREVIEW_GAP * 2,
    height: maxHeight + BROWSER_PREVIEW_GAP * 2
  })
  const position = {
    x: horizontal < 0 ? start.x + start.width - size.width : horizontal > 0 ? start.x : center.x - size.width / 2,
    y: vertical < 0 ? start.y + start.height - size.height : vertical > 0 ? start.y : center.y - size.height / 2
  }
  return { ...size, ...moveBrowserPreview(position, size, container) }
}
