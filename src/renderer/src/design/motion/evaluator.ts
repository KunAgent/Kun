import type {
  CanvasMotionEasing,
  CanvasMotionPlaybackDirection,
  CanvasMotionPlaybackMode,
  CanvasMotionPlaybackStep,
  CanvasMotionProjection,
  CanvasMotionTimeline,
  CanvasMotionTrack
} from './canvas-motion-types'

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

function cubicBezierCoordinate(t: number, p1: number, p2: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
}

function cubicBezierDerivative(t: number, p1: number, p2: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * p1
    + 6 * inverse * t * (p2 - p1)
    + 3 * t * t * (1 - p2)
}

/** Evaluate a CSS-compatible cubic bezier by inverting its x coordinate. */
export function evaluateCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const targetX = clamp01(progress)
  if (targetX === 0 || targetX === 1) return targetX

  let parameter = targetX
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = cubicBezierCoordinate(parameter, x1, x2) - targetX
    if (Math.abs(error) < 1e-7) break
    const derivative = cubicBezierDerivative(parameter, x1, x2)
    if (Math.abs(derivative) < 1e-7) break
    parameter = clamp01(parameter - error / derivative)
  }

  // Newton iteration can stall on very flat handles. A short binary search
  // keeps arbitrary-time scrubbing deterministic for those curves too.
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const x = cubicBezierCoordinate(parameter, x1, x2)
    if (Math.abs(x - targetX) < 1e-7) break
    if (x < targetX) low = parameter
    else high = parameter
    parameter = (low + high) / 2
  }
  const result = cubicBezierCoordinate(parameter, y1, y2)
  return Number.isFinite(result) ? result : targetX
}

function springResponseAt(
  timeSeconds: number,
  mass: number,
  stiffness: number,
  damping: number,
  initialVelocity: number
): number {
  const naturalFrequency = Math.sqrt(stiffness / mass)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))

  if (dampingRatio < 1 - 1e-5) {
    const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio * dampingRatio)
    const envelope = Math.exp(-dampingRatio * naturalFrequency * timeSeconds)
    const coefficient = (dampingRatio * naturalFrequency - initialVelocity) / dampedFrequency
    const displacement = envelope * (
      Math.cos(dampedFrequency * timeSeconds)
      + coefficient * Math.sin(dampedFrequency * timeSeconds)
    )
    return 1 - displacement
  }

  if (dampingRatio <= 1 + 1e-5) {
    const displacement = Math.exp(-naturalFrequency * timeSeconds)
      * (1 + (naturalFrequency - initialVelocity) * timeSeconds)
    return 1 - displacement
  }

  const root = Math.sqrt(dampingRatio * dampingRatio - 1)
  const slowRoot = -naturalFrequency * (dampingRatio - root)
  const fastRoot = -naturalFrequency * (dampingRatio + root)
  const slowCoefficient = (-initialVelocity - fastRoot) / (slowRoot - fastRoot)
  const fastCoefficient = 1 - slowCoefficient
  const displacement = slowCoefficient * Math.exp(slowRoot * timeSeconds)
    + fastCoefficient * Math.exp(fastRoot * timeSeconds)
  return 1 - displacement
}

/**
 * Evaluate a seekable physical spring over normalized time. The physical curve
 * is sampled through its settling window and normalized so the segment reaches
 * the next keyframe exactly at progress 1.
 */
export function evaluateSpringEasing(
  progress: number,
  easing: Extract<CanvasMotionEasing, { type: 'spring' }>
): number {
  const normalizedProgress = clamp01(progress)
  if (normalizedProgress === 0 || normalizedProgress === 1) return normalizedProgress

  const mass = Math.max(1e-4, easing.mass)
  const stiffness = Math.max(1e-4, easing.stiffness)
  const damping = Math.max(0, easing.damping)
  const initialVelocity = easing.initialVelocity ?? 0
  const naturalFrequency = Math.sqrt(stiffness / mass)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))
  let settleSeconds: number
  if (dampingRatio > 1 + 1e-5) {
    const slowRoot = naturalFrequency * (dampingRatio - Math.sqrt(dampingRatio * dampingRatio - 1))
    settleSeconds = 6 / Math.max(slowRoot, 1e-4)
  } else {
    settleSeconds = 6 / Math.max(dampingRatio * naturalFrequency, naturalFrequency * 0.08)
  }
  settleSeconds = Math.max(0.1, Math.min(10, settleSeconds))

  const response = springResponseAt(
    normalizedProgress * settleSeconds,
    mass,
    stiffness,
    damping,
    initialVelocity
  )
  const endResponse = springResponseAt(
    settleSeconds,
    mass,
    stiffness,
    damping,
    initialVelocity
  )
  const result = Math.abs(endResponse) < 1e-7 ? normalizedProgress : response / endResponse
  return Number.isFinite(result) ? result : normalizedProgress
}

export function evaluateMotionEasing(easing: CanvasMotionEasing, progress: number): number {
  const normalizedProgress = clamp01(progress)
  switch (easing.type) {
    case 'linear':
      return normalizedProgress
    case 'hold':
      return normalizedProgress < 1 ? 0 : 1
    case 'ease-in':
      return evaluateCubicBezier(normalizedProgress, 0.42, 0, 1, 1)
    case 'ease-out':
      return evaluateCubicBezier(normalizedProgress, 0, 0, 0.58, 1)
    case 'ease-in-out':
      return evaluateCubicBezier(normalizedProgress, 0.42, 0, 0.58, 1)
    case 'cubic-bezier':
      return evaluateCubicBezier(normalizedProgress, easing.x1, easing.y1, easing.x2, easing.y2)
    case 'spring':
      return evaluateSpringEasing(normalizedProgress, easing)
  }
}

