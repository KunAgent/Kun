import type { CanvasDocument } from './canvas-types'
import type {
  CanvasMotionDocument,
  CanvasMotionEasing,
  CanvasMotionKeyframe,
  CanvasMotionTimeline,
  CanvasMotionTrack
} from '../motion/canvas-motion-types'
import {
  CANVAS_MOTION_OPERATIONS,
  CANVAS_MOTION_PLAYBACK_MODES,
  CANVAS_MOTION_PROPERTIES,
  CANVAS_MOTION_VERSION,
  MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
  MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
  MAX_CANVAS_MOTION_DURATION_MS,
  MAX_CANVAS_MOTION_KEYFRAMES,
  MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK,
  MAX_CANVAS_MOTION_SPRING_DAMPING,
  MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS,
  MAX_CANVAS_MOTION_SPRING_MASS,
  MAX_CANVAS_MOTION_SPRING_STIFFNESS,
  MAX_CANVAS_MOTION_TIMELINES,
  MAX_CANVAS_MOTION_TRACKS,
  MIN_CANVAS_MOTION_SPRING_MASS,
  MIN_CANVAS_MOTION_SPRING_STIFFNESS
} from '../motion/canvas-motion-types'
import { resolveOwningMotionFrameId } from '../motion/model'

function isObj(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
}

function isBoundedMotionValue(value: unknown): value is number {
  return isFiniteNumberInRange(
    value,
    -MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
    MAX_CANVAS_MOTION_ABSOLUTE_VALUE
  )
}

function parseMotionEasing(raw: unknown): CanvasMotionEasing | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null
  if (['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(raw.type)) {
    return { type: raw.type as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }
  }
  if (raw.type === 'cubic-bezier') {
    if (
      !isFiniteNumberInRange(raw.x1, 0, 1) ||
      !isFiniteNumberInRange(
        raw.y1,
        -MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
        MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS
      ) ||
      !isFiniteNumberInRange(raw.x2, 0, 1) ||
      !isFiniteNumberInRange(
        raw.y2,
        -MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
        MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS
      )
    ) return null
    return { type: 'cubic-bezier', x1: raw.x1, y1: raw.y1, x2: raw.x2, y2: raw.y2 }
  }
  if (raw.type !== 'spring') return null
  if (
    !isFiniteNumberInRange(
      raw.mass,
      MIN_CANVAS_MOTION_SPRING_MASS,
      MAX_CANVAS_MOTION_SPRING_MASS
    ) ||
    !isFiniteNumberInRange(
      raw.stiffness,
      MIN_CANVAS_MOTION_SPRING_STIFFNESS,
      MAX_CANVAS_MOTION_SPRING_STIFFNESS
    ) ||
    !isFiniteNumberInRange(raw.damping, 0, MAX_CANVAS_MOTION_SPRING_DAMPING) ||
    (raw.initialVelocity !== undefined &&
      !isFiniteNumberInRange(
        raw.initialVelocity,
        -MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS,
        MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS
      ))
  ) return null
  return {
    type: 'spring',
    mass: raw.mass,
    stiffness: raw.stiffness,
    damping: raw.damping,
    ...(raw.initialVelocity === undefined ? {} : { initialVelocity: raw.initialVelocity })
  }
}

function parseMotionKeyframes(
  raw: unknown,
  maxTimeMs: number,
  seenKeyframeIds: Set<string>,
  counters: { keyframes: number }
): CanvasMotionKeyframe[] | null {
  if (
    !Array.isArray(raw) || raw.length === 0 ||
    raw.length > MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK ||
    counters.keyframes + raw.length > MAX_CANVAS_MOTION_KEYFRAMES
  ) return null
  const keyframes: CanvasMotionKeyframe[] = []
  let previousTime = -1
  for (const value of raw) {
    if (
      !isObj(value) ||
      typeof value.id !== 'string' || !value.id.trim() || value.id !== value.id.trim() ||
      typeof value.timeMs !== 'number' || !Number.isFinite(value.timeMs) ||
      value.timeMs < 0 || value.timeMs > maxTimeMs || value.timeMs <= previousTime ||
      !isBoundedMotionValue(value.value)
    ) return null
    const id = value.id.trim()
    if (seenKeyframeIds.has(id)) return null
    const easing = parseMotionEasing(value.easing)
    if (!easing) return null
    seenKeyframeIds.add(id)
    previousTime = value.timeMs
    keyframes.push({ id, timeMs: value.timeMs, value: value.value, easing })
  }
  counters.keyframes += keyframes.length
  return keyframes
}

