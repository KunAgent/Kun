import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, ROOT_SHAPE_ID } from './canvas-types'
import { buildCanvasMotionSummary } from './canvas-motion-summary'
import { CANVAS_MOTION_VERSION } from '../motion/canvas-motion-types'

describe('canvas motion summary', () => {
  it('omits empty motion and emits bounded stable timeline, track, and keyframe ids', () => {
    const empty = createEmptyDocument()
    expect(buildCanvasMotionSummary(empty)).toBeUndefined()

    const document = createEmptyDocument()
    const frame = {
      ...createDefaultShape('frame', 0, 0),
      id: 'frame_home',
      name: 'Home',
      parentId: ROOT_SHAPE_ID,
      children: ['hero']
    }
    const hero = {
      ...createDefaultShape('rect', 10, 20),
      id: 'hero',
      name: 'Hero card',
      parentId: frame.id,
      frameId: frame.id
    }
    document.objects[ROOT_SHAPE_ID] = { ...document.objects[ROOT_SHAPE_ID], children: [frame.id] }
    document.objects[frame.id] = frame
    document.objects[hero.id] = hero
    document.motion = {
      version: CANVAS_MOTION_VERSION,
      timelines: {
        frame_home: {
          id: 'timeline_home',
          frameId: frame.id,
          durationMs: 1200,
          playback: 'loop',
          tracks: [{
            id: 'track_hero_opacity',
            targetShapeId: hero.id,
            property: 'opacity',
            operation: 'set',
            baseValue: 1,
            delayMs: 100,
            durationMs: 800,
            keyframes: Array.from({ length: 4 }, (_, index) => ({
              id: `kf_${index}`,
              timeMs: index * 200,
              value: index / 3,
              easing: { type: 'linear' as const }
            }))
          }]
        }
      }
    }

    expect(buildCanvasMotionSummary(document, { maxKeyframesPerTrack: 2 })).toEqual({
      version: 1,
      timelineCount: 1,
      trackCount: 1,
      keyframeCount: 4,
      timelines: [{
        id: 'timeline_home',
        frameId: 'frame_home',
        frameName: 'Home',
        durationMs: 1200,
        playback: 'loop',
        trackCount: 1,
        keyframeCount: 4,
        tracks: [{
          id: 'track_hero_opacity',
          targetShapeId: 'hero',
          targetName: 'Hero card',
          property: 'opacity',
          operation: 'set',
          baseValue: 1,
          delayMs: 100,
          durationMs: 800,
          keyframeCount: 4,
          keyframes: [
            { id: 'kf_0', timeMs: 0, value: 0, easing: { type: 'linear' } },
            { id: 'kf_1', timeMs: 200, value: 0.333, easing: { type: 'linear' } }
          ],
          omittedKeyframes: 2
        }]
      }],
      reducedMotion: {
        automaticPlayback: 'disabled-when-preferred',
        editing: 'available',
        scrubAndEndState: 'deterministic'
      }
    })
  })
})
