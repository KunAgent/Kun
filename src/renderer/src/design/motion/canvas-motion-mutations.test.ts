import { describe, expect, it } from 'vitest'
import {
  createDefaultShape,
  createEmptyDocument,
  type CanvasDocument
} from '../canvas/canvas-types'
import {
  addPropertyTracks,
  applyAutoKey,
  applyMotionPreset,
  configureTimeline,
  removeKeyframe,
  removeTrack,
  upsertKeyframe
} from './canvas-motion-mutations'
import { createEmptyMotionDocument, motionTrackId } from './model'

function createMotionTestDocument(): CanvasDocument {
  const document = createEmptyDocument()
  const frame = {
    ...createDefaultShape('frame', 0, 0),
    id: 'frame',
    parentId: document.rootId
  }
  const first = {
    ...createDefaultShape('rect', 10, 20),
    id: 'first',
    parentId: frame.id,
    frameId: frame.id,
    rotation: 12,
    opacity: 0.75
  }
  const second = {
    ...createDefaultShape('rect', 30, 40),
    id: 'second',
    parentId: frame.id,
    frameId: frame.id
  }
  frame.children = [second.id, first.id]
  document.objects[document.rootId] = {
    ...document.objects[document.rootId],
    children: [frame.id]
  }
  document.objects[frame.id] = frame
  document.objects[first.id] = first
  document.objects[second.id] = second
  return document
}

