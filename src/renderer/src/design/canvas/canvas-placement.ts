import { shapeGeometry, type CanvasDocument, type Rect, type ViewBox } from './canvas-types'

export const CANVAS_SCREEN_GAP = 80
export const CANVAS_SCREEN_FIT_PADDING = 96
export const BOARD_HTML_FRAME_MIN_WIDTH = 240
export const BOARD_HTML_FRAME_MIN_HEIGHT = 180

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback
}

function round(n: number): number {
  return Math.round(n)
}

export function rectsAlmostEqual(a: Rect | undefined, b: Rect, epsilon = 0.5): boolean {
  if (!a) return false
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
}

export function centerRectInViewport(width: number, height: number, vbox: ViewBox): Rect {
  const safeWidth = Math.max(1, finite(width, 1))
  const safeHeight = Math.max(1, finite(height, 1))
  return {
    x: round(finite(vbox.x) + finite(vbox.width, safeWidth) / 2 - safeWidth / 2),
    y: round(finite(vbox.y) + finite(vbox.height, safeHeight) / 2 - safeHeight / 2),
    width: safeWidth,
    height: safeHeight
  }
}

function rectsOverlapWithGap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

function collides(rect: Rect, occupied: readonly Rect[], gap: number): boolean {
  return occupied.some((item) => rectsOverlapWithGap(rect, item, gap))
}

function candidateRect(centered: Rect, col: number, row: number, gap: number): Rect {
  return {
    ...centered,
    x: round(centered.x + col * (centered.width + gap)),
    y: round(centered.y + row * (centered.height + gap))
  }
}

/**
 * Place a single new screen near the viewport center, but avoid existing screen
 * frames. This covers streaming `add_screen` calls where each block is applied
 * independently; without this, every omitted x/y lands on the same center point.
 */
export function placeRectInViewportAvoiding(
  size: { width: number; height: number },
  vbox: ViewBox,
  occupied: readonly Rect[],
  gap = CANVAS_SCREEN_GAP
): Rect {
  const safeGap = Math.max(0, finite(gap))
  const centered = centerRectInViewport(size.width, size.height, vbox)
  if (!collides(centered, occupied, safeGap)) return centered

  const seen = new Set<string>()
  const maxRings = Math.max(12, occupied.length + 8)
  const tryCandidate = (col: number, row: number): Rect | null => {
    const key = `${col}:${row}`
    if (seen.has(key)) return null
    seen.add(key)
    const rect = candidateRect(centered, col, row, safeGap)
    return collides(rect, occupied, safeGap) ? null : rect
  }

  for (let ring = 1; ring <= maxRings; ring += 1) {
    const preferred = [
      [ring, 0],
      [-ring, 0],
      [0, ring],
      [0, -ring]
    ] as const
    for (const [col, row] of preferred) {
      const rect = tryCandidate(col, row)
      if (rect) return rect
    }

    for (let row = -ring; row <= ring; row += 1) {
      for (const col of [ring, -ring]) {
        const rect = tryCandidate(col, row)
        if (rect) return rect
      }
    }
    for (let col = -ring + 1; col <= ring - 1; col += 1) {
      for (const row of [ring, -ring]) {
        const rect = tryCandidate(col, row)
        if (rect) return rect
      }
    }
  }

  const rightmost = occupied.reduce(
    (max, rect) => Math.max(max, rect.x + rect.width),
    centered.x + centered.width
  )
  return { ...centered, x: round(rightmost + safeGap) }
}

