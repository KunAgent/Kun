import type { WriteSelectionAnchorRect } from '../write-markdown-editor-types'
export function barPlacement(anchor: WriteSelectionAnchorRect | null, options: {
  width: number; height: number; viewportWidth: number; viewportHeight: number; scale: number
  bounds?: { left: number; right: number; top: number; bottom: number }
}) {
  const scale = options.scale || 1
  const bounds = options.bounds ?? { left: 0, right: options.viewportWidth, top: 0, bottom: options.viewportHeight }
  const leftEdge = bounds.left / scale + 16, rightEdge = Math.min(bounds.right, options.viewportWidth) / scale - 16
  const topEdge = Math.max(0, bounds.top) / scale + 16, bottomEdge = Math.min(bounds.bottom, options.viewportHeight) / scale - 16
  const width = Math.max(0, Math.min(options.width, rightEdge - leftEdge))
  const left = Math.max(leftEdge, Math.min(anchor ? anchor.left / scale : leftEdge, rightEdge - width))
  let top = bottomEdge - options.height
  if (anchor && anchor.bottom >= bounds.top && anchor.top <= bounds.bottom) {
    const below = anchor.bottom / scale + 10, above = anchor.top / scale - 10 - options.height
    if (below + options.height <= bottomEdge) top = below
    else if (above >= topEdge) top = above
  }
  return { left, top: Math.max(topEdge, top), width }
}
