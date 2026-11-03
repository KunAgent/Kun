const TEXT_NODE = 3
const TEXT_RUN = '[data-docx-text-start]'
const PAGE = '[data-docx-page-wrapper]'
const INTERACTIVE = 'a[href], button, input, textarea, select, summary, [role="button"]'
const AUTOSCROLL_MIN = 6
const AUTOSCROLL_MAX = 48

export type CaretPoint = { node: Node; offset: number }
export type CaretFromPoint = (x: number, y: number) => CaretPoint | null

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

export function caretFromPoint(x: number, y: number): CaretPoint | null {
  const doc = document as CaretDocument
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

function isTextIn(root: HTMLElement, point: CaretPoint | null): point is CaretPoint {
  return Boolean(point && point.node.nodeType === TEXT_NODE && root.contains(point.node))
}

/** Rows win over columns: the pointer's own line beats a wider line above it. */
function closer(rect: DOMRect, best: DOMRect | null, x: number, y: number): boolean {
  if (!best) return true
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  const bestDy = Math.max(best.top - y, 0, y - best.bottom)
  if (Math.abs(dy - bestDy) > 0.5) return dy < bestDy
  return Math.max(rect.left - x, 0, x - rect.right) < Math.max(best.left - x, 0, x - best.right)
}

/**
 * The text position under a point. The Word viewer lays each line out as an
 * absolutely positioned box, so the blank to the right of a line (or between
 * lines) hit-tests to the start of its paragraph; there the nearest line is used,
 * with the point pulled onto it.
 */
export function textPointAt(
  root: HTMLElement,
  x: number,
  y: number,
  resolve: CaretFromPoint = caretFromPoint
): CaretPoint | null {
  const direct = resolve(x, y)
  if (isTextIn(root, direct)) return direct
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  const scope = (hit && root.contains(hit) ? hit.closest(PAGE) : null) ?? root
  let nearest: DOMRect | null = null
  for (const run of scope.querySelectorAll(TEXT_RUN)) {
    for (const rect of run.getClientRects()) {
      if (rect.width <= 0 && rect.height <= 0) continue
      if (closer(rect, nearest, x, y)) nearest = rect
    }
  }
  if (!nearest) return null
  const clampedX = Math.min(Math.max(x, nearest.left + 1), Math.max(nearest.left + 1, nearest.right - 1))
  const point = resolve(clampedX, nearest.top + nearest.height / 2)
  return isTextIn(root, point) ? point : null
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

function samePoint(a: CaretPoint | null, b: CaretPoint | null): boolean {
  return Boolean(a && b && a.node === b.node && a.offset === b.offset)
}

/**
 * Text selection by mouse drag for the Word viewer. The browser's own drag
 * selection collapses as soon as the pointer leaves the text of a line (see
 * textPointAt) and keeps re-applying itself every frame, so a single-click drag is
 * handled here instead: the anchor is set on mouse down, and the focus follows the
 * pointer each frame, with the pane scrolling when the pointer leaves it. Double
 * and triple clicks, shift-clicks, links and controls stay with the browser.
 * Returns the cleanup function.
 */
export function attachDocxDragSelection(
  root: HTMLElement,
  scroller: () => HTMLElement | null,
  resolve: CaretFromPoint = caretFromPoint
): () => void {
  let pointer: { x: number; y: number } | null = null
  let frame = 0
  let focus: CaretPoint | null = null

  const pointInPane = (x: number, y: number): { x: number; y: number } => {
    const box = scroller()?.getBoundingClientRect()
    return box ? { x: clamp(x, box.left + 1, box.right - 1), y: clamp(y, box.top + 1, box.bottom - 1) } : { x, y }
  }

  const follow = (): void => {
    const selection = document.getSelection()
    if (!pointer || !selection || selection.rangeCount === 0) return
    const pane = scroller()
    const box = pane?.getBoundingClientRect()
    if (pane && box) {
      const overshoot = pointer.y < box.top ? pointer.y - box.top : pointer.y > box.bottom ? pointer.y - box.bottom : 0
      if (overshoot !== 0) {
        pane.scrollTop += Math.sign(overshoot) * Math.min(AUTOSCROLL_MAX, AUTOSCROLL_MIN + Math.abs(overshoot) / 3)
      }
    }
    const target = pointInPane(pointer.x, pointer.y)
    const next = textPointAt(root, target.x, target.y, resolve)
    if (!next || samePoint(next, focus)) return
    focus = next
    selection.extend(next.node, next.offset)
  }

  const tick = (): void => {
    follow()
    frame = window.requestAnimationFrame(tick)
  }

  const onMove = (event: MouseEvent): void => {
    if (event.buttons !== 1) {
      stop()
      return
    }
    pointer = { x: event.clientX, y: event.clientY }
  }

  const onUp = (event: MouseEvent): void => {
    pointer = { x: event.clientX, y: event.clientY }
    stop()
  }

  function stop(): void {
    if (!pointer) return
    follow()
    pointer = null
    focus = null
    window.cancelAnimationFrame(frame)
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('blur', stop)
  }

  const start = (event: MouseEvent): void => {
    if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if ((event.target as Element | null)?.closest?.(INTERACTIVE)) return
    const selection = document.getSelection()
    const anchor = textPointAt(root, event.clientX, event.clientY, resolve)
    if (!selection || !anchor) return
    stop()
    // Taking over the drag keeps the browser from starting its own.
    event.preventDefault()
    selection.collapse(anchor.node, anchor.offset)
    pointer = { x: event.clientX, y: event.clientY }
    focus = anchor
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', stop)
    frame = window.requestAnimationFrame(tick)
  }

  root.addEventListener('mousedown', start)
  return () => {
    root.removeEventListener('mousedown', start)
    stop()
  }
}
