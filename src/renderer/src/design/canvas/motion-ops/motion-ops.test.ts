import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasShapeStore } from '../canvas-shape-store'
import { useCanvasUndoStore } from '../canvas-undo-store'
import {
  createDefaultShape,
  createEmptyDocument,
  ROOT_SHAPE_ID,
  type CanvasDocument
} from '../canvas-types'
import {
  executeMotionOps,
  extractMotionOpsFromValue,
  isDesignMotionRendererToolName,
  MotionOpSchema
} from '.'

function motionDocument(): CanvasDocument {
  const document = createEmptyDocument()
  const frame = {
    ...createDefaultShape('frame', 100, 100),
    id: 'frame_home',
    name: 'Home',
    parentId: ROOT_SHAPE_ID,
    children: ['hero']
  }
  const hero = {
    ...createDefaultShape('rect', 120, 140),
    id: 'hero',
    name: 'Hero',
    parentId: frame.id,
    frameId: frame.id,
    opacity: 0.9
  }
  document.objects[ROOT_SHAPE_ID] = {
    ...document.objects[ROOT_SHAPE_ID],
    children: [frame.id]
  }
  document.objects[frame.id] = frame
  document.objects[hero.id] = hero
  return document
}

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(motionDocument(), 'motion-test')
  useCanvasUndoStore.getState().clear()
})