/** Place a revision beside its source before expanding in deterministic rings. */
export function placeRectNearAnchorAvoiding(
  size: { width: number; height: number },
  anchor: Rect,
  occupied: readonly Rect[],
  gap = CANVAS_SCREEN_GAP
): Rect {
  const safeGap = Math.max(0, finite(gap))
  const width = Math.max(1, finite(size.width, 1))
  const height = Math.max(1, finite(size.height, 1))
  const centeredX = round(anchor.x + anchor.width / 2 - width / 2)
  const centeredY = round(anchor.y + anchor.height / 2 - height / 2)
  const candidates: Rect[] = [
    { x: round(anchor.x + anchor.width + safeGap), y: centeredY, width, height },
    { x: round(anchor.x - width - safeGap), y: centeredY, width, height },
    { x: centeredX, y: round(anchor.y + anchor.height + safeGap), width, height },
    { x: centeredX, y: round(anchor.y - height - safeGap), width, height }
  ]
  for (const candidate of candidates) {
    if (!collides(candidate, occupied, safeGap)) return candidate
  }

  const stepX = Math.max(anchor.width, width) + safeGap
  const stepY = Math.max(anchor.height, height) + safeGap
  const seen = new Set(candidates.map((rect) => `${rect.x}:${rect.y}`))
  const tryOffset = (column: number, row: number): Rect | null => {
    const candidate = {
      x: round(centeredX + column * stepX),
      y: round(centeredY + row * stepY),
      width,
      height
    }
    const key = `${candidate.x}:${candidate.y}`
    if (seen.has(key)) return null
    seen.add(key)
    return collides(candidate, occupied, safeGap) ? null : candidate
  }
  const maxRings = Math.max(12, occupied.length + 8)
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const [column, row] of [[ring, 0], [-ring, 0], [0, ring], [0, -ring]] as const) {
      const candidate = tryOffset(column, row)
      if (candidate) return candidate
    }
    for (let row = -ring; row <= ring; row += 1) {
      for (const column of [ring, -ring]) {
        const candidate = tryOffset(column, row)
        if (candidate) return candidate
      }
    }
    for (let column = -ring + 1; column <= ring - 1; column += 1) {
      for (const row of [ring, -ring]) {
        const candidate = tryOffset(column, row)
        if (candidate) return candidate
      }
    }
  }

  const rightmost = occupied.reduce(
    (max, rect) => Math.max(max, rect.x + rect.width),
    anchor.x + anchor.width
  )
  return { x: round(rightmost + safeGap), y: centeredY, width, height }
}

type RowItem = { index: number; width: number; height: number }
type Row = { items: RowItem[]; width: number; height: number }

/**
 * Place a batch of screens around the user's current viewport center. Rows wrap
 * when the batch would become much wider than the visible canvas, so parallel
 * page runs stay inspectable instead of creating a long off-screen strip.
 */
export function layoutRectsInViewport(
  sizes: Array<{ width: number; height: number }>,
  vbox: ViewBox,
  gap = CANVAS_SCREEN_GAP
): Rect[] {
  if (sizes.length === 0) return []

  const safeGap = Math.max(0, finite(gap))
  const centerX = finite(vbox.x) + finite(vbox.width, 1) / 2
  const centerY = finite(vbox.y) + finite(vbox.height, 1) / 2
  const items = sizes.map((size, index) => ({
    index,
    width: Math.max(1, finite(size.width, 1)),
    height: Math.max(1, finite(size.height, 1))
  }))
  const widest = Math.max(...items.map((item) => item.width))
  const maxRowWidth = Math.max(widest, finite(vbox.width, widest) * 0.9)
  const rows: Row[] = []

  for (const item of items) {
    const current = rows[rows.length - 1]
    const nextWidth = current ? current.width + safeGap + item.width : item.width
    if (current && nextWidth > maxRowWidth) {
      rows.push({ items: [item], width: item.width, height: item.height })
    } else if (current) {
      current.items.push(item)
      current.width = nextWidth
      current.height = Math.max(current.height, item.height)
    } else {
      rows.push({ items: [item], width: item.width, height: item.height })
    }
  }

  const totalHeight = rows.reduce((sum, row, index) => sum + row.height + (index > 0 ? safeGap : 0), 0)
  let y = centerY - totalHeight / 2
  const rects = new Array<Rect>(items.length)

  for (const row of rows) {
    let x = centerX - row.width / 2
    for (const item of row.items) {
      rects[item.index] = {
        x: round(x),
        y: round(y + row.height / 2 - item.height / 2),
        width: item.width,
        height: item.height
      }
      x += item.width + safeGap
    }
    y += row.height + safeGap
  }

  return rects
}

export function getCanvasDocumentContentBounds(doc: CanvasDocument): Rect | null {
  const root = doc.objects[doc.rootId]
  if (!root) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  const visit = (id: string): void => {
    const shape = doc.objects[id]
    if (!shape || id === doc.rootId || !shape.visible) return
    const bounds = shapeGeometry(shape).selrect
    if (bounds.width > 0 && bounds.height > 0) {
      found = true
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.width)
      maxY = Math.max(maxY, bounds.y + bounds.height)
    }
    for (const childId of shape.children) visit(childId)
  }

  for (const childId of root.children) visit(childId)
  if (!found) return null
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
