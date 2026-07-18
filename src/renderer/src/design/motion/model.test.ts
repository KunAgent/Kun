import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument } from '../canvas/canvas-types'
import type { CanvasMotionDocument, CanvasMotionTimeline, CanvasMotionTrack } from './canvas-motion-types'
import {
  MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
  MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
  MAX_CANVAS_MOTION_SPRING_DAMPING,
  MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS,
  MAX_CANVAS_MOTION_SPRING_MASS,
  MAX_CANVAS_MOTION_SPRING_STIFFNESS,
  MAX_CANVAS_MOTION_TIMELINES,
  MIN_CANVAS_MOTION_SPRING_MASS,
  MIN_CANVAS_MOTION_SPRING_STIFFNESS
} from './canvas-motion-types'
import {
  createEmptyMotionDocument,
  findMotionTimelineForFrame,
  findMotionTrack,
  motionKeyframeId,
  motionTimelineId,
  motionTrackId,
  normalizeMotionDocument,
  pruneMotionDocument,
  resolveOwningMotionFrameId
} from './model'

const linear = { type: 'linear' } as const

function track(
  frameId: string,
  targetShapeId: string,
  property: CanvasMotionTrack['property'] = 'x'
): CanvasMotionTrack {
  const id = motionTrackId(frameId, targetShapeId, property)
  return {
    id,
    targetShapeId,
    property,
    operation: 'set',
    baseValue: 0,
    keyframes: [
      { id: motionKeyframeId(id, 0), timeMs: 0, value: 0, easing: linear },
      { id: motionKeyframeId(id, 1_000), timeMs: 1_000, value: 100, easing: linear }
    ]
  }
}

function timeline(frameId: string, tracks: CanvasMotionTrack[]): CanvasMotionTimeline {
  return {
    id: motionTimelineId(frameId),
    frameId,
    durationMs: 1_000,
    playback: 'once',
    tracks
  }
}

