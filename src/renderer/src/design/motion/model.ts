import type { CanvasDocument, CanvasShape } from '../canvas/canvas-types'
import type {
  CanvasMotionDocument,
  CanvasMotionEasing,
  CanvasMotionKeyframe,
  CanvasMotionProperty,
  CanvasMotionTimeline,
  CanvasMotionTrack
} from './canvas-motion-types'
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
} from './canvas-motion-types'

type MotionCanvasDocument = Pick<CanvasDocument, 'rootId' | 'objects'>

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const clampAbsolute = (value: number, maximum: number): number =>
  clamp(value, -maximum, maximum)

function idPart(value: string): string {
  return encodeURIComponent(value)
}

function canonicalTime(value: number): string {
  const rounded = Math.round(finiteOr(value, 0) * 1_000) / 1_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function motionTimelineId(frameId: string): string {
  return `motion_timeline:${idPart(frameId)}`
}

export function motionTrackId(
  frameId: string,
  targetShapeId: string,
  property: CanvasMotionProperty
): string {
  return `motion_track:${idPart(frameId)}:${idPart(targetShapeId)}:${property}`
}

export function motionKeyframeId(trackId: string, timeMs: number): string {
  return `motion_keyframe:${idPart(trackId)}:${canonicalTime(timeMs)}`
}

export function createEmptyMotionDocument(): CanvasMotionDocument {
  return { version: CANVAS_MOTION_VERSION, timelines: {} }
}

export function normalizeMotionEasing(easing: CanvasMotionEasing): CanvasMotionEasing {
  switch (easing.type) {
    case 'linear':
    case 'ease-in':
    case 'ease-out':
    case 'ease-in-out':
    case 'hold':
      return { type: easing.type }
    case 'cubic-bezier':
      return {
        type: 'cubic-bezier',
        x1: clamp(finiteOr(easing.x1, 0.25), 0, 1),
        y1: clampAbsolute(
          finiteOr(easing.y1, 0.1),
          MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS
        ),
        x2: clamp(finiteOr(easing.x2, 0.25), 0, 1),
        y2: clampAbsolute(
          finiteOr(easing.y2, 1),
          MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS
        )
      }
    case 'spring':
      return {
        type: 'spring',
        mass: clamp(
          finiteOr(easing.mass, 1),
          MIN_CANVAS_MOTION_SPRING_MASS,
          MAX_CANVAS_MOTION_SPRING_MASS
        ),
        stiffness: clamp(
          finiteOr(easing.stiffness, 100),
          MIN_CANVAS_MOTION_SPRING_STIFFNESS,
          MAX_CANVAS_MOTION_SPRING_STIFFNESS
        ),
        damping: clamp(
          finiteOr(easing.damping, 10),
          0,
          MAX_CANVAS_MOTION_SPRING_DAMPING
        ),
        ...(easing.initialVelocity === undefined
          ? {}
          : {
              initialVelocity: clampAbsolute(
                finiteOr(easing.initialVelocity, 0),
                MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS
              )
            })
      }
  }
}

function normalizeKeyframes(
  track: CanvasMotionTrack,
  maxTimeMs: number,
  remainingKeyframes: number
): CanvasMotionKeyframe[] {
  const byTime = new Map<number, CanvasMotionKeyframe>()
  const usedIds = new Set<string>()
  for (let index = track.keyframes.length - 1; index >= 0; index -= 1) {
    if (byTime.size >= MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK || byTime.size >= remainingKeyframes) break
    const keyframe = track.keyframes[index]
    if (!keyframe || !Number.isFinite(keyframe.timeMs) || !Number.isFinite(keyframe.value)) continue
    const timeMs = clamp(keyframe.timeMs, 0, maxTimeMs)
    const id = keyframe.id.trim() || motionKeyframeId(track.id, timeMs)
    if (usedIds.has(id) || byTime.has(timeMs)) continue
    usedIds.add(id)
    byTime.set(timeMs, {
      id,
      timeMs,
      value: clampAbsolute(keyframe.value, MAX_CANVAS_MOTION_ABSOLUTE_VALUE),
      easing: normalizeMotionEasing(keyframe.easing)
    })
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
}

export function normalizeMotionTimeline(
  timeline: CanvasMotionTimeline,
  budgets: { remainingTracks?: number; remainingKeyframes?: number } = {}
): CanvasMotionTimeline | null {
  const frameId = timeline.frameId.trim()
  if (!frameId) return null
  const durationMs = clamp(
    finiteOr(timeline.durationMs, 1_000),
    1,
    MAX_CANVAS_MOTION_DURATION_MS
  )
  const timelineId = timeline.id.trim() || motionTimelineId(frameId)
  const remainingTracks = Math.max(0, budgets.remainingTracks ?? MAX_CANVAS_MOTION_TRACKS)
  let remainingKeyframes = Math.max(0, budgets.remainingKeyframes ?? MAX_CANVAS_MOTION_KEYFRAMES)
  const tracks: CanvasMotionTrack[] = []
  const usedTrackIds = new Set<string>()
  const usedTrackKeys = new Set<string>()

  for (let index = timeline.tracks.length - 1; index >= 0; index -= 1) {
    if (tracks.length >= remainingTracks || remainingKeyframes <= 0) break
    const track = timeline.tracks[index]
    if (
      !track ||
      !track.targetShapeId.trim() ||
      !Number.isFinite(track.baseValue) ||
      !CANVAS_MOTION_PROPERTIES.includes(track.property) ||
      !CANVAS_MOTION_OPERATIONS.includes(track.operation)
    ) continue
    const targetShapeId = track.targetShapeId.trim()
    const trackKey = `${targetShapeId}\0${track.property}`
    const id = track.id.trim() || motionTrackId(frameId, targetShapeId, track.property)
    if (usedTrackIds.has(id) || usedTrackKeys.has(trackKey)) continue

    const delayMs = track.delayMs === undefined
      ? undefined
      : clamp(finiteOr(track.delayMs, 0), 0, Math.max(0, durationMs - 1))
    const maximumSpan = Math.max(0, durationMs - (delayMs ?? 0))
    const duration = track.durationMs === undefined
      ? undefined
      : clamp(finiteOr(track.durationMs, maximumSpan), 1, Math.max(1, maximumSpan))
    const maxKeyframeTime = duration ?? maximumSpan
    const keyframes = normalizeKeyframes(track, maxKeyframeTime, remainingKeyframes)
    if (keyframes.length === 0) continue

    usedTrackIds.add(id)
    usedTrackKeys.add(trackKey)
    remainingKeyframes -= keyframes.length
    tracks.push({
      id,
      targetShapeId,
      property: track.property,
      operation: track.operation,
      baseValue: clampAbsolute(track.baseValue, MAX_CANVAS_MOTION_ABSOLUTE_VALUE),
      ...(delayMs === undefined ? {} : { delayMs }),
      ...(duration === undefined ? {} : { durationMs: duration }),
      keyframes
    })
  }

  tracks.reverse()
  return {
    id: timelineId,
    frameId,
    durationMs,
    playback: CANVAS_MOTION_PLAYBACK_MODES.includes(timeline.playback)
      ? timeline.playback
      : 'once',
    tracks
  }
}

export function normalizeMotionDocument(
  motion: CanvasMotionDocument | undefined
): CanvasMotionDocument {
  if (!motion || motion.version !== CANVAS_MOTION_VERSION) return createEmptyMotionDocument()
  const timelines: Record<string, CanvasMotionTimeline> = {}
  const usedFrames = new Set<string>()
  const usedTimelineIds = new Set<string>()
  const usedTrackIds = new Set<string>()
  const usedKeyframeIds = new Set<string>()
  let totalTracks = 0
  let totalKeyframes = 0

  const candidates = Object.values(motion.timelines)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (Object.keys(timelines).length >= MAX_CANVAS_MOTION_TIMELINES) break
    const candidate = candidates[index]
    if (!candidate) continue
    const normalized = normalizeMotionTimeline(candidate, {
      remainingTracks: MAX_CANVAS_MOTION_TRACKS - totalTracks,
      remainingKeyframes: MAX_CANVAS_MOTION_KEYFRAMES - totalKeyframes
    })
    if (!normalized || usedFrames.has(normalized.frameId) || usedTimelineIds.has(normalized.id)) continue
    const tracks = normalized.tracks.flatMap((track) => {
      if (usedTrackIds.has(track.id)) return []
      const keyframes = track.keyframes.filter((keyframe) => {
        if (usedKeyframeIds.has(keyframe.id)) return false
        usedKeyframeIds.add(keyframe.id)
        return true
      })
      if (keyframes.length === 0) return []
      usedTrackIds.add(track.id)
      return [{ ...track, keyframes }]
    })
    const uniqueNormalized = tracks.length === normalized.tracks.length
      ? normalized
      : { ...normalized, tracks }
    usedFrames.add(normalized.frameId)
    usedTimelineIds.add(normalized.id)
    timelines[normalized.frameId] = uniqueNormalized
    totalTracks += uniqueNormalized.tracks.length
    totalKeyframes += uniqueNormalized.tracks.reduce((sum, track) => sum + track.keyframes.length, 0)
  }

  return {
    version: CANVAS_MOTION_VERSION,
    timelines: Object.fromEntries(Object.entries(timelines).reverse())
  }
}

export function resolveOwningMotionFrameId(
  document: MotionCanvasDocument,
  shapeId: string | null | undefined
): string {
  if (!shapeId) return document.rootId
  let currentId: string | null = shapeId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const shape: CanvasShape | undefined = document.objects[currentId]
    if (!shape) return document.rootId
    if (currentId === document.rootId || shape.type === 'frame') return currentId
    currentId = shape.parentId
  }
  return document.rootId
}

