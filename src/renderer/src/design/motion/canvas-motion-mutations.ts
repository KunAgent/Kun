import type { CanvasDocument, CanvasShape } from '../canvas/canvas-types'
import {
  createEmptyMotionDocument,
  motionKeyframeId,
  motionTimelineId,
  motionTrackId,
  normalizeMotionDocument
} from './model'
import type {
  CanvasMotionDocument,
  CanvasMotionEasing,
  CanvasMotionKeyframe,
  CanvasMotionOperation,
  CanvasMotionPlaybackMode,
  CanvasMotionProperty,
  CanvasMotionTimeline,
  CanvasMotionTrack
} from './canvas-motion-types'

export const DEFAULT_MOTION_TIMELINE_DURATION_MS = 2_000
export const DEFAULT_MOTION_TRACK_DURATION_MS = 600

export type CanvasMotionPreset = 'fade' | 'move' | 'scale' | 'rotate'
export type CanvasMotionMoveDirection = 'left' | 'right' | 'up' | 'down'

export type TimelineConfiguration = {
  durationMs?: number
  playback?: CanvasMotionPlaybackMode
}

export type AddPropertyTracksInput = {
  document: CanvasDocument
  frameId: string
  targetShapeIds: readonly string[]
  properties: readonly CanvasMotionProperty[]
  /** Timeline-local delay before each new track starts. */
  delayMs?: number
  durationMs?: number
  easing?: CanvasMotionEasing
  operation?: CanvasMotionOperation
}

export type UpsertKeyframeInput = {
  frameId: string
  targetShapeId: string
  property: CanvasMotionProperty
  timeMs: number
  value: number
  easing?: CanvasMotionEasing
  keyframeId?: string
  trackId?: string
  operation?: CanvasMotionOperation
  baseValue?: number
  delayMs?: number
  durationMs?: number
}

export type MotionPresetOptions = {
  durationMs?: number
  staggerMs?: number
  easing?: CanvasMotionEasing
  direction?: CanvasMotionMoveDirection
  distance?: number
  scaleFrom?: number
  rotateFrom?: number
}

export type AutoKeyResult = {
  motion: CanvasMotionDocument
  shapePatch: Partial<CanvasShape>
  animatedProperties: CanvasMotionProperty[]
}

const LINEAR: CanvasMotionEasing = { type: 'linear' }
const EASE_OUT: CanvasMotionEasing = { type: 'ease-out' }

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Math.max(0, finiteOr(value, fallback))
}

function positive(value: number | undefined, fallback: number): number {
  return Math.max(1, finiteOr(value, fallback))
}

function emptyIfMissing(motion: CanvasMotionDocument | undefined): CanvasMotionDocument {
  return motion ?? createEmptyMotionDocument()
}

function createTimeline(
  frameId: string,
  durationMs = DEFAULT_MOTION_TIMELINE_DURATION_MS
): CanvasMotionTimeline {
  return {
    id: motionTimelineId(frameId),
    frameId,
    durationMs: positive(durationMs, DEFAULT_MOTION_TIMELINE_DURATION_MS),
    playback: 'once',
    tracks: []
  }
}

function shapeBaseValue(shape: CanvasShape, property: CanvasMotionProperty): number {
  switch (property) {
    case 'x':
    case 'y':
    case 'rotation':
    case 'opacity':
      return shape[property]
    case 'scaleX':
    case 'scaleY':
      return 1
  }
}

function defaultOperation(property: CanvasMotionProperty): CanvasMotionOperation {
  return property === 'scaleX' || property === 'scaleY' ? 'scale' : 'set'
}

function replaceTrack(
  timeline: CanvasMotionTimeline,
  track: CanvasMotionTrack
): CanvasMotionTimeline {
  const existingIndex = timeline.tracks.findIndex(
    (candidate) =>
      candidate.id === track.id ||
      (candidate.targetShapeId === track.targetShapeId && candidate.property === track.property)
  )
  const tracks = [...timeline.tracks]
  if (existingIndex >= 0) tracks[existingIndex] = track
  else tracks.push(track)
  return {
    ...timeline,
    durationMs: Math.max(timeline.durationMs, (track.delayMs ?? 0) + (track.durationMs ?? 0)),
    tracks
  }
}

export function replaceTimeline(
  motion: CanvasMotionDocument | undefined,
  timeline: CanvasMotionTimeline
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  return normalizeMotionDocument({
    ...current,
    timelines: { ...current.timelines, [timeline.frameId]: timeline }
  })
}