function composeTrackValue(
  track: CanvasMotionTrack,
  value: number,
  baseValue: number = track.baseValue
): number {
  let result: number
  switch (track.operation) {
    case 'set': result = value; break
    case 'offset': result = baseValue + value; break
    case 'scale': result = baseValue * value; break
  }
  return Number.isFinite(result) ? result : baseValue
}

function resolveTrackLocalTime(track: CanvasMotionTrack, timelineTimeMs: number): number {
  const delayedTime = Math.max(0, timelineTimeMs - (track.delayMs ?? 0))
  const finalKeyframeTime = track.keyframes[track.keyframes.length - 1]?.timeMs ?? 0
  if (!track.durationMs || finalKeyframeTime <= 0) return delayedTime
  return delayedTime / track.durationMs * finalKeyframeTime
}

export function evaluateMotionTrack(
  track: CanvasMotionTrack,
  timelineTimeMs: number,
  baseValue: number = track.baseValue
): number {
  if (track.keyframes.length === 0) return baseValue
  const localTimeMs = resolveTrackLocalTime(track, Math.max(0, timelineTimeMs))
  const first = track.keyframes[0]
  const last = track.keyframes[track.keyframes.length - 1]
  if (localTimeMs <= first.timeMs) return composeTrackValue(track, first.value, baseValue)
  if (localTimeMs >= last.timeMs) return composeTrackValue(track, last.value, baseValue)

  let low = 0
  let high = track.keyframes.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (track.keyframes[middle].timeMs <= localTimeMs) low = middle
    else high = middle
  }
  const from = track.keyframes[low]
  const to = track.keyframes[high]
  const span = to.timeMs - from.timeMs
  const progress = span <= 0 ? 1 : (localTimeMs - from.timeMs) / span
  const eased = evaluateMotionEasing(from.easing, progress)
  // Weighted interpolation avoids overflowing the difference when two valid
  // finite endpoints are near opposite Number limits.
  const interpolated = from.value * (1 - eased) + to.value * eased
  return composeTrackValue(track, Number.isFinite(interpolated) ? interpolated : from.value, baseValue)
}

export function evaluateMotionTarget(
  timeline: CanvasMotionTimeline,
  targetShapeId: string,
  timeMs: number,
  baseValues: CanvasMotionProjection = {}
): CanvasMotionProjection {
  const projection: CanvasMotionProjection = {}
  const safeTime = Math.max(0, Math.min(timeline.durationMs, timeMs))
  for (const track of timeline.tracks) {
    if (track.targetShapeId !== targetShapeId) continue
    const value = evaluateMotionTrack(track, safeTime, baseValues[track.property] ?? track.baseValue)
    projection[track.property] = track.property === 'opacity' ? clamp01(value) : value
  }
  return projection
}

const positiveModulo = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus

export function advanceMotionPlayback(
  currentTimeMs: number,
  elapsedMs: number,
  durationMs: number,
  playback: CanvasMotionPlaybackMode,
  direction: CanvasMotionPlaybackDirection = 1,
  rate = 1
): CanvasMotionPlaybackStep {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1
  const current = Number.isFinite(currentTimeMs)
    ? Math.max(0, Math.min(duration, currentTimeMs))
    : 0
  const travel = Number.isFinite(elapsedMs) && Number.isFinite(rate)
    ? Math.max(0, elapsedMs) * Math.max(0, rate)
    : 0
  if (travel === 0) {
    return { timeMs: current, direction, playing: true, boundary: 'none' }
  }

  if (playback === 'once') {
    const next = current + travel * direction
    if (next >= duration) {
      return { timeMs: duration, direction, playing: false, boundary: 'end' }
    }
    if (next <= 0) {
      return { timeMs: 0, direction, playing: false, boundary: 'start' }
    }
    return { timeMs: next, direction, playing: true, boundary: 'none' }
  }

  if (playback === 'loop') {
    const next = current + travel * direction
    const wrapped = next < 0 || next >= duration
    return {
      timeMs: positiveModulo(next, duration),
      direction,
      playing: true,
      boundary: wrapped ? 'wrapped' : 'none'
    }
  }

  const period = duration * 2
  const startingPhase = direction === 1 ? current : period - current
  const nextPhase = startingPhase + travel
  const normalizedPhase = positiveModulo(nextPhase, period)
  const nextDirection: CanvasMotionPlaybackDirection = normalizedPhase < duration ? 1 : -1
  const nextTime = normalizedPhase <= duration ? normalizedPhase : period - normalizedPhase
  const crossedBoundary = nextDirection !== direction
    || Math.floor(startingPhase / duration) !== Math.floor(nextPhase / duration)
  return {
    timeMs: nextTime,
    direction: nextDirection,
    playing: true,
    boundary: crossedBoundary ? 'reversed' : 'none'
  }
}

export const evaluateTimelineTarget = evaluateMotionTarget