describe('canvas motion mutations', () => {
  it('adds one replaceable manual track per target and property', () => {
    const document = createMotionTestDocument()
    let motion = addPropertyTracks(createEmptyMotionDocument(), {
      document,
      frameId: 'frame',
      targetShapeIds: ['first'],
      properties: ['x', 'opacity'],
      durationMs: 800
    })

    expect(motion.timelines.frame.tracks).toHaveLength(2)
    expect(motion.timelines.frame.tracks[0]).toMatchObject({
      targetShapeId: 'first',
      property: 'x',
      baseValue: 10,
      durationMs: 800
    })
    expect(motion.timelines.frame.tracks[0].keyframes.map((keyframe) => keyframe.timeMs)).toEqual([
      0, 800
    ])

    motion = addPropertyTracks(motion, {
      document,
      frameId: 'frame',
      targetShapeIds: ['first'],
      properties: ['x'],
      durationMs: 400
    })
    expect(motion.timelines.frame.tracks).toHaveLength(2)
    expect(motion.timelines.frame.tracks.find((track) => track.property === 'x')?.durationMs).toBe(
      400
    )
  })

  it('seeds offset and scale tracks with relative identity values', () => {
    const document = createMotionTestDocument()
    const offsetMotion = addPropertyTracks(createEmptyMotionDocument(), {
      document,
      frameId: 'frame',
      targetShapeIds: ['first'],
      properties: ['x'],
      operation: 'offset'
    })
    const scaleMotion = addPropertyTracks(offsetMotion, {
      document,
      frameId: 'frame',
      targetShapeIds: ['first'],
      properties: ['scaleX']
    })

    expect(offsetMotion.timelines.frame.tracks[0].keyframes.map((keyframe) => keyframe.value)).toEqual([
      0,
      0
    ])
    expect(scaleMotion.timelines.frame.tracks[1]).toMatchObject({
      operation: 'scale',
      baseValue: 1
    })
    expect(
      scaleMotion.timelines.frame.tracks[1].keyframes.map((keyframe) => keyframe.value)
    ).toEqual([1, 1])
  })

  it('upserts keyframes by timestamp, keeps them sorted, and removes empty containers', () => {
    let motion = createEmptyMotionDocument()
    motion = upsertKeyframe(motion, {
      frameId: 'frame',
      targetShapeId: 'first',
      property: 'x',
      timeMs: 900,
      value: 90,
      baseValue: 10
    })
    motion = upsertKeyframe(motion, {
      frameId: 'frame',
      targetShapeId: 'first',
      property: 'x',
      timeMs: 100,
      value: 20
    })
    motion = upsertKeyframe(motion, {
      frameId: 'frame',
      targetShapeId: 'first',
      property: 'x',
      timeMs: 900,
      value: 100
    })

    const track = motion.timelines.frame.tracks[0]
    expect(track.keyframes.map(({ timeMs, value }) => ({ timeMs, value }))).toEqual([
      { timeMs: 100, value: 20 },
      { timeMs: 900, value: 100 }
    ])

    motion = removeKeyframe(motion, 'frame', track.id, track.keyframes[0].id)
    expect(motion.timelines.frame.tracks[0].keyframes).toHaveLength(1)
    motion = removeTrack(motion, 'frame', track.id)
    expect(motion.timelines).toEqual({})
  })

  it('configures an existing timeline without allowing tracks past the new duration', () => {
    const document = createMotionTestDocument()
    const motion = configureTimeline(
      addPropertyTracks(createEmptyMotionDocument(), {
        document,
        frameId: 'frame',
        targetShapeIds: ['first'],
        properties: ['x'],
        delayMs: 200,
        durationMs: 800
      }),
      'frame',
      { durationMs: 500, playback: 'ping-pong' }
    )

    expect(motion.timelines.frame).toMatchObject({
      durationMs: 500,
      playback: 'ping-pong'
    })
    expect(motion.timelines.frame.tracks[0]).toMatchObject({
      delayMs: 200,
      durationMs: 300
    })
    expect(motion.timelines.frame.tracks[0].keyframes.at(-1)?.timeMs).toBe(300)
  })

  it('expands presets into editable tracks with paint-order stagger and replaces them', () => {
    const document = createMotionTestDocument()
    let motion = applyMotionPreset(
      createEmptyMotionDocument(),
      document,
      'frame',
      ['first', 'second'],
      'move',
      { direction: 'left', distance: 48, durationMs: 500, staggerMs: 100 }
    )

    const tracks = motion.timelines.frame.tracks
    expect(tracks.map((track) => track.targetShapeId)).toEqual(['second', 'first'])
    expect(tracks.map((track) => track.delayMs)).toEqual([0, 100])
    expect(tracks[0]).toMatchObject({
      property: 'x',
      operation: 'offset',
      baseValue: 30
    })
    expect(tracks[0].keyframes.map((keyframe) => keyframe.value)).toEqual([-48, 0])

    motion = applyMotionPreset(motion, document, 'frame', ['first', 'second'], 'move', {
      direction: 'right',
      distance: 24,
      staggerMs: 50
    })
    expect(motion.timelines.frame.tracks).toHaveLength(2)
    expect(motion.timelines.frame.tracks[0].keyframes[0].value).toBe(24)
    expect(motion.timelines.frame.tracks[1].delayMs).toBe(50)
  })

  it('materializes Fade, Scale, and Rotate as ordinary canonical tracks', () => {
    const document = createMotionTestDocument()
    let motion = createEmptyMotionDocument()
    motion = applyMotionPreset(motion, document, 'frame', ['first'], 'fade')
    motion = applyMotionPreset(motion, document, 'frame', ['first'], 'scale')
    motion = applyMotionPreset(motion, document, 'frame', ['first'], 'rotate')

    expect(motion.timelines.frame.tracks.map((track) => track.property)).toEqual([
      'opacity',
      'scaleX',
      'scaleY',
      'rotation'
    ])
    expect(motion.timelines.frame.tracks.every((track) => track.keyframes.length === 2)).toBe(true)
  })

  it('Auto-key removes animated values from a mixed shape patch and preserves base geometry', () => {
    const document = createMotionTestDocument()
    const result = applyAutoKey(createEmptyMotionDocument(), document, 'frame', 'first', 750, {
      x: 120,
      opacity: 0.4,
      width: 160
    })

    expect(result.shapePatch).toEqual({ width: 160 })
    expect(result.animatedProperties).toEqual(['x', 'opacity'])
    expect(document.objects.first).toMatchObject({ x: 10, opacity: 0.75 })
    const xTrack = result.motion.timelines.frame.tracks.find((track) => track.property === 'x')
    expect(xTrack).toMatchObject({ baseValue: 10, operation: 'set' })
    expect(xTrack?.keyframes.map(({ timeMs, value }) => ({ timeMs, value }))).toEqual([
      { timeMs: 0, value: 10 },
      { timeMs: 750, value: 120 }
    ])
  })

  it('Auto-key converts absolute edits for an existing offset track', () => {
    const document = createMotionTestDocument()
    const trackId = motionTrackId('frame', 'first', 'x')
    const preset = applyMotionPreset(
      createEmptyMotionDocument(),
      document,
      'frame',
      ['first'],
      'move',
      { direction: 'left' }
    )
    const result = applyAutoKey(preset, document, 'frame', 'first', 300, {
      x: 42
    })
    const track = result.motion.timelines.frame.tracks.find((candidate) => candidate.id === trackId)

    expect(track?.operation).toBe('offset')
    expect(track?.keyframes.find((keyframe) => keyframe.timeMs === 300)?.value).toBe(32)
  })

  it('maps the Auto-key playhead into an existing track-local keyframe span', () => {
    const document = createMotionTestDocument()
    const preset = applyMotionPreset(
      createEmptyMotionDocument(),
      document,
      'frame',
      ['first'],
      'move',
      { direction: 'left', durationMs: 600 }
    )
    const source = preset.timelines.frame.tracks[0]
    const motion = {
      ...preset,
      timelines: {
        frame: {
          ...preset.timelines.frame,
          tracks: [{
            ...source,
            durationMs: 600,
            keyframes: source.keyframes.map((keyframe, index) => ({
              ...keyframe,
              timeMs: index === 0 ? 0 : 300
            }))
          }]
        }
      }
    }
    const result = applyAutoKey(motion, document, 'frame', 'first', 300, { x: 42 })
    const track = result.motion.timelines.frame.tracks[0]
    expect(track.keyframes.find((keyframe) => keyframe.timeMs === 150)?.value).toBe(32)
  })
})