export function updateTimeline(
  motion: CanvasMotionDocument | undefined,
  frameId: string,
  updater: (timeline: CanvasMotionTimeline) => CanvasMotionTimeline | null
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  const nextTimeline = updater(current.timelines[frameId] ?? createTimeline(frameId))
  const timelines = { ...current.timelines }
  if (!nextTimeline || nextTimeline.tracks.length === 0) delete timelines[frameId]
  else timelines[frameId] = nextTimeline
  return normalizeMotionDocument({ ...current, timelines })
}

export function removeTimeline(
  motion: CanvasMotionDocument | undefined,
  frameId: string
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  if (!current.timelines[frameId]) return current
  const timelines = { ...current.timelines }
  delete timelines[frameId]
  return normalizeMotionDocument({ ...current, timelines })
}

export function configureTimeline(
  motion: CanvasMotionDocument | undefined,
  frameId: string,
  configuration: TimelineConfiguration
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  const previous = current.timelines[frameId] ?? createTimeline(frameId)
  const durationMs = positive(configuration.durationMs, previous.durationMs)
  const timeline: CanvasMotionTimeline = {
    ...previous,
    durationMs,
    playback: configuration.playback ?? previous.playback,
    tracks: previous.tracks.map((track) => ({
      ...track,
      delayMs: Math.min(track.delayMs ?? 0, durationMs),
      durationMs: Math.min(track.durationMs ?? durationMs, durationMs)
    }))
  }
  return normalizeMotionDocument({
    ...current,
    timelines: { ...current.timelines, [frameId]: timeline }
  })
}

function manualTrack(
  frameId: string,
  shape: CanvasShape,
  property: CanvasMotionProperty,
  options: Pick<AddPropertyTracksInput, 'delayMs' | 'durationMs' | 'easing' | 'operation'>
): CanvasMotionTrack {
  const delayMs = nonNegative(options.delayMs, 0)
  const durationMs = positive(options.durationMs, DEFAULT_MOTION_TRACK_DURATION_MS)
  const baseValue = shapeBaseValue(shape, property)
  const id = motionTrackId(frameId, shape.id, property)
  const easing = options.easing ?? EASE_OUT
  const operation = options.operation ?? defaultOperation(property)
  const initialValue = operation === 'set' ? baseValue : operation === 'offset' ? 0 : 1
  return {
    id,
    targetShapeId: shape.id,
    property,
    operation,
    baseValue,
    delayMs,
    durationMs,
    keyframes: [
      { id: motionKeyframeId(id, 0), timeMs: 0, value: initialValue, easing },
      {
        id: motionKeyframeId(id, durationMs),
        timeMs: durationMs,
        value: initialValue,
        easing
      }
    ]
  }
}

export function addPropertyTracks(
  motion: CanvasMotionDocument | undefined,
  input: AddPropertyTracksInput
): CanvasMotionDocument {
  let timeline = emptyIfMissing(motion).timelines[input.frameId] ?? createTimeline(input.frameId)
  for (const targetShapeId of input.targetShapeIds) {
    const shape = input.document.objects[targetShapeId]
    if (!shape || targetShapeId === input.document.rootId) continue
    for (const property of input.properties) {
      timeline = replaceTrack(timeline, manualTrack(input.frameId, shape, property, input))
    }
  }
  return replaceTimeline(motion, timeline)
}

function keyframeSort(left: CanvasMotionKeyframe, right: CanvasMotionKeyframe): number {
  return left.timeMs - right.timeMs || left.id.localeCompare(right.id)
}

