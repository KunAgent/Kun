import type { MessageQuoteRole } from '../../lib/message-quote'

export type RectLike = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type TimelineSelectionSnapshot = {
  text: string
  role: MessageQuoteRole
  sourceBlockId: string | null
  /** Client rects of the selected line boxes, in document order (visual px). */
  lineRects: RectLike[]
}

/** Message prose the timeline renders as selectable text. */
const SELECTABLE_CONTENT = '.ds-markdown, .ds-user-message-bubble, pre'
/** Editable or interactive regions where a quote toolbar would get in the way. */
const EXCLUDED_CONTENT = [
  'textarea',
  'input',
  'select',
  '[contenteditable="true"]',
  '[role="dialog"]',
  '[data-message-selection-toolbar]'
].join(', ')

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function toRectLike(rect: DOMRect): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

/**
 * Read the current document selection when it is a non-empty run of message
 * text inside `root`. Anything else (collapsed, outside the timeline, inside
 * an editor or dialog, whitespace only) returns null.
 */
export function readTimelineSelection(
  root: HTMLElement,
  selection: Selection | null
): TimelineSelectionSnapshot | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  if (!start || !end) return null
  if (start.closest(EXCLUDED_CONTENT) || end.closest(EXCLUDED_CONTENT)) return null
  if (!start.closest(SELECTABLE_CONTENT) && !end.closest(SELECTABLE_CONTENT)) return null
  const text = selection.toString()
  if (!text.trim()) return null
  const block = start.closest('[data-timeline-block-id]') ?? end.closest('[data-timeline-block-id]')
  const role: MessageQuoteRole = start.closest('.ds-user-message') ? 'user' : 'assistant'
  const lineRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(toRectLike)
  if (lineRects.length === 0) {
    const bounding = range.getBoundingClientRect()
    if (bounding.width <= 0 && bounding.height <= 0) return null
    lineRects.push(toRectLike(bounding))
  }
  return {
    text,
    role,
    sourceBlockId: block?.getAttribute('data-timeline-block-id') ?? null,
    lineRects
  }
}

export type ToolbarPlacement = {
  left: number
  top: number
  placement: 'above' | 'below'
}

/**
 * Place the toolbar above the first visible selected line, centered on it,
 * or below the last visible line when there is no room above. All values are
 * visual (zoomed) viewport px. Returns null when the selection is scrolled
 * out of `bounds`.
 */
export function selectionToolbarPlacement(input: {
  lineRects: readonly RectLike[]
  bounds: RectLike
  toolbar: { width: number; height: number }
  gap?: number
  edge?: number
}): ToolbarPlacement | null {
  const gap = input.gap ?? 8
  const edge = input.edge ?? 8
  const { bounds, toolbar } = input
  const visible = input.lineRects.filter((rect) =>
    rect.bottom > bounds.top + 2 && rect.top < bounds.bottom - 2
  )
  if (visible.length === 0) return null
  const first = visible[0]!
  const last = visible[visible.length - 1]!
  const aboveTop = first.top - gap - toolbar.height
  const belowTop = last.bottom + gap
  let placement: ToolbarPlacement['placement']
  let top: number
  let anchor: RectLike
  if (aboveTop >= bounds.top + edge) {
    placement = 'above'
    top = aboveTop
    anchor = first
  } else if (belowTop + toolbar.height <= bounds.bottom - edge) {
    placement = 'below'
    top = belowTop
    anchor = last
  } else {
    placement = 'below'
    top = bounds.top + edge
    anchor = first
  }
  const center = anchor.left + anchor.width / 2
  const minLeft = bounds.left + edge
  const maxLeft = Math.max(minLeft, bounds.right - edge - toolbar.width)
  const left = Math.min(maxLeft, Math.max(minLeft, center - toolbar.width / 2))
  return { left, top, placement }
}
