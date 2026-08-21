export type TurnUsagePopoverPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type RectEdges = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

const POPOVER_WIDTH = 352
const POPOVER_MAX_HEIGHT = 560
const POPOVER_MARGIN = 12
const POPOVER_GAP = 8

export function currentTurnUsageBodyZoom(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function calculateTurnUsagePopoverPlacement({
  anchorRect,
  contentHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: RectEdges
  contentHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): TurnUsagePopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const viewport = {
    height: viewportHeight / scale,
    width: viewportWidth / scale
  }
  const anchor = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const width = Math.min(POPOVER_WIDTH, Math.max(1, viewport.width - POPOVER_MARGIN * 2))
  const left = clamp(
    anchor.left,
    POPOVER_MARGIN,
    Math.max(POPOVER_MARGIN, viewport.width - POPOVER_MARGIN - width)
  )
  const targetHeight = Math.min(
    Math.max(1, contentHeight),
    POPOVER_MAX_HEIGHT,
    Math.max(1, viewport.height - POPOVER_MARGIN * 2)
  )
  const spaceAbove = Math.max(1, anchor.top - POPOVER_MARGIN - POPOVER_GAP)
  const spaceBelow = Math.max(1, viewport.height - anchor.bottom - POPOVER_MARGIN - POPOVER_GAP)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const maxHeight = Math.max(1, Math.min(targetHeight, openAbove ? spaceAbove : spaceBelow))
  const preferredTop = openAbove
    ? anchor.top - POPOVER_GAP - maxHeight
    : anchor.bottom + POPOVER_GAP
  const top = clamp(
    preferredTop,
    POPOVER_MARGIN,
    Math.max(POPOVER_MARGIN, viewport.height - POPOVER_MARGIN - maxHeight)
  )
  return { left, top, width, maxHeight }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
