export const CANVAS_MOTION_VERSION = 1 as const

export const MAX_CANVAS_MOTION_TIMELINES = 100
export const MAX_CANVAS_MOTION_TRACKS = 2_000
export const MAX_CANVAS_MOTION_KEYFRAMES = 20_000
export const MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK = 256
export const MAX_CANVAS_MOTION_DURATION_MS = 600_000
export const MAX_CANVAS_MOTION_ABSOLUTE_VALUE = 1_000_000
export const MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS = 10
export const MIN_CANVAS_MOTION_SPRING_MASS = 0.0001
export const MAX_CANVAS_MOTION_SPRING_MASS = 100
export const MIN_CANVAS_MOTION_SPRING_STIFFNESS = 0.0001
export const MAX_CANVAS_MOTION_SPRING_STIFFNESS = 10_000
export const MAX_CANVAS_MOTION_SPRING_DAMPING = 1_000
export const MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS = 1_000

export const CANVAS_MOTION_PROPERTIES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity'
] as const

export type CanvasMotionProperty = (typeof CANVAS_MOTION_PROPERTIES)[number]

export const CANVAS_MOTION_OPERATIONS = ['set', 'offset', 'scale'] as const
export type CanvasMotionOperation = (typeof CANVAS_MOTION_OPERATIONS)[number]

export const CANVAS_MOTION_PLAYBACK_MODES = ['once', 'loop', 'ping-pong'] as const
export type CanvasMotionPlaybackMode = (typeof CANVAS_MOTION_PLAYBACK_MODES)[number]
export type CanvasMotionPlaybackDirection = 1 | -1

export type CanvasMotionNamedEasing =
  | { type: 'linear' }
  | { type: 'ease-in' }
  | { type: 'ease-out' }
  | { type: 'ease-in-out' }
  | { type: 'hold' }

export type CanvasMotionCubicBezierEasing = {
  type: 'cubic-bezier'
  x1: number
  y1: number
  x2: number
  y2: number
}

export type CanvasMotionSpringEasing = {
  type: 'spring'
  mass: number
  stiffness: number
  damping: number
  initialVelocity?: number
}

export type CanvasMotionEasing =
  | CanvasMotionNamedEasing
  | CanvasMotionCubicBezierEasing
  | CanvasMotionSpringEasing

export type CanvasMotionKeyframe = {
  id: string
  /** Track-local time after delay, in milliseconds. */
  timeMs: number
  value: number
  /** Easing used from this keyframe to the next keyframe. */
  easing: CanvasMotionEasing
}

export type CanvasMotionTrack = {
  id: string
  targetShapeId: string
  property: CanvasMotionProperty
  operation: CanvasMotionOperation
  baseValue: number
  /** Timeline offset for this track. Keyframe times remain track-local. */
  delayMs?: number
  /** Optional timeline span used to scale the track's local keyframe range. */
  durationMs?: number
  keyframes: CanvasMotionKeyframe[]
}

export type CanvasMotionTimeline = {
  id: string
  frameId: string
  durationMs: number
  playback: CanvasMotionPlaybackMode
  tracks: CanvasMotionTrack[]
}

export type CanvasMotionDocument = {
  version: typeof CANVAS_MOTION_VERSION
  timelines: Record<string, CanvasMotionTimeline>
}

export type CanvasMotionProjection = Partial<Record<CanvasMotionProperty, number>>

export type CanvasMotionPlaybackBoundary =
  | 'none'
  | 'start'
  | 'end'
  | 'wrapped'
  | 'reversed'

export type CanvasMotionPlaybackStep = {
  timeMs: number
  direction: CanvasMotionPlaybackDirection
  playing: boolean
  boundary: CanvasMotionPlaybackBoundary
}
