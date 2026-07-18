import { engineError } from './errors.js'

export type TimelineSnapKind = 'playhead' | 'clip-start' | 'clip-end' | 'caption' | 'marker' | 'beat'

export type TimelineSnapTarget = {
  id: string
  frame: number
  kind: TimelineSnapKind
  trackId?: string
  label?: string
}

export type TimelineSnapState = {
  targetId: string
  frame: number
  kind: TimelineSnapKind
}

export type TimelineSnapResult = {
  requestedFrame: number
  frame: number
  snapped: boolean
  sticky: boolean
  target?: TimelineSnapTarget
  deltaFrames: number
  feedback: 'none' | 'acquired' | 'held' | 'released'
}

const KIND_PRIORITY: Readonly<Record<TimelineSnapKind, number>> = Object.freeze({
  playhead: 0,
  'clip-start': 1,
  'clip-end': 2,
  caption: 3,
  marker: 4,
  beat: 5
})

export function collectTimelineSnapTargets(input: {
  playheadFrame?: number
  clips?: Array<{ id: string; trackId: string; startFrame: number; endFrame: number }>
  captions?: Array<{ id: string; startFrame: number; endFrame: number }>
  markers?: Array<{ id: string; frame: number; label?: string }>
  beats?: Array<{ id: string; frame: number; label?: string }>
  excludeIds?: readonly string[]
}): TimelineSnapTarget[] {
  const excluded = new Set(input.excludeIds ?? [])
  const targets: TimelineSnapTarget[] = []
  if (input.playheadFrame !== undefined) {
    targets.push(target('playhead', 'playhead', input.playheadFrame))
  }
  for (const clip of input.clips ?? []) {
    if (excluded.has(clip.id)) continue
    targets.push(target(`${clip.id}:start`, 'clip-start', clip.startFrame, clip.trackId))
    targets.push(target(`${clip.id}:end`, 'clip-end', clip.endFrame, clip.trackId))
  }
  for (const caption of input.captions ?? []) {
    if (excluded.has(caption.id)) continue
    targets.push(target(`${caption.id}:start`, 'caption', caption.startFrame))
    targets.push(target(`${caption.id}:end`, 'caption', caption.endFrame))
  }
  for (const marker of input.markers ?? []) {
    if (!excluded.has(marker.id)) targets.push(target(marker.id, 'marker', marker.frame, undefined, marker.label))
  }
  for (const beat of input.beats ?? []) {
    if (!excluded.has(beat.id)) targets.push(target(beat.id, 'beat', beat.frame, undefined, beat.label))
  }
  return deduplicateTargets(targets)
}

export function snapTimelineFrame(input: {
  requestedFrame: number
  pixelsPerFrame: number
  thresholdPixels: number
  releasePixels?: number
  targets: readonly TimelineSnapTarget[]
  previous?: TimelineSnapState
  preferredTrackId?: string
}): TimelineSnapResult {
  const requestedFrame = frame(input.requestedFrame, 'requestedFrame')
  const pixelsPerFrame = finitePositive(input.pixelsPerFrame, 'pixelsPerFrame')
  const thresholdPixels = finiteNonNegative(input.thresholdPixels, 'thresholdPixels')
  const releasePixels = input.releasePixels === undefined
    ? thresholdPixels * 1.75
    : finiteNonNegative(input.releasePixels, 'releasePixels')
  if (input.previous) {
    const previous = input.targets.find(({ id }) => id === input.previous!.targetId)
    if (previous) {
      const distancePixels = Math.abs(requestedFrame - previous.frame) * pixelsPerFrame
      if (distancePixels <= releasePixels) {
        return {
          requestedFrame,
          frame: previous.frame,
          snapped: true,
          sticky: true,
          target: previous,
          deltaFrames: previous.frame - requestedFrame,
          feedback: 'held'
        }
      }
    }
  }
  const candidates = input.targets
    .map((candidate) => ({
      candidate,
      distanceFrames: Math.abs(requestedFrame - candidate.frame),
      distancePixels: Math.abs(requestedFrame - candidate.frame) * pixelsPerFrame
    }))
    .filter(({ distancePixels }) => distancePixels <= thresholdPixels)
    .sort((left, right) =>
      left.distancePixels - right.distancePixels ||
      trackRank(left.candidate, input.preferredTrackId) - trackRank(right.candidate, input.preferredTrackId) ||
      KIND_PRIORITY[left.candidate.kind] - KIND_PRIORITY[right.candidate.kind] ||
      left.candidate.frame - right.candidate.frame ||
      left.candidate.id.localeCompare(right.candidate.id)
    )
  const selected = candidates[0]?.candidate
  if (!selected) {
    return {
      requestedFrame,
      frame: requestedFrame,
      snapped: false,
      sticky: false,
      deltaFrames: 0,
      feedback: input.previous ? 'released' : 'none'
    }
  }
  return {
    requestedFrame,
    frame: selected.frame,
    snapped: true,
    sticky: false,
    target: selected,
    deltaFrames: selected.frame - requestedFrame,
    feedback: 'acquired'
  }
}

function deduplicateTargets(targets: readonly TimelineSnapTarget[]): TimelineSnapTarget[] {
  const byIdentity = new Map<string, TimelineSnapTarget>()
  for (const candidate of targets) {
    const key = `${candidate.kind}\0${candidate.frame}\0${candidate.trackId ?? ''}\0${candidate.id}`
    byIdentity.set(key, candidate)
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.frame - right.frame || KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind] ||
    left.id.localeCompare(right.id)
  )
}

function target(
  id: string,
  kind: TimelineSnapKind,
  value: number,
  trackId?: string,
  label?: string
): TimelineSnapTarget {
  if (!id || id.length > 160) throw engineError('invalid_operation', 'Snap target identity is invalid')
  return {
    id,
    kind,
    frame: frame(value, `${id}.frame`),
    ...(trackId ? { trackId } : {}),
    ...(label ? { label: label.slice(0, 160) } : {})
  }
}

function trackRank(target: TimelineSnapTarget, preferredTrackId?: string): number {
  return preferredTrackId && target.trackId === preferredTrackId ? 0 : 1
}

function frame(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw engineError('invalid_operation', `${label} must be a non-negative safe integer frame`)
  }
  return value
}
function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw engineError('invalid_operation', `${label} must be positive and finite`)
  }
  return value
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw engineError('invalid_operation', `${label} must be non-negative and finite`)
  }
  return value
}