function parseMotionTrack(
  raw: unknown,
  timeline: Pick<CanvasMotionTimeline, 'frameId' | 'durationMs'>,
  document: Pick<CanvasDocument, 'rootId' | 'objects'>,
  seenTrackIds: Set<string>,
  seenKeyframeIds: Set<string>,
  seenTrackKeys: Set<string>,
  counters: { tracks: number; keyframes: number }
): CanvasMotionTrack | null {
  if (
    !isObj(raw) ||
    typeof raw.id !== 'string' || !raw.id.trim() || raw.id !== raw.id.trim() ||
    typeof raw.targetShapeId !== 'string' || !raw.targetShapeId.trim() ||
    raw.targetShapeId !== raw.targetShapeId.trim() ||
    !CANVAS_MOTION_PROPERTIES.includes(raw.property as never) ||
    !CANVAS_MOTION_OPERATIONS.includes(raw.operation as never) ||
    !isBoundedMotionValue(raw.baseValue) ||
    counters.tracks >= MAX_CANVAS_MOTION_TRACKS
  ) return null
  const id = raw.id.trim()
  const targetShapeId = raw.targetShapeId.trim()
  if (
    seenTrackIds.has(id) || !document.objects[targetShapeId] ||
    resolveOwningMotionFrameId(document, targetShapeId) !== timeline.frameId
  ) return null
  const trackKey = `${targetShapeId}\0${String(raw.property)}`
  if (seenTrackKeys.has(trackKey)) return null

  let delayMs: number | undefined
  if (raw.delayMs !== undefined) {
    if (
      typeof raw.delayMs !== 'number' || !Number.isFinite(raw.delayMs) ||
      raw.delayMs < 0 || raw.delayMs >= timeline.durationMs
    ) return null
    delayMs = raw.delayMs
  }
  const maximumSpan = timeline.durationMs - (delayMs ?? 0)
  let durationMs: number | undefined
  if (raw.durationMs !== undefined) {
    if (
      typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) ||
      raw.durationMs <= 0 || raw.durationMs > maximumSpan
    ) return null
    durationMs = raw.durationMs
  }
  const keyframes = parseMotionKeyframes(
    raw.keyframes,
    durationMs ?? maximumSpan,
    seenKeyframeIds,
    counters
  )
  if (!keyframes) return null
  seenTrackIds.add(id)
  seenTrackKeys.add(trackKey)
  counters.tracks += 1
  return {
    id,
    targetShapeId,
    property: raw.property as CanvasMotionTrack['property'],
    operation: raw.operation as CanvasMotionTrack['operation'],
    baseValue: raw.baseValue,
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(durationMs === undefined ? {} : { durationMs }),
    keyframes
  }
}

/** Strict all-or-nothing parser for the optional bounded motion payload. */
export function parseCanvasMotionDocument(
  raw: unknown,
  document: Pick<CanvasDocument, 'rootId' | 'objects'>
): CanvasMotionDocument | null {
  if (!isObj(raw) || raw.version !== CANVAS_MOTION_VERSION || !isObj(raw.timelines)) return null
  const entries = Object.entries(raw.timelines)
  if (entries.length > MAX_CANVAS_MOTION_TIMELINES) return null

  const timelines: Record<string, CanvasMotionTimeline> = {}
  const seenTimelineIds = new Set<string>()
  const seenTrackIds = new Set<string>()
  const seenKeyframeIds = new Set<string>()
  const counters = { tracks: 0, keyframes: 0 }
  for (const [frameKey, value] of entries) {
    if (
      !isObj(value) ||
      typeof value.id !== 'string' || !value.id.trim() || value.id !== value.id.trim() ||
      typeof value.frameId !== 'string' || !value.frameId.trim() || value.frameId !== value.frameId.trim() ||
      frameKey !== value.frameId ||
      typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) ||
      value.durationMs <= 0 || value.durationMs > MAX_CANVAS_MOTION_DURATION_MS ||
      !CANVAS_MOTION_PLAYBACK_MODES.includes(value.playback as never) ||
      !Array.isArray(value.tracks) || counters.tracks + value.tracks.length > MAX_CANVAS_MOTION_TRACKS
    ) return null
    const id = value.id.trim()
    const frameId = value.frameId.trim()
    const frame = document.objects[frameId]
    if (seenTimelineIds.has(id) || !frame || (frameId !== document.rootId && frame.type !== 'frame')) {
      return null
    }

    const seenTrackKeys = new Set<string>()
    const timelineBase = { frameId, durationMs: value.durationMs }
    const tracks: CanvasMotionTrack[] = []
    for (const rawTrack of value.tracks) {
      const track = parseMotionTrack(
        rawTrack,
        timelineBase,
        document,
        seenTrackIds,
        seenKeyframeIds,
        seenTrackKeys,
        counters
      )
      if (!track) return null
      tracks.push(track)
    }
    seenTimelineIds.add(id)
    timelines[frameId] = {
      id,
      frameId,
      durationMs: value.durationMs,
      playback: value.playback as CanvasMotionTimeline['playback'],
      tracks
    }
  }
  return { version: CANVAS_MOTION_VERSION, timelines }
}
