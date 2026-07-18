import { engineError } from './errors.js'
import type { KeyframePoint, KeyframeTrack } from './schema.js'

export const KEYFRAME_LIMITS = Object.freeze({
  tracksPerItem: 32,
  pointsPerTrack: 256,
  propertyLength: 128
})

export type KeyframeEditNote = {
  code: 'dropped-before' | 'dropped-after' | 'synthesized-start' | 'synthesized-end' | 'deduplicated'
  count: number
}

export type KeyframeEditResult = {
  track: KeyframeTrack
  notes: KeyframeEditNote[]
}

export function sampleKeyframeTrack(track: KeyframeTrack, frame: number): number {
  validateKeyframeTrack(track)
  const target = nonNegativeFrame(frame, 'frame')
  const points = track.points
  if (target <= points[0]!.frame) return points[0]!.value
  if (target >= points.at(-1)!.frame) return points.at(-1)!.value
  const rightIndex = points.findIndex((point) => point.frame >= target)
  const right = points[rightIndex]!
  if (right.frame === target) return right.value
  const left = points[rightIndex - 1]!
  if (track.interpolation === 'hold') return left.value
  const progress = (target - left.frame) / (right.frame - left.frame)
  const weight = track.interpolation === 'ease'
    ? progress * progress * (3 - 2 * progress)
    : progress
  return left.value + (right.value - left.value) * weight
}

export function sampleKeyframedProperties(
  tracks: readonly KeyframeTrack[],
  frame: number
): Record<string, number> {
  if (tracks.length > KEYFRAME_LIMITS.tracksPerItem) invalid('Too many keyframe tracks')
  const result: Record<string, number> = {}
  for (const track of tracks) {
    if (result[track.property] !== undefined) invalid(`Duplicate keyframe property: ${track.property}`)
    result[track.property] = sampleKeyframeTrack(track, frame)
  }
  return result
}

export function trimKeyframeTrack(
  track: KeyframeTrack,
  startFrame: number,
  endFrame: number,
  policy: 'drop' | 'preserve-boundaries' = 'preserve-boundaries'
): KeyframeEditResult {
  validateKeyframeTrack(track)
  const start = nonNegativeFrame(startFrame, 'startFrame')
  const end = nonNegativeFrame(endFrame, 'endFrame')
  if (end <= start) invalid('Keyframe trim range must be non-empty')
  const before = track.points.filter((point) => point.frame < start).length
  const after = track.points.filter((point) => point.frame > end).length
  const kept = track.points
    .filter((point) => point.frame >= start && point.frame <= end)
    .map((point) => ({ ...point, frame: point.frame - start }))
  const notes: KeyframeEditNote[] = []
  if (before > 0) notes.push({ code: 'dropped-before', count: before })
  if (after > 0) notes.push({ code: 'dropped-after', count: after })
  if (policy === 'preserve-boundaries') {
    if (!kept.some((point) => point.frame === 0)) {
      kept.push({ id: boundaryId(track.id, 'start'), frame: 0, value: sampleKeyframeTrack(track, start) })
      notes.push({ code: 'synthesized-start', count: 1 })
    }
    const duration = end - start
    if (!kept.some((point) => point.frame === duration)) {
      kept.push({ id: boundaryId(track.id, 'end'), frame: duration, value: sampleKeyframeTrack(track, end) })
      notes.push({ code: 'synthesized-end', count: 1 })
    }
  }
  if (kept.length === 0) {
    kept.push({ id: boundaryId(track.id, 'start'), frame: 0, value: sampleKeyframeTrack(track, start) })
    notes.push({ code: 'synthesized-start', count: 1 })
  }
  return { track: { ...track, points: normalizePoints(kept, notes) }, notes }
}

export function splitKeyframeTrack(
  track: KeyframeTrack,
  splitFrame: number,
  durationFrames: number
): { left: KeyframeEditResult; right: KeyframeEditResult } {
  const split = nonNegativeFrame(splitFrame, 'splitFrame')
  const duration = nonNegativeFrame(durationFrames, 'durationFrames')
  if (split <= 0 || split >= duration) invalid('Keyframe split must be inside the clip duration')
  return {
    left: trimKeyframeTrack(track, 0, split, 'preserve-boundaries'),
    right: trimKeyframeTrack(track, split, duration, 'preserve-boundaries')
  }
}

export function retimeKeyframeTrack(
  track: KeyframeTrack,
  fromDurationFrames: number,
  toDurationFrames: number
): KeyframeEditResult {
  validateKeyframeTrack(track)
  const fromDuration = positiveFrame(fromDurationFrames, 'fromDurationFrames')
  const toDuration = positiveFrame(toDurationFrames, 'toDurationFrames')
  const notes: KeyframeEditNote[] = []
  const points = track.points.map((point) => ({
    ...point,
    frame: Math.min(toDuration, Math.round(point.frame * toDuration / fromDuration))
  }))
  return { track: { ...track, points: normalizePoints(points, notes) }, notes }
}

export function validateKeyframeTrack(track: KeyframeTrack): void {
  if (!track.id || track.id.length > 128) invalid('Keyframe track id is invalid')
  if (!track.property || track.property.length > KEYFRAME_LIMITS.propertyLength) {
    invalid('Keyframe property is invalid')
  }
  if (!['hold', 'linear', 'ease'].includes(track.interpolation)) invalid('Keyframe interpolation is invalid')
  if (track.points.length < 1 || track.points.length > KEYFRAME_LIMITS.pointsPerTrack) {
    invalid(`Keyframe track must contain 1-${KEYFRAME_LIMITS.pointsPerTrack} points`)
  }
  let previousFrame = -1
  const ids = new Set<string>()
  for (const point of track.points) {
    validatePoint(point)
    if (ids.has(point.id)) invalid(`Duplicate keyframe point id: ${point.id}`)
    if (point.frame <= previousFrame) invalid('Keyframe points must be strictly frame-sorted')
    ids.add(point.id)
    previousFrame = point.frame
  }
}

function normalizePoints(points: readonly KeyframePoint[], notes: KeyframeEditNote[]): KeyframePoint[] {
  const byFrame = new Map<number, KeyframePoint>()
  let duplicates = 0
  for (const point of [...points].sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id))) {
    if (byFrame.has(point.frame)) duplicates += 1
    byFrame.set(point.frame, point)
  }
  if (duplicates > 0) notes.push({ code: 'deduplicated', count: duplicates })
  const result = [...byFrame.values()].sort((left, right) => left.frame - right.frame)
  if (result.length > KEYFRAME_LIMITS.pointsPerTrack) invalid('Retime produced too many keyframe points')
  return result
}

function validatePoint(point: KeyframePoint): void {
  if (!point.id || point.id.length > 128) invalid('Keyframe point id is invalid')
  nonNegativeFrame(point.frame, 'keyframe.frame')
  if (!Number.isFinite(point.value)) invalid('Keyframe point value must be finite')
}

function boundaryId(trackId: string, edge: 'start' | 'end'): string {
  const suffix = edge === 'start' ? '~start' : '~end'
  return `${trackId.slice(0, Math.max(1, 128 - suffix.length))}${suffix}`
}

function positiveFrame(value: number, label: string): number {
  const result = nonNegativeFrame(value, label)
  if (result <= 0) invalid(`${label} must be positive`)
  return result
}

function nonNegativeFrame(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a non-negative safe integer`)
  return value
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
