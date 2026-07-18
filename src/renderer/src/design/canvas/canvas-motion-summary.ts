import type { CanvasDocument } from './canvas-types'
import type { CanvasMotionEasing } from '../motion/canvas-motion-types'

export const CANVAS_MOTION_SUMMARY_MAX_TIMELINES = 12
export const CANVAS_MOTION_SUMMARY_MAX_TRACKS = 48
export const CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES = 192
export const CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES_PER_TRACK = 12

export type CanvasMotionKeyframeSummary = {
  id: string
  /** Track-local time. Add the track delay to locate it on the owning timeline. */
  timeMs: number
  value: number
  easing: CanvasMotionEasing
}

export type CanvasMotionTrackSummary = {
  id: string
  targetShapeId: string
  targetName: string
  property: string
  operation: string
  baseValue: number
  delayMs: number
  durationMs?: number
  keyframeCount: number
  keyframes: CanvasMotionKeyframeSummary[]
  omittedKeyframes?: number
}

export type CanvasMotionTimelineSummary = {
  id: string
  frameId: string
  frameName: string
  durationMs: number
  playback: string
  trackCount: number
  keyframeCount: number
  tracks: CanvasMotionTrackSummary[]
  omittedTracks?: number
}

export type CanvasMotionSummary = {
  version: 1
  timelineCount: number
  trackCount: number
  keyframeCount: number
  timelines: CanvasMotionTimelineSummary[]
  omittedTimelines?: number
  reducedMotion: {
    automaticPlayback: 'disabled-when-preferred'
    editing: 'available'
    scrubAndEndState: 'deterministic'
  }
}

export type CanvasMotionSummaryOptions = {
  preferredFrameId?: string
  maxTimelines?: number
  maxTracks?: number
  maxKeyframes?: number
  maxKeyframesPerTrack?: number
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(maximum, Math.floor(value)))
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/**
 * Builds a bounded, stable-id-rich summary for prompts and handoff. It never
 * dumps the unbounded canonical motion document, but includes enough track and
 * keyframe identity for a later agent turn to update existing motion in place.
 */
export function buildCanvasMotionSummary(
  document: CanvasDocument,
  options: CanvasMotionSummaryOptions = {}
): CanvasMotionSummary | undefined {
  const allTimelines = Object.values(document.motion?.timelines ?? {})
  if (allTimelines.length === 0) return undefined
  const preferredFrameId = options.preferredFrameId
  const orderedTimelines = [...allTimelines].sort((left, right) => {
    const leftPriority = left.frameId === preferredFrameId ? 0 : 1
    const rightPriority = right.frameId === preferredFrameId ? 0 : 1
    return leftPriority - rightPriority || left.frameId.localeCompare(right.frameId) || left.id.localeCompare(right.id)
  })
  const timelineCount = allTimelines.length
  const trackCount = allTimelines.reduce((sum, timeline) => sum + timeline.tracks.length, 0)
  const keyframeCount = allTimelines.reduce(
    (sum, timeline) => sum + timeline.tracks.reduce((trackSum, track) => trackSum + track.keyframes.length, 0),
    0
  )
  const maxTimelines = boundedLimit(
    options.maxTimelines,
    CANVAS_MOTION_SUMMARY_MAX_TIMELINES,
    CANVAS_MOTION_SUMMARY_MAX_TIMELINES
  )
  const maxTracks = boundedLimit(
    options.maxTracks,
    CANVAS_MOTION_SUMMARY_MAX_TRACKS,
    CANVAS_MOTION_SUMMARY_MAX_TRACKS
  )
  const maxKeyframes = boundedLimit(
    options.maxKeyframes,
    CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES,
    CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES
  )
  const maxKeyframesPerTrack = boundedLimit(
    options.maxKeyframesPerTrack,
    CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES_PER_TRACK,
    CANVAS_MOTION_SUMMARY_MAX_KEYFRAMES_PER_TRACK
  )
  let remainingTracks = maxTracks
  let remainingKeyframes = maxKeyframes
  const timelines: CanvasMotionTimelineSummary[] = []
  for (const timeline of orderedTimelines.slice(0, maxTimelines)) {
    const visibleTracks = timeline.tracks.slice(0, remainingTracks)
    const tracks: CanvasMotionTrackSummary[] = []
    for (const track of visibleTracks) {
      const visibleKeyframeCount = Math.min(
        track.keyframes.length,
        maxKeyframesPerTrack,
        remainingKeyframes
      )
      const keyframes = track.keyframes.slice(0, visibleKeyframeCount).map((keyframe) => ({
        id: keyframe.id,
        timeMs: round(keyframe.timeMs),
        value: round(keyframe.value),
        easing: keyframe.easing
      }))
      tracks.push({
        id: track.id,
        targetShapeId: track.targetShapeId,
        targetName: document.objects[track.targetShapeId]?.name?.slice(0, 120) ?? 'Missing target',
        property: track.property,
        operation: track.operation,
        baseValue: round(track.baseValue),
        delayMs: round(track.delayMs ?? 0),
        ...(track.durationMs !== undefined ? { durationMs: round(track.durationMs) } : {}),
        keyframeCount: track.keyframes.length,
        keyframes,
        ...(track.keyframes.length > keyframes.length
          ? { omittedKeyframes: track.keyframes.length - keyframes.length }
          : {})
      })
      remainingKeyframes -= keyframes.length
      remainingTracks -= 1
      if (remainingTracks <= 0 || remainingKeyframes <= 0) break
    }
    timelines.push({
      id: timeline.id,
      frameId: timeline.frameId,
      frameName: document.objects[timeline.frameId]?.name?.slice(0, 120) ?? 'Canvas root',
      durationMs: round(timeline.durationMs),
      playback: timeline.playback,
      trackCount: timeline.tracks.length,
      keyframeCount: timeline.tracks.reduce((sum, track) => sum + track.keyframes.length, 0),
      tracks,
      ...(timeline.tracks.length > tracks.length
        ? { omittedTracks: timeline.tracks.length - tracks.length }
        : {})
    })
    if (remainingTracks <= 0 || remainingKeyframes <= 0) break
  }

  return {
    version: 1,
    timelineCount,
    trackCount,
    keyframeCount,
    timelines,
    ...(timelineCount > timelines.length ? { omittedTimelines: timelineCount - timelines.length } : {}),
    reducedMotion: {
      automaticPlayback: 'disabled-when-preferred',
      editing: 'available',
      scrubAndEndState: 'deterministic'
    }
  }
}
