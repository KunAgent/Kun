import { describe, expect, it } from 'vitest'
import {
  parseCanvasDocument,
  parseCanvasMotionDocument,
  serializeCanvasDocument
} from '../canvas/canvas-persistence'
import { createDefaultShape, createEmptyDocument } from '../canvas/canvas-types'
import type { CanvasMotionDocument } from './canvas-motion-types'
import {
  MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
  MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
  MAX_CANVAS_MOTION_DURATION_MS,
  MAX_CANVAS_MOTION_KEYFRAMES,
  MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK,
  MAX_CANVAS_MOTION_SPRING_DAMPING,
  MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS,
  MAX_CANVAS_MOTION_SPRING_MASS,
  MAX_CANVAS_MOTION_SPRING_STIFFNESS,
  MAX_CANVAS_MOTION_TRACKS
} from './canvas-motion-types'
import { motionKeyframeId, motionTimelineId, motionTrackId } from './model'

function documentWithMotion(): ReturnType<typeof createEmptyDocument> {
  const document = createEmptyDocument()
  const shape = createDefaultShape('rect', 10, 20)
  document.objects[shape.id] = { ...shape, parentId: document.rootId }
  document.objects[document.rootId].children = [shape.id]
  const timelineId = motionTimelineId(document.rootId)
  const trackId = motionTrackId(document.rootId, shape.id, 'x')
  document.motion = {
    version: 1,
    timelines: {
      [document.rootId]: {
        id: timelineId,
        frameId: document.rootId,
        durationMs: 2_000,
        playback: 'ping-pong',
        tracks: [{
          id: trackId,
          targetShapeId: shape.id,
          property: 'x',
          operation: 'offset',
          baseValue: shape.x,
          delayMs: 100,
          durationMs: 1_500,
          keyframes: [
            {
              id: motionKeyframeId(trackId, 0),
              timeMs: 0,
              value: 0,
              easing: { type: 'cubic-bezier', x1: 0.2, y1: 0.7, x2: 0.3, y2: 1 }
            },
            {
              id: motionKeyframeId(trackId, 1_500),
              timeMs: 1_500,
              value: 80,
              easing: { type: 'spring', mass: 1, stiffness: 120, damping: 12 }
            }
          ]
        }]
      }
    }
  }
  return document
}