export function findMotionTimelineForFrame(
  motion: CanvasMotionDocument | undefined,
  frameId: string
): CanvasMotionTimeline | undefined {
  if (!motion) return undefined
  return Object.values(motion.timelines).find((timeline) => timeline.frameId === frameId)
}

export function findMotionTrack(
  timeline: CanvasMotionTimeline | undefined,
  targetShapeId: string,
  property: CanvasMotionProperty
): CanvasMotionTrack | undefined {
  return timeline?.tracks.find(
    (track) => track.targetShapeId === targetShapeId && track.property === property
  )
}

export function pruneMotionDocument(
  motion: CanvasMotionDocument | undefined,
  document: MotionCanvasDocument
): CanvasMotionDocument {
  const normalized = normalizeMotionDocument(motion)
  const timelines: Record<string, CanvasMotionTimeline> = {}
  for (const timeline of Object.values(normalized.timelines)) {
    const frame = document.objects[timeline.frameId]
    if (!frame || (timeline.frameId !== document.rootId && frame.type !== 'frame')) continue
    const tracks = timeline.tracks.filter((track) => {
      if (!document.objects[track.targetShapeId]) return false
      return resolveOwningMotionFrameId(document, track.targetShapeId) === timeline.frameId
    })
    timelines[timeline.frameId] = tracks.length === timeline.tracks.length
      ? timeline
      : { ...timeline, tracks }
  }
  return { version: CANVAS_MOTION_VERSION, timelines }
}

export function pruneMotionDocumentForShapeIds(
  motion: CanvasMotionDocument | undefined,
  shapeIds: Iterable<string>
): CanvasMotionDocument {
  const removed = new Set(shapeIds)
  const normalized = normalizeMotionDocument(motion)
  const timelines: Record<string, CanvasMotionTimeline> = {}
  for (const timeline of Object.values(normalized.timelines)) {
    if (removed.has(timeline.frameId)) continue
    const tracks = timeline.tracks.filter((track) => !removed.has(track.targetShapeId))
    timelines[timeline.frameId] = { ...timeline, tracks }
  }
  return { version: CANVAS_MOTION_VERSION, timelines }
}

export const resolveOwningFrameId = resolveOwningMotionFrameId