export function upsertKeyframe(
  motion: CanvasMotionDocument | undefined,
  input: UpsertKeyframeInput
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  let timeline = current.timelines[input.frameId] ?? createTimeline(input.frameId)
  const existing = timeline.tracks.find(
    (track) =>
      (input.trackId && track.id === input.trackId) ||
      (track.targetShapeId === input.targetShapeId && track.property === input.property)
  )
  const delayMs = nonNegative(input.delayMs, existing?.delayMs ?? 0)
  const requestedTime = nonNegative(input.timeMs, 0)
  const durationMs = Math.max(
    positive(input.durationMs, existing?.durationMs ?? DEFAULT_MOTION_TRACK_DURATION_MS),
    requestedTime
  )
  const trackId =
    existing?.id ??
    input.trackId ??
    motionTrackId(input.frameId, input.targetShapeId, input.property)
  const keyframeId = input.keyframeId ?? motionKeyframeId(trackId, requestedTime)
  const keyframe: CanvasMotionKeyframe = {
    id: keyframeId,
    timeMs: Math.min(requestedTime, durationMs),
    value: finiteOr(input.value, existing?.baseValue ?? input.baseValue ?? 0),
    easing: input.easing ?? EASE_OUT
  }
  const keyframes = (existing?.keyframes ?? [])
    .filter((candidate) => candidate.id !== keyframe.id && candidate.timeMs !== keyframe.timeMs)
    .concat(keyframe)
    .sort(keyframeSort)
  const track: CanvasMotionTrack = {
    id: trackId,
    targetShapeId: input.targetShapeId,
    property: input.property,
    operation: input.operation ?? existing?.operation ?? defaultOperation(input.property),
    baseValue: finiteOr(
      input.baseValue,
      existing?.baseValue ?? (input.property === 'scaleX' || input.property === 'scaleY' ? 1 : 0)
    ),
    delayMs,
    durationMs,
    keyframes
  }
  timeline = replaceTrack(timeline, track)
  return replaceTimeline(current, timeline)
}

export function removeTrack(
  motion: CanvasMotionDocument | undefined,
  frameId: string,
  trackId: string
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  const timeline = current.timelines[frameId]
  if (!timeline) return current
  return updateTimeline(current, frameId, (value) => ({
    ...value,
    tracks: value.tracks.filter((track) => track.id !== trackId)
  }))
}

export function removeKeyframe(
  motion: CanvasMotionDocument | undefined,
  frameId: string,
  trackId: string,
  keyframeId: string
): CanvasMotionDocument {
  const current = emptyIfMissing(motion)
  const timeline = current.timelines[frameId]
  const track = timeline?.tracks.find((candidate) => candidate.id === trackId)
  if (!timeline || !track) return current
  const keyframes = track.keyframes.filter((keyframe) => keyframe.id !== keyframeId)
  if (keyframes.length === 0) return removeTrack(current, frameId, trackId)
  return replaceTimeline(current, replaceTrack(timeline, { ...track, keyframes }))
}

function paintOrderedSelection(document: CanvasDocument, ids: readonly string[]): string[] {
  const selected = new Set(ids)
  const ordered: string[] = []
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)
    if (selected.has(id) && id !== document.rootId && document.objects[id]) ordered.push(id)
    for (const childId of document.objects[id]?.children ?? []) visit(childId)
  }
  visit(document.rootId)
  // Corrupt or temporarily detached shapes still get deterministic treatment.
  for (const id of [...selected].sort()) visit(id)
  return ordered
}

function presetTracks(
  preset: CanvasMotionPreset,
  frameId: string,
  shape: CanvasShape,
  delayMs: number,
  durationMs: number,
  options: MotionPresetOptions
): CanvasMotionTrack[] {
  const easing = options.easing ?? EASE_OUT
  const make = (
    property: CanvasMotionProperty,
    operation: CanvasMotionOperation,
    baseValue: number,
    from: number,
    to: number
  ): CanvasMotionTrack => {
    const id = motionTrackId(frameId, shape.id, property)
    return {
      id,
      targetShapeId: shape.id,
      property,
      operation,
      baseValue,
      delayMs,
      durationMs,
      keyframes: [
        { id: motionKeyframeId(id, 0), timeMs: 0, value: from, easing },
        {
          id: motionKeyframeId(id, durationMs),
          timeMs: durationMs,
          value: to,
          easing
        }
      ]
    }
  }

  switch (preset) {
    case 'fade':
      return [make('opacity', 'set', shape.opacity, 0, shape.opacity)]
    case 'move': {
      const distance = Math.abs(finiteOr(options.distance, 32))
      switch (options.direction ?? 'up') {
        case 'left':
          return [make('x', 'offset', shape.x, -distance, 0)]
        case 'right':
          return [make('x', 'offset', shape.x, distance, 0)]
        case 'down':
          return [make('y', 'offset', shape.y, distance, 0)]
        case 'up':
          return [make('y', 'offset', shape.y, -distance, 0)]
      }
      return []
    }
    case 'scale': {
      const from = Math.max(0, finiteOr(options.scaleFrom, 0.8))
      return [make('scaleX', 'scale', 1, from, 1), make('scaleY', 'scale', 1, from, 1)]
    }
    case 'rotate':
      return [make('rotation', 'offset', shape.rotation, finiteOr(options.rotateFrom, -15), 0)]
  }
}