describe('canvas motion model', () => {
  it('creates empty versioned motion and deterministic semantic IDs', () => {
    expect(createEmptyMotionDocument()).toEqual({ version: 1, timelines: {} })
    expect(motionTimelineId('frame/a')).toBe(motionTimelineId('frame/a'))
    expect(motionTrackId('frame/a', 'shape 1', 'opacity')).not.toBe(
      motionTrackId('frame/a', 'shape 1', 'x')
    )
    expect(motionKeyframeId('track:1', 12.5)).toBe(motionKeyframeId('track:1', 12.5))
  })

  it('normalizes immutably, sorts timestamps, prefers the final duplicate, and clamps timing', () => {
    const originalTrack = track('__root__', 'shape')
    originalTrack.delayMs = 9_999
    originalTrack.keyframes = [
      { id: 'late', timeMs: 900, value: 90, easing: linear },
      { id: 'first-at-100', timeMs: 100, value: 10, easing: linear },
      { id: 'final-at-100', timeMs: 100, value: 20, easing: linear },
      { id: 'negative', timeMs: -50, value: 0, easing: linear }
    ]
    const original: CanvasMotionDocument = {
      version: 1,
      timelines: { __root__: timeline('__root__', [originalTrack]) }
    }

    const normalized = normalizeMotionDocument(original)
    const result = normalized.timelines.__root__.tracks[0]

    expect(normalized).not.toBe(original)
    expect(result).not.toBe(originalTrack)
    expect(result.delayMs).toBe(999)
    expect(result.keyframes.map((keyframe) => keyframe.timeMs)).toEqual([0, 1])
    expect(result.keyframes.find((keyframe) => keyframe.id === 'final-at-100')?.value).toBe(20)
    expect(originalTrack.delayMs).toBe(9_999)
    expect(originalTrack.keyframes).toHaveLength(4)
  })

  it('clamps finite motion and easing values to safe evaluator bounds', () => {
    const extremeTrack = track('__root__', 'shape')
    extremeTrack.baseValue = 1e308
    extremeTrack.keyframes = [
      {
        id: 'extreme-bezier',
        timeMs: 0,
        value: -1e308,
        easing: { type: 'cubic-bezier', x1: 0.25, y1: 1e308, x2: 0.75, y2: -1e308 }
      },
      {
        id: 'extreme-spring',
        timeMs: 1_000,
        value: 1e308,
        easing: {
          type: 'spring',
          mass: Number.MIN_VALUE,
          stiffness: Number.MIN_VALUE,
          damping: 1e308,
          initialVelocity: -1e308
        }
      }
    ]

    const normalized = normalizeMotionDocument({
      version: 1,
      timelines: { __root__: timeline('__root__', [extremeTrack]) }
    })
    const result = normalized.timelines.__root__.tracks[0]

    expect(result.baseValue).toBe(MAX_CANVAS_MOTION_ABSOLUTE_VALUE)
    expect(result.keyframes[0]).toMatchObject({
      value: -MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
      easing: {
        type: 'cubic-bezier',
        y1: MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
        y2: -MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS
      }
    })
    expect(result.keyframes[1]).toMatchObject({
      value: MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
      easing: {
        type: 'spring',
        mass: MIN_CANVAS_MOTION_SPRING_MASS,
        stiffness: MIN_CANVAS_MOTION_SPRING_STIFFNESS,
        damping: MAX_CANVAS_MOTION_SPRING_DAMPING,
        initialVelocity: -MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS
      }
    })

    const upperSpringTrack = track('__root__', 'upper-spring')
    upperSpringTrack.keyframes[0].easing = {
      type: 'spring',
      mass: 1e308,
      stiffness: 1e308,
      damping: 0
    }
    const upperSpring = normalizeMotionDocument({
      version: 1,
      timelines: { __root__: timeline('__root__', [upperSpringTrack]) }
    }).timelines.__root__.tracks[0].keyframes[0].easing

    expect(upperSpring).toMatchObject({
      type: 'spring',
      mass: MAX_CANVAS_MOTION_SPRING_MASS,
      stiffness: MAX_CANVAS_MOTION_SPRING_STIFFNESS
    })
  })

  it('keeps one manual track per target/property and enforces the timeline budget', () => {
    const timelines: CanvasMotionDocument['timelines'] = {}
    for (let index = 0; index < MAX_CANVAS_MOTION_TIMELINES + 1; index += 1) {
      const frameId = `frame-${index}`
      const first = track(frameId, `shape-${index}`)
      const replacement = { ...first, id: `${first.id}-new`, baseValue: 5 }
      timelines[frameId] = timeline(frameId, [first, replacement])
    }

    const normalized = normalizeMotionDocument({ version: 1, timelines })

    expect(Object.keys(normalized.timelines)).toHaveLength(MAX_CANVAS_MOTION_TIMELINES)
    expect(Object.values(normalized.timelines).every((item) => item.tracks.length === 1)).toBe(true)
    expect(Object.values(normalized.timelines)[0].tracks[0].baseValue).toBe(5)
  })

  it('resolves the selected frame, nearest ancestor frame, and root fallback', () => {
    const document = createEmptyDocument()
    const outer = createDefaultShape('frame', 0, 0)
    const group = createDefaultShape('group', 0, 0)
    const leaf = createDefaultShape('rect', 0, 0)
    document.objects[outer.id] = { ...outer, parentId: document.rootId, children: [group.id] }
    document.objects[group.id] = { ...group, parentId: outer.id, children: [leaf.id] }
    document.objects[leaf.id] = { ...leaf, parentId: group.id }
    document.objects[document.rootId].children = [outer.id]

    expect(resolveOwningMotionFrameId(document, outer.id)).toBe(outer.id)
    expect(resolveOwningMotionFrameId(document, leaf.id)).toBe(outer.id)
    expect(resolveOwningMotionFrameId(document, 'missing')).toBe(document.rootId)
    expect(resolveOwningMotionFrameId(document, null)).toBe(document.rootId)
  })

  it('looks up semantic tracks, prunes invalid targets, and preserves configured empty timelines', () => {
    const document = createEmptyDocument()
    const frame = createDefaultShape('frame', 0, 0)
    const child = createDefaultShape('rect', 0, 0)
    const topLevel = createDefaultShape('rect', 0, 0)
    document.objects[frame.id] = { ...frame, parentId: document.rootId, children: [child.id] }
    document.objects[child.id] = { ...child, parentId: frame.id }
    document.objects[topLevel.id] = { ...topLevel, parentId: document.rootId }
    document.objects[document.rootId].children = [frame.id, topLevel.id]

    const valid = track(frame.id, child.id)
    const missing = track(frame.id, 'deleted')
    const outOfScope = track(frame.id, topLevel.id, 'opacity')
    const motion: CanvasMotionDocument = {
      version: 1,
      timelines: {
        [frame.id]: timeline(frame.id, [valid, missing, outOfScope]),
        deletedFrame: timeline('deletedFrame', [track('deletedFrame', child.id)])
      }
    }

    const pruned = pruneMotionDocument(motion, document)
    const keptTimeline = findMotionTimelineForFrame(pruned, frame.id)

    expect(Object.keys(pruned.timelines)).toEqual([frame.id])
    expect(keptTimeline?.tracks.map((item) => item.id)).toEqual([valid.id])
    expect(findMotionTrack(keptTimeline, child.id, 'x')?.id).toBe(valid.id)
  })
})
