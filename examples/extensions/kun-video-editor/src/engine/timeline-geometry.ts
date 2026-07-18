import { engineError } from './errors.js'

export const TIMELINE_GEOMETRY_LIMITS = Object.freeze({
  minPixelsPerFrame: 0.01,
  maxPixelsPerFrame: 64,
  maxViewportPixels: 16_384,
  maxFrame: Number.MAX_SAFE_INTEGER - 1,
  handlePixels: 8,
  playheadPixels: 6,
  maxVisibleItems: 2_000
})

export type TimelineViewport = {
  scrollFrame: number
  pixelsPerFrame: number
  widthPixels: number
  durationFrames: number
}

export type TimelineLaneGeometry = {
  trackId: string
  top: number
  height: number
  order: number
}

export type TimelineSpatialItem = {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  zIndex?: number
}

export type TimelineItemRect = TimelineSpatialItem & {
  left: number
  top: number
  width: number
  height: number
}

export type TimelineHit =
  | { kind: 'empty'; frame: number; trackId?: string }
  | { kind: 'playhead'; frame: number }
  | { kind: 'range'; frame: number; edge?: 'start' | 'end' }
  | { kind: 'item'; frame: number; itemId: string; trackId: string; region: 'body' | 'trim-start' | 'trim-end' }

export type TimelineRange = { startFrame: number; endFrame: number }

export function createTimelineViewport(input: TimelineViewport): TimelineViewport {
  const durationFrames = nonNegativeFrame(input.durationFrames, 'durationFrames')
  const widthPixels = finiteBetween(
    input.widthPixels,
    1,
    TIMELINE_GEOMETRY_LIMITS.maxViewportPixels,
    'widthPixels'
  )
  const pixelsPerFrame = finiteBetween(
    input.pixelsPerFrame,
    TIMELINE_GEOMETRY_LIMITS.minPixelsPerFrame,
    TIMELINE_GEOMETRY_LIMITS.maxPixelsPerFrame,
    'pixelsPerFrame'
  )
  const visibleFrames = widthPixels / pixelsPerFrame
  return {
    durationFrames,
    widthPixels,
    pixelsPerFrame,
    scrollFrame: Math.min(
      nonNegativeFinite(input.scrollFrame, 'scrollFrame'),
      Math.max(0, durationFrames - visibleFrames)
    )
  }
}

export function frameToTimelineX(viewport: TimelineViewport, frame: number): number {
  const normalized = createTimelineViewport(viewport)
  return (nonNegativeFinite(frame, 'frame') - normalized.scrollFrame) * normalized.pixelsPerFrame
}

export function timelineXToFrame(
  viewport: TimelineViewport,
  x: number,
  rounding: 'none' | 'floor' | 'round' | 'ceil' = 'none'
): number {
  const normalized = createTimelineViewport(viewport)
  const raw = Math.max(0, normalized.scrollFrame + finite(x, 'x') / normalized.pixelsPerFrame)
  if (rounding === 'floor') return Math.floor(raw)
  if (rounding === 'round') return Math.round(raw)
  if (rounding === 'ceil') return Math.ceil(raw)
  return raw
}

export function visibleTimelineRange(viewport: TimelineViewport, overscanPixels = 0): TimelineRange {
  const normalized = createTimelineViewport(viewport)
  const overscanFrames = Math.max(0, finite(overscanPixels, 'overscanPixels')) / normalized.pixelsPerFrame
  return {
    startFrame: Math.max(0, Math.floor(normalized.scrollFrame - overscanFrames)),
    endFrame: Math.min(
      normalized.durationFrames,
      Math.ceil(normalized.scrollFrame + normalized.widthPixels / normalized.pixelsPerFrame + overscanFrames)
    )
  }
}

export function zoomTimelineAt(
  viewport: TimelineViewport,
  anchorX: number,
  nextPixelsPerFrame: number
): TimelineViewport {
  const normalized = createTimelineViewport(viewport)
  const x = finiteBetween(anchorX, 0, normalized.widthPixels, 'anchorX')
  const anchorFrame = timelineXToFrame(normalized, x)
  const zoom = finiteBetween(
    nextPixelsPerFrame,
    TIMELINE_GEOMETRY_LIMITS.minPixelsPerFrame,
    TIMELINE_GEOMETRY_LIMITS.maxPixelsPerFrame,
    'nextPixelsPerFrame'
  )
  return createTimelineViewport({
    ...normalized,
    pixelsPerFrame: zoom,
    scrollFrame: Math.max(0, anchorFrame - x / zoom)
  })
}

export function scrollTimelineBy(viewport: TimelineViewport, deltaPixels: number): TimelineViewport {
  const normalized = createTimelineViewport(viewport)
  return createTimelineViewport({
    ...normalized,
    scrollFrame: Math.max(0, normalized.scrollFrame + finite(deltaPixels, 'deltaPixels') / normalized.pixelsPerFrame)
  })
}

export function normalizeTimelineRange(anchorFrame: number, focusFrame: number): TimelineRange {
  const anchor = nonNegativeFrame(anchorFrame, 'anchorFrame')
  const focus = nonNegativeFrame(focusFrame, 'focusFrame')
  return anchor <= focus
    ? { startFrame: anchor, endFrame: focus }
    : { startFrame: focus, endFrame: anchor }
}

