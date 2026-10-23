import {
  createDefaultShape,
  isArtifactFrame,
  type CanvasDocument,
  type CanvasShape,
  type CanvasSticky,
  type CanvasStickyColor,
  type CanvasStickyStatus
} from './canvas-types'
import { collectDescendants } from './canvas-shape-tree'

export const STICKY_WIDTH = 220
export const STICKY_HEIGHT = 150

/** Card and ink colors per sticky color (ink passes 4.5:1 on its card). */
export const STICKY_PALETTE: Record<CanvasStickyColor, { fill: string; ink: string; muted: string }> = {
  yellow: { fill: '#FBEFA6', ink: '#2A2614', muted: '#5C5420' },
  pink: { fill: '#F9D4DE', ink: '#3A1622', muted: '#7A3249' },
  green: { fill: '#D3EBCF', ink: '#14301A', muted: '#2F5E38' },
  blue: { fill: '#D1E2F8', ink: '#10263F', muted: '#2D5280' },
  violet: { fill: '#E1D9F9', ink: '#241A4D', muted: '#52419A' }
}

const STICKY_COLORS = Object.keys(STICKY_PALETTE) as CanvasStickyColor[]
const STICKY_STATUSES: CanvasStickyStatus[] = ['draft', 'sent', 'done']

const KUN_MENTION = /@kun\b/i

export function stickyMentionsKun(text: string | undefined): boolean {
  return KUN_MENTION.test(text ?? '')
}

/** A note is a request for Kun when it mentions @Kun or is attached to an element. */
export function stickyAddressesKun(shape: Pick<CanvasShape, 'textContent' | 'sticky'>): boolean {
  return stickyMentionsKun(shape.textContent) || Boolean(shape.sticky?.anchorId)
}

export function createStickyShape(x: number, y: number, color: CanvasStickyColor = 'yellow'): CanvasShape {
  const shape = createDefaultShape('text', x, y)
  const palette = STICKY_PALETTE[color]
  shape.name = 'Sticky'
  shape.width = STICKY_WIDTH
  shape.height = STICKY_HEIGHT
  shape.textContent = ''
  shape.fontSize = 14
  shape.lineHeight = 1.5
  shape.fontColor = palette.ink
  shape.fills = [{ type: 'solid', color: palette.fill, opacity: 1 }]
  shape.sticky = { color, status: 'draft' }
  return shape
}

export function parseCanvasSticky(raw: unknown): CanvasSticky | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const color = STICKY_COLORS.find((candidate) => candidate === value.color)
  if (!color) return undefined
  // A request in flight cannot survive a reload, so a stored `sent` note reopens as a draft.
  const stored = STICKY_STATUSES.find((candidate) => candidate === value.status) ?? 'draft'
  const status: CanvasStickyStatus = stored === 'sent' ? 'draft' : stored
  return {
    color,
    status,
    ...(typeof value.targetId === 'string' && value.targetId ? { targetId: value.targetId } : {}),
    ...(typeof value.anchorId === 'string' && value.anchorId ? { anchorId: value.anchorId } : {}),
    ...(typeof value.resultNote === 'string' && value.resultNote
      ? { resultNote: value.resultNote.slice(0, 240) }
      : {})
  }
}

function distanceToRect(shape: CanvasShape, point: { x: number; y: number }): number {
  const dx = Math.max(shape.x - point.x, 0, point.x - (shape.x + shape.width))
  const dy = Math.max(shape.y - point.y, 0, point.y - (shape.y + shape.height))
  return Math.hypot(dx, dy)
}

/**
 * The board a sticky points at: the artifact frame (screen) closest to the
 * note, measured from the note's center. Frames the note sits on top of win.
 */
export function resolveStickyTarget(doc: CanvasDocument, stickyId: string): CanvasShape | null {
  const sticky = doc.objects[stickyId]
  if (!sticky) return null
  const anchor = sticky.sticky?.anchorId ? doc.objects[sticky.sticky.anchorId] : undefined
  if (anchor && isArtifactFrame(anchor)) return anchor
  const basis = anchor ?? sticky
  const center = { x: basis.x + basis.width / 2, y: basis.y + basis.height / 2 }
  let best: { shape: CanvasShape; distance: number } | null = null
  for (const candidate of Object.values(doc.objects)) {
    if (candidate.id === stickyId || !candidate.visible || !isArtifactFrame(candidate)) continue
    const distance = distanceToRect(candidate, center)
    if (!best || distance < best.distance) best = { shape: candidate, distance }
  }
  return best?.shape ?? null
}

export function buildStickyKunPrompt(options: {
  text: string
  targetName?: string | null
  anchorName?: string | null
}): string {
  const instruction = options.text.replace(KUN_MENTION, '').replace(/\s+/g, ' ').trim()
  const target = options.targetName
    ? `The note sits next to the board "${options.targetName}"; apply it to that board unless the note names another.`
    : 'No board is next to the note; apply it to the current design as a whole.'
  const anchor = options.anchorName ? `The note is attached to the element "${options.anchorName}".` : null
  return [
    'A sticky note on the canvas asks for a change.',
    ...(anchor ? [anchor] : []),
    target,
    `Note: ${instruction || options.text.trim()}`
  ].join('\n')
}

export function stickyShapeIds(doc: CanvasDocument): string[] {
  return Object.values(doc.objects)
    .filter((shape) => Boolean(shape.sticky))
    .map((shape) => shape.id)
}

/** Ids of every shape under `rootId`, used when a section moves its stickies along. */
export function stickyDescendants(doc: CanvasDocument, rootId: string): string[] {
  return collectDescendants(doc.objects, rootId).filter((id) => Boolean(doc.objects[id]?.sticky))
}

export const STICKY_REQUEST_EVENT = 'kun:design-sticky-request'

/** Asks the workbench (which owns the agent runtime) to send a note to Kun. */
export function requestStickyKun(stickyId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ stickyId: string }>(STICKY_REQUEST_EVENT, { detail: { stickyId } }))
}
