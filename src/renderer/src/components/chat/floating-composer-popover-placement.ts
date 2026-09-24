export type ComposerPopoverAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

export type ComposerPopoverPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type ComposerPopoverPlacementOptions = {
  anchorRect: ComposerPopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  preferredWidth: number
  maximumHeight: number
  margin?: number
  gap?: number
  coordinateScale?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateComposerPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  preferredWidth,
  maximumHeight,
  margin = 12,
  gap = 8,
  coordinateScale = 1
}: ComposerPopoverPlacementOptions): ComposerPopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const width = Math.min(preferredWidth, Math.max(1, normalizedViewportWidth - margin * 2))
  const anchorCenter = (normalizedAnchorRect.left + normalizedAnchorRect.right) / 2
  const left = clamp(
    anchorCenter - width / 2,
    margin,
    Math.max(margin, normalizedViewportWidth - margin - width)
  )
  const contentHeight = Math.max(1, popoverHeight)
  const targetHeight = Math.min(contentHeight, maximumHeight)
  const spaceAbove = Math.max(1, normalizedAnchorRect.top - margin - gap)
  const spaceBelow = Math.max(
    1,
    normalizedViewportHeight - normalizedAnchorRect.bottom - margin - gap
  )
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.min(maximumHeight, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - gap - visibleHeight
    : normalizedAnchorRect.bottom + gap
  const top = clamp(
    preferredTop,
    margin,
    Math.max(margin, normalizedViewportHeight - margin - visibleHeight)
  )

  return { left, top, width, maxHeight }
}