describe('renderer Motion tool protocol', () => {
  it('recognizes only dedicated Design Motion tools and extracts motionOps', () => {
    expect(isDesignMotionRendererToolName('design_motion_upsert_keyframes')).toBe(true)
    expect(isDesignMotionRendererToolName('design_update_shapes')).toBe(false)
    expect(extractMotionOpsFromValue({ motionOps: [{ op: 'delete' }] })).toEqual([{ op: 'delete' }])
    expect(extractMotionOpsFromValue({ ops: [{ op: 'delete' }] })).toEqual([])
  })

  it('strictly validates finite typed keyframes and easing', () => {
    expect(MotionOpSchema.safeParse({
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'opacity',
      keyframes: [{ timeMs: 0, value: 0, easing: { type: 'hold' } }]
    }).success).toBe(true)
    expect(MotionOpSchema.safeParse({
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'width',
      keyframes: [{ timeMs: 0, value: Number.POSITIVE_INFINITY }]
    }).success).toBe(false)
  })

  it('reports a missing motionOps payload instead of silently falling through to ShapeOps', () => {
    expect(executeMotionOps([])).toMatchObject({
      ok: false,
      affectedIds: [],
      errors: [{ code: 'INVALID_MOTION_OP', message: 'Motion tool output did not contain any motionOps.' }]
    })
  })

  it('persists fresh timeline configuration for a later track mutation', () => {
    expect(executeMotionOps([{
      op: 'set-timeline',
      frameId: 'frame_home',
      durationMs: 4_500,
      playback: 'loop'
    }])).toMatchObject({ ok: true, affectedIds: ['frame_home'] })
    expect(useCanvasShapeStore.getState().document.motion?.timelines.frame_home).toMatchObject({
      durationMs: 4_500,
      playback: 'loop',
      tracks: []
    })

    executeMotionOps([{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'opacity',
      keyframes: [{ timeMs: 500, value: 0.5 }]
    }])
    expect(useCanvasShapeStore.getState().document.motion?.timelines.frame_home).toMatchObject({
      durationMs: 4_500,
      playback: 'loop',
      tracks: [{ targetShapeId: 'hero', property: 'opacity' }]
    })
  })

  it('applies a keyframe batch through canonical motion, undo, and journal state', () => {
    const result = executeMotionOps([{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'opacity',
      operation: 'set',
      keyframes: [
        { id: 'kf_start', timeMs: 0, value: 0, easing: { type: 'linear' } },
        { id: 'kf_end', timeMs: 800, value: 0.9, easing: { type: 'ease-out' } }
      ]
    }], 'tool:motion-1', { replayKey: 'motion-1' })

    expect(result).toEqual({ ok: true, affectedIds: ['hero'], errors: [] })
    const state = useCanvasShapeStore.getState()
    const timeline = state.document.motion?.timelines.frame_home
    expect(timeline).toMatchObject({
      id: 'motion_timeline:frame_home',
      frameId: 'frame_home',
      tracks: [{
        id: 'motion_track:frame_home:hero:opacity',
        targetShapeId: 'hero',
        property: 'opacity',
        keyframes: [
          { id: 'kf_start', timeMs: 0, value: 0 },
          { id: 'kf_end', timeMs: 800, value: 0.9 }
        ]
      }]
    })
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
    expect(state.document.operationJournal).toHaveLength(1)
    expect(state.document.operationJournal?.[0]).toMatchObject({
      label: 'tool:motion-1',
      status: 'applied',
      affectedIds: ['hero'],
      operations: [{ type: 'update_motion', targetIds: ['frame_home', 'hero'] }]
    })
  })

  it('preserves an existing offset operation and easing when an agent omits them', () => {
    executeMotionOps([{
      op: 'apply-preset',
      frameId: 'frame_home',
      targetShapeIds: ['hero'],
      preset: 'move',
      distanceX: -30,
      durationMs: 600
    }])
    const before = useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks[0]
    const firstKeyframe = before?.keyframes[0]
    expect(before?.operation).toBe('offset')

    executeMotionOps([{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'x',
      keyframes: [{ id: firstKeyframe?.id, timeMs: 0, value: -20 }]
    }])

    const after = useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks[0]
    expect(after?.operation).toBe('offset')
    expect(after?.baseValue).toBe(useCanvasShapeStore.getState().document.objects.hero.x)
    expect(after?.keyframes[0].easing).toEqual(firstKeyframe?.easing)
  })

  it('uses the durable replay key to avoid duplicate motion and journal mutations', () => {
    const ops = [{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'hero',
      property: 'x',
      keyframes: [{ timeMs: 200, value: 16 }]
    }]
    executeMotionOps(ops, 'tool:motion-replay', { replayKey: 'motion-replay' })
    const replayed = executeMotionOps(ops, 'tool:motion-replay', { replayKey: 'motion-replay' })

    expect(replayed.replayed).toBe(true)
    expect(useCanvasShapeStore.getState().document.operationJournal).toHaveLength(1)
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('rejects unknown and cross-frame targets with bounded guidance and no stale track', () => {
    const result = executeMotionOps([{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'missing',
      property: 'opacity',
      keyframes: [{ timeMs: 0, value: 0 }]
    }], 'tool:motion-stale', { replayKey: 'motion-stale' })

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: 'MOTION_TARGET_NOT_FOUND' })
    expect(result.errors[0].suggestion).toContain('Hero (hero)')
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
    expect(useCanvasShapeStore.getState().document.operationJournal?.[0]).toMatchObject({
      status: 'partial',
      affectedIds: [],
      operations: [{ type: 'update_motion' }]
    })

    const replayed = executeMotionOps([{
      op: 'upsert-keyframes',
      frameId: 'frame_home',
      targetShapeId: 'missing',
      property: 'opacity',
      keyframes: [{ timeMs: 0, value: 0 }]
    }], 'tool:motion-stale', { replayKey: 'motion-stale' })
    expect(replayed.replayed).toBe(true)
    expect(useCanvasShapeStore.getState().document.operationJournal).toHaveLength(1)
  })

  it('compiles an outgoing staggered preset into editable canonical tracks', () => {
    const result = executeMotionOps([{
      op: 'apply-preset',
      frameId: 'frame_home',
      targetShapeIds: ['hero'],
      preset: 'move',
      direction: 'out',
      durationMs: 500,
      delayMs: 100,
      distanceX: 24,
      distanceY: 12
    }])

    expect(result.ok).toBe(true)
    const tracks = useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks ?? []
    expect(tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        property: 'x',
        operation: 'offset',
        delayMs: 100,
        durationMs: 500,
        keyframes: [
          expect.objectContaining({ timeMs: 0, value: 0 }),
          expect.objectContaining({ timeMs: 500, value: 24 })
        ]
      }),
      expect.objectContaining({
        property: 'y',
        keyframes: [
          expect.objectContaining({ timeMs: 0, value: 0 }),
          expect.objectContaining({ timeMs: 500, value: 12 })
        ]
      })
    ]))
  })

  it('does not fall back to pair or time matching when a stable delete id is supplied', () => {
    executeMotionOps([{
      op: 'apply-preset',
      frameId: 'frame_home',
      targetShapeIds: ['hero'],
      preset: 'move',
      distanceX: 24,
      distanceY: 12
    }])
    const before = useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks ?? []
    const xTrack = before.find((track) => track.property === 'x')!

    executeMotionOps([{
      op: 'delete',
      kind: 'track',
      frameId: 'frame_home',
      trackId: 'stale-track-id',
      targetShapeId: 'hero',
      property: 'x'
    }, {
      op: 'delete',
      kind: 'keyframe',
      frameId: 'frame_home',
      trackId: xTrack.id,
      keyframeId: 'stale-keyframe-id',
      timeMs: xTrack.keyframes[0].timeMs
    }])

    const after = useCanvasShapeStore.getState().document.motion?.timelines.frame_home.tracks ?? []
    expect(after).toHaveLength(before.length)
    expect(after.find((track) => track.id === xTrack.id)?.keyframes).toHaveLength(xTrack.keyframes.length)
  })

  it('rejects oversized batches before mutation or journaling', () => {
    const result = executeMotionOps(Array.from({ length: 65 }, () => ({
      op: 'delete', kind: 'timeline', frameId: 'frame_home'
    })))

    expect(result).toMatchObject({ ok: false, errors: [{ code: 'MOTION_BATCH_LIMIT' }] })
    expect(useCanvasShapeStore.getState().document.operationJournal).toBeUndefined()
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(0)
  })
})