export function layoutTimelineItems(
  viewport: TimelineViewport,
  lanes: readonly TimelineLaneGeometry[],
  items: readonly TimelineSpatialItem[],
  overscanPixels = 80
): { items: TimelineItemRect[]; hiddenBefore: number; hiddenAfter: number; truncated: number } {
  const normalized = createTimelineViewport(viewport)
  const range = visibleTimelineRange(normalized, overscanPixels)
  const laneById = new Map(lanes.map((lane) => {
    validateLane(lane)
    return [lane.trackId, lane]
  }))
  let hiddenBefore = 0
  let hiddenAfter = 0
  const visible: TimelineItemRect[] = []
  for (const item of items) {
    validateSpatialItem(item)
    if (item.endFrame <= range.startFrame) {
      hiddenBefore += 1
      continue
    }
    if (item.startFrame >= range.endFrame) {
      hiddenAfter += 1
      continue
    }
    const lane = laneById.get(item.trackId)
    if (!lane) continue
    visible.push({
      ...item,
      left: frameToTimelineX(normalized, item.startFrame),
      top: lane.top,
      width: Math.max(1, (item.endFrame - item.startFrame) * normalized.pixelsPerFrame),
      height: lane.height
    })
  }
  visible.sort((left, right) =>
    left.top - right.top || (right.zIndex ?? 0) - (left.zIndex ?? 0) ||
    left.startFrame - right.startFrame || left.id.localeCompare(right.id)
  )
  const bounded = visible.slice(0, TIMELINE_GEOMETRY_LIMITS.maxVisibleItems)
  return {
    items: bounded,
    hiddenBefore,
    hiddenAfter,
    truncated: Math.max(0, visible.length - bounded.length)
  }
}

export function hitTestTimeline(input: {
  viewport: TimelineViewport
  lanes: readonly TimelineLaneGeometry[]
  itemRects: readonly TimelineItemRect[]
  x: number
  y: number
  playheadFrame?: number
  selectedRange?: TimelineRange
}): TimelineHit {
  const viewport = createTimelineViewport(input.viewport)
  const x = finite(input.x, 'x')
  const y = finite(input.y, 'y')
  const frame = Math.max(0, Math.round(timelineXToFrame(viewport, x)))
  if (input.playheadFrame !== undefined) {
    const playheadX = frameToTimelineX(viewport, nonNegativeFrame(input.playheadFrame, 'playheadFrame'))
    if (Math.abs(x - playheadX) <= TIMELINE_GEOMETRY_LIMITS.playheadPixels) {
      return { kind: 'playhead', frame: input.playheadFrame }
    }
  }
  if (input.selectedRange) {
    const range = normalizeTimelineRange(input.selectedRange.startFrame, input.selectedRange.endFrame)
    const startX = frameToTimelineX(viewport, range.startFrame)
    const endX = frameToTimelineX(viewport, range.endFrame)
    if (Math.abs(x - startX) <= TIMELINE_GEOMETRY_LIMITS.handlePixels) {
      return { kind: 'range', frame, edge: 'start' }
    }
    if (Math.abs(x - endX) <= TIMELINE_GEOMETRY_LIMITS.handlePixels) {
      return { kind: 'range', frame, edge: 'end' }
    }
    if (x > startX && x < endX) return { kind: 'range', frame }
  }
  const item = [...input.itemRects]
    .sort((left, right) => (right.zIndex ?? 0) - (left.zIndex ?? 0))
    .find((candidate) =>
      x >= candidate.left && x <= candidate.left + candidate.width &&
      y >= candidate.top && y <= candidate.top + candidate.height
    )
  if (item) {
    const localX = x - item.left
    const handle = Math.min(TIMELINE_GEOMETRY_LIMITS.handlePixels, item.width / 3)
    const region = localX <= handle
      ? 'trim-start'
      : item.width - localX <= handle
        ? 'trim-end'
        : 'body'
    return { kind: 'item', frame, itemId: item.id, trackId: item.trackId, region }
  }
  const lane = input.lanes.find((candidate) => y >= candidate.top && y <= candidate.top + candidate.height)
  return { kind: 'empty', frame, ...(lane ? { trackId: lane.trackId } : {}) }
}

function validateLane(lane: TimelineLaneGeometry): void {
  if (!lane.trackId || lane.trackId.length > 128) invalid('Timeline lane trackId is invalid')
  finiteBetween(lane.top, 0, TIMELINE_GEOMETRY_LIMITS.maxViewportPixels, 'lane.top')
  finiteBetween(lane.height, 1, TIMELINE_GEOMETRY_LIMITS.maxViewportPixels, 'lane.height')
  if (!Number.isSafeInteger(lane.order)) invalid('Timeline lane order must be an integer')
}

function validateSpatialItem(item: TimelineSpatialItem): void {
  if (!item.id || item.id.length > 128 || !item.trackId || item.trackId.length > 128) {
    invalid('Timeline spatial item identity is invalid')
  }
  nonNegativeFrame(item.startFrame, 'item.startFrame')
  nonNegativeFrame(item.endFrame, 'item.endFrame')
  if (item.endFrame <= item.startFrame) invalid('Timeline item must use a non-empty half-open range')
}

function nonNegativeFrame(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > TIMELINE_GEOMETRY_LIMITS.maxFrame) {
    invalid(`${label} must be a non-negative safe integer frame`)
  }
  return value
}

function nonNegativeFinite(value: number, label: string): number {
  const result = finite(value, label)
  if (result < 0) invalid(`${label} must be non-negative`)
  return result
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) invalid(`${label} must be finite`)
  return value
}

function finiteBetween(value: number, minimum: number, maximum: number, label: string): number {
  const result = finite(value, label)
  if (result < minimum || result > maximum) invalid(`${label} must be between ${minimum} and ${maximum}`)
  return result
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
