import type { Rect } from './canvas-types'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * Compute new bounds given the handle being dragged and the canvas-space delta.
 *
 * Convention:
 * - Edges/corners on the right (e, ne, se) extend width to the right.
 * - Edges/corners on the left (w, nw, sw) extend width to the left (also moves x).
 * - Same idea vertically for y/height.
 * - shift = constrain aspect ratio (keep startBounds.width / startBounds.height).
 * - Width/height never go below 1 px; if user crosses the opposite edge, the box
 *   collapses to 1 instead of flipping. Flipping support can come later.
 */
export function computeResizedBounds(
  handle: ResizeHandle,
  start: Rect,
  dx: number,
  dy: number,
  shiftKey = false
): Rect {
  let x = start.x
  let y = start.y
  let width = start.width
  let height = start.height

  // Horizontal
  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    width = Math.max(1, start.width + dx)
  } else if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    const newWidth = Math.max(1, start.width - dx)
    x = start.x + (start.width - newWidth)
    width = newWidth
  }

  // Vertical
  if (handle === 's' || handle === 'sw' || handle === 'se') {
    height = Math.max(1, start.height + dy)
  } else if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    const newHeight = Math.max(1, start.height - dy)
    y = start.y + (start.height - newHeight)
    height = newHeight
  }

  // Constrain aspect ratio when shift is held and the handle moves both axes.
  // Edge handles (n/s/e/w) ignore shift — only corners constrain.
  const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
  if (shiftKey && isCorner && start.width > 0 && start.height > 0) {
    const aspect = start.width / start.height
    // Use the larger relative change as the driver
    const dwRel = width / start.width
    const dhRel = height / start.height
    if (Math.abs(dwRel - 1) >= Math.abs(dhRel - 1)) {
      const newHeight = Math.max(1, width / aspect)
      // Re-anchor y for n/nw/ne handles
      if (handle === 'nw' || handle === 'ne') {
        y = start.y + (start.height - newHeight)
      }
      height = newHeight
    } else {
      const newWidth = Math.max(1, height * aspect)
      // Re-anchor x for w/nw/sw handles
      if (handle === 'nw' || handle === 'sw') {
        x = start.x + (start.width - newWidth)
      }
      width = newWidth
    }
  }

  return { x, y, width, height }
}

/**
 * Scale a set of selected shapes from a starting collective bounds to a new one.
 * Each shape's position and size are proportionally remapped.
 */
export type ShapeBoundsLike = { x: number; y: number; width: number; height: number }

export function scaleShapesToBounds(
  shapeStarts: Map<string, ShapeBoundsLike>,
  startBounds: Rect,
  endBounds: Rect
): Map<string, ShapeBoundsLike> {
  const out = new Map<string, ShapeBoundsLike>()
  const sx = startBounds.width === 0 ? 1 : endBounds.width / startBounds.width
  const sy = startBounds.height === 0 ? 1 : endBounds.height / startBounds.height

  for (const [id, s] of shapeStarts) {
    const relX = s.x - startBounds.x
    const relY = s.y - startBounds.y
    out.set(id, {
      x: endBounds.x + relX * sx,
      y: endBounds.y + relY * sy,
      width: Math.max(1, s.width * sx),
      height: Math.max(1, s.height * sy)
    })
  }
  return out
}