describe('canvas motion persistence', () => {
  it('loads legacy documents without motion as an empty versioned motion document', () => {
    const document = createEmptyDocument()
    delete document.motion

    expect(parseCanvasDocument(serializeCanvasDocument(document))?.motion).toEqual({
      version: 1,
      timelines: {}
    })
  })

  it('round-trips all canonical timeline, track, keyframe, timing, and easing fields', () => {
    const document = documentWithMotion()

    const parsed = parseCanvasDocument(serializeCanvasDocument(document))

    expect(parsed?.motion).toEqual(document.motion)
    expect(parsed?.version).toBe(2)
  })

  it.each([
    ['unsupported version', (motion: CanvasMotionDocument) => ({ ...motion, version: 2 })],
    ['oversized duration', (motion: CanvasMotionDocument) => {
      const root = motion.timelines.__root__
      return { ...motion, timelines: { __root__: { ...root, durationMs: MAX_CANVAS_MOTION_DURATION_MS + 1 } } }
    }],
    ['unknown target', (motion: CanvasMotionDocument) => {
      const root = motion.timelines.__root__
      return {
        ...motion,
        timelines: {
          __root__: {
            ...root,
            tracks: [{ ...root.tracks[0], targetShapeId: 'missing-shape' }]
          }
        }
      }
    }],
    ['unordered timestamps', (motion: CanvasMotionDocument) => {
      const root = motion.timelines.__root__
      return {
        ...motion,
        timelines: {
          __root__: {
            ...root,
            tracks: [{ ...root.tracks[0], keyframes: [...root.tracks[0].keyframes].reverse() }]
          }
        }
      }
    }]
  ])('rejects an unsafe motion payload with %s without rejecting the canvas', (_label, mutate) => {
    const document = documentWithMotion()
    document.motion = mutate(document.motion!) as CanvasMotionDocument

    const parsed = parseCanvasDocument(serializeCanvasDocument(document))

    expect(parsed).not.toBeNull()
    expect(parsed?.motion).toEqual({ version: 1, timelines: {} })
  })

  it('rejects non-finite motion numbers before they reach the evaluator', () => {
    const raw = serializeCanvasDocument(documentWithMotion())
      .replace('"baseValue": 10', '"baseValue": 1e400')

    expect(parseCanvasDocument(raw)?.motion).toEqual({ version: 1, timelines: {} })
  })

  const unsafeFiniteMotionMutations: Array<[
    string,
    (motion: CanvasMotionDocument) => void
  ]> = [
    ['track base value', (motion) => {
      motion.timelines.__root__.tracks[0].baseValue = MAX_CANVAS_MOTION_ABSOLUTE_VALUE + 1
    }],
    ['keyframe value', (motion) => {
      motion.timelines.__root__.tracks[0].keyframes[0].value = -MAX_CANVAS_MOTION_ABSOLUTE_VALUE - 1
    }],
    ['cubic-bezier y control', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[0].easing
      if (easing.type === 'cubic-bezier') easing.y1 = MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS + 1
    }],
    ['spring mass', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[1].easing
      if (easing.type === 'spring') easing.mass = MAX_CANVAS_MOTION_SPRING_MASS + 1
    }],
    ['spring stiffness', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[1].easing
      if (easing.type === 'spring') easing.stiffness = MAX_CANVAS_MOTION_SPRING_STIFFNESS + 1
    }],
    ['spring damping', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[1].easing
      if (easing.type === 'spring') easing.damping = MAX_CANVAS_MOTION_SPRING_DAMPING + 1
    }],
    ['spring initial velocity', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[1].easing
      if (easing.type === 'spring') {
        easing.initialVelocity = MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS + 1
      }
    }],
    ['near-zero spring mass', (motion) => {
      const easing = motion.timelines.__root__.tracks[0].keyframes[1].easing
      if (easing.type === 'spring') easing.mass = Number.MIN_VALUE
    }]
  ]

  it.each(unsafeFiniteMotionMutations)(
    'rejects finite but unsafe %s before it reaches the evaluator',
    (_label, mutate) => {
      const document = documentWithMotion()
      mutate(document.motion!)

      expect(parseCanvasMotionDocument(document.motion, document)).toBeNull()
    }
  )

  it('enforces per-track, document track, and document keyframe budgets', () => {
    const document = documentWithMotion()
    const rootTimeline = document.motion!.timelines[document.rootId]
    const baseTrack = rootTimeline.tracks[0]
    expect(parseCanvasMotionDocument({
      version: 1,
      timelines: {
        [document.rootId]: {
          ...rootTimeline,
          tracks: Array.from({ length: MAX_CANVAS_MOTION_TRACKS + 1 }, () => baseTrack)
        }
      }
    }, document)).toBeNull()
    expect(parseCanvasMotionDocument({
      version: 1,
      timelines: {
        [document.rootId]: {
          ...rootTimeline,
          tracks: [{
            ...baseTrack,
            keyframes: Array.from(
              { length: MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK + 1 },
              (_, index) => ({
                id: `overflow-key-${index}`,
                timeMs: index,
                value: index,
                easing: { type: 'linear' }
              })
            )
          }]
        }
      }
    }, document)).toBeNull()

    const keyframesPerTrack = MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK
    const trackCount = Math.floor(MAX_CANVAS_MOTION_KEYFRAMES / keyframesPerTrack) + 1
    const tracks = Array.from({ length: trackCount }, (_, trackIndex) => {
      const target = createDefaultShape('rect', trackIndex, 0)
      document.objects[target.id] = { ...target, parentId: document.rootId }
      document.objects[document.rootId].children.push(target.id)
      return {
        ...baseTrack,
        id: `budget-track-${trackIndex}`,
        targetShapeId: target.id,
        keyframes: Array.from({ length: keyframesPerTrack }, (_, keyIndex) => ({
          id: `budget-key-${trackIndex}-${keyIndex}`,
          timeMs: keyIndex,
          value: keyIndex,
          easing: { type: 'linear' }
        }))
      }
    })
    expect(parseCanvasMotionDocument({
      version: 1,
      timelines: {
        [document.rootId]: { ...rootTimeline, tracks }
      }
    }, document)).toBeNull()
  })
})