export function applyMotionPreset(
  motion: CanvasMotionDocument | undefined,
  document: CanvasDocument,
  frameId: string,
  targetShapeIds: readonly string[],
  preset: CanvasMotionPreset,
  options: MotionPresetOptions = {}
): CanvasMotionDocument {
  const durationMs = positive(options.durationMs, DEFAULT_MOTION_TRACK_DURATION_MS)
  const staggerMs = nonNegative(options.staggerMs, 0)
  let timeline = emptyIfMissing(motion).timelines[frameId] ?? createTimeline(frameId)
  paintOrderedSelection(document, targetShapeIds).forEach((shapeId, index) => {
    const shape = document.objects[shapeId]
    if (!shape) return
    const delayMs = index * staggerMs
    for (const track of presetTracks(preset, frameId, shape, delayMs, durationMs, options)) {
      timeline = replaceTrack(timeline, track)
    }
  })
  return replaceTimeline(motion, timeline)
}

function absoluteValueForTrack(
  track: CanvasMotionTrack,
  value: number,
  baseValue: number = track.baseValue
): number {
  switch (track.operation) {
    case 'set':
      return value
    case 'offset':
      return value - baseValue
    case 'scale':
      return baseValue === 0 ? value : value / baseValue
  }
}

function timelineToTrackTime(track: CanvasMotionTrack, timelineTimeMs: number): number {
  const delayed = Math.max(0, timelineTimeMs - (track.delayMs ?? 0))
  const finalKeyframeTime = track.keyframes[track.keyframes.length - 1]?.timeMs ?? 0
  if (!track.durationMs || finalKeyframeTime <= 0) return delayed
  return Math.max(0, Math.min(
    finalKeyframeTime,
    delayed / track.durationMs * finalKeyframeTime
  ))
}

function isAutoKeyProperty(
  key: keyof CanvasShape
): key is Extract<CanvasMotionProperty, keyof CanvasShape> {
  return key === 'x' || key === 'y' || key === 'rotation' || key === 'opacity'
}

/**
 * Converts supported absolute shape edits into canonical keyframes. The caller
 * commits `shapePatch` normally, so unrelated fields in a mixed inspector edit
 * remain ordinary shape mutations while the animated base properties do not.
 */
export function applyAutoKey(
  motion: CanvasMotionDocument | undefined,
  document: CanvasDocument,
  frameId: string,
  targetShapeId: string,
  playheadMs: number,
  patch: Partial<CanvasShape>,
  easing: CanvasMotionEasing = LINEAR
): AutoKeyResult {
  const shape = document.objects[targetShapeId]
  const current = emptyIfMissing(motion)
  if (!shape || !Number.isFinite(playheadMs) || playheadMs <= 0) {
    return { motion: current, shapePatch: patch, animatedProperties: [] }
  }

  let next = current
  const shapePatch: Partial<CanvasShape> = { ...patch }
  const animatedProperties: CanvasMotionProperty[] = []
  for (const key of Object.keys(patch) as (keyof CanvasShape)[]) {
    if (!isAutoKeyProperty(key)) continue
    const desiredValue = patch[key]
    if (typeof desiredValue !== 'number' || !Number.isFinite(desiredValue)) continue
    const timeline = next.timelines[frameId]
    const existing = timeline?.tracks.find(
      (track) => track.targetShapeId === targetShapeId && track.property === key
    )
    const delayMs = existing?.delayMs ?? 0
    const localTimeMs = existing
      ? timelineToTrackTime(existing, playheadMs)
      : Math.max(0, playheadMs - delayMs)
    const baseValue = shapeBaseValue(shape, key)
    if (!existing) {
      next = upsertKeyframe(next, {
        frameId,
        targetShapeId,
        property: key,
        timeMs: 0,
        value: baseValue,
        easing,
        operation: 'set',
        baseValue,
        durationMs: playheadMs
      })
    }
    const track = next.timelines[frameId]?.tracks.find(
      (candidate) => candidate.targetShapeId === targetShapeId && candidate.property === key
    )
    next = upsertKeyframe(next, {
      frameId,
      targetShapeId,
      property: key,
      trackId: track?.id,
      timeMs: localTimeMs,
      value: track ? absoluteValueForTrack(track, desiredValue, baseValue) : desiredValue,
      easing,
      operation: track?.operation ?? 'set',
      baseValue,
      delayMs,
      durationMs: Math.max(track?.durationMs ?? 0, localTimeMs)
    })
    delete shapePatch[key]
    animatedProperties.push(key)
  }
  return { motion: next, shapePatch, animatedProperties }
}
