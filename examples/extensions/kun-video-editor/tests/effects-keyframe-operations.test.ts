import { describe, expect, it } from 'vitest'
import {
  VideoEngineError,
  applyTimelineOperations,
  boundedEffectCatalog,
  buildMutationReceipt,
  compileRenderIr,
  negotiateRenderIr,
  planRemoveEffect,
  planUpsertEffect,
  planUpsertKeyframeTrack,
  sampleTimelineItem,
  type KeyframeTrack,
  type RenderBackendCapabilities
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

const opacityTrack: KeyframeTrack = {
  id: 'keyframes-opacity',
  property: 'opacity',
  interpolation: 'linear',
  points: [
    { id: 'opacity-0', frame: 0, value: 0 },
    { id: 'opacity-30', frame: 30, value: 1 },
    { id: 'opacity-90', frame: 90, value: 0 }
  ]
}

describe('bounded effects and keyframe operations', () => {
  it('publishes a bounded catalog and deterministically samples composition and effect parameters', () => {
    const project = makeProject()
    const item = project.items[0]!
    const effectOperation = planUpsertEffect(item, {
      id: 'look',
      type: 'color.basic',
      enabled: true,
      parameters: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 }
    })
    const withEffect = { ...item, effects: effectOperation.effects }
    const keyframes = [
      planUpsertKeyframeTrack(withEffect, {
        id: 'keyframes-x', property: 'transform.x', interpolation: 'linear',
        points: [{ id: 'x0', frame: 0, value: 0 }, { id: 'x90', frame: 90, value: 180 }]
      }).keyframes,
      planUpsertKeyframeTrack(withEffect, {
        id: 'keyframes-crop', property: 'crop.left', interpolation: 'linear',
        points: [{ id: 'crop0', frame: 0, value: 0 }, { id: 'crop90', frame: 90, value: 0.2 }]
      }).keyframes,
      planUpsertKeyframeTrack(withEffect, {
        id: 'keyframes-volume', property: 'volume', interpolation: 'linear',
        points: [{ id: 'volume0', frame: 0, value: 0 }, { id: 'volume90', frame: 90, value: 2 }]
      }).keyframes,
      planUpsertKeyframeTrack(withEffect, {
        id: 'keyframes-brightness', property: 'effect.look.brightness', interpolation: 'linear',
        points: [{ id: 'brightness0', frame: 0, value: -1 }, { id: 'brightness90', frame: 90, value: 1 }]
      }).keyframes
    ].reduce((combined, value) => {
      const byId = new Map([...combined, ...value].map((track) => [track.id, track]))
      return [...byId.values()]
    }, [] as KeyframeTrack[])
    const sampled = sampleTimelineItem({ ...withEffect, keyframes }, 45)

    expect(boundedEffectCatalog()).toMatchObject({
      schemaVersion: 1,
      blendModes: expect.arrayContaining([{ id: 'multiply', labelKey: 'video.blend.multiply' }]),
      textAnimations: expect.arrayContaining([
        expect.objectContaining({ id: 'word-highlight', maximumDurationFrames: 300 })
      ])
    })
    expect(sampled.transform.x).toBe(90)
    expect(sampled.crop.left).toBeCloseTo(0.1)
    expect(sampled.volume).toBe(1)
    expect(sampled.effects[0]?.parameters.brightness).toBe(0)
    expect(() => planUpsertEffect(item, {
      id: 'bad', type: 'blur', enabled: true, parameters: { radius: 101 }
    })).toThrow(VideoEngineError)
  })

  it('applies effect/keyframe operations atomically and refuses orphaned effect keyframes', () => {
    const source = makeProject()
    const effect = planUpsertEffect(source.items[0]!, {
      id: 'look',
      type: 'color.basic',
      enabled: true,
      parameters: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 }
    })
    const withEffect = applyTimelineOperations(source, [effect]).project
    const keyed = applyTimelineOperations(withEffect, [
      planUpsertKeyframeTrack(withEffect.items[0]!, {
        id: 'brightness',
        property: 'effect.look.brightness',
        interpolation: 'ease',
        points: [{ id: 'b0', frame: 0, value: -0.5 }, { id: 'b90', frame: 90, value: 0.5 }]
      })
    ]).project

    expect(keyed.items[0]?.effects?.[0]?.id).toBe('look')
    expect(keyed.items[0]?.keyframes?.[0]?.property).toBe('effect.look.brightness')
    expect(() => planRemoveEffect(keyed.items[0]!, 'look')).toThrow(/keyframes/u)
    expect(() => applyTimelineOperations(keyed, [{
      type: 'set-item-effects', itemId: 'item-1', effects: []
    }])).toThrow(VideoEngineError)
    expect(() => applyTimelineOperations(withEffect, [{
      type: 'set-item-keyframes',
      itemId: 'item-1',
      keyframes: [{ ...opacityTrack, points: [{ id: 'late', frame: 91, value: 1 }] }]
    }])).toThrow(VideoEngineError)
  })

  it('uses declared boundary and remapping policies for trim, split, and retime', () => {
    const source = makeProject()
    const keyed = applyTimelineOperations(source, [{
      type: 'set-item-keyframes', itemId: 'item-1', keyframes: [opacityTrack]
    }]).project

    const trimResult = applyTimelineOperations(keyed, [{
      type: 'trim-item', itemId: 'item-1', startFrame: 15, endFrame: 75
    }])
    const trimmed = trimResult.project.items[0]!
    expect(trimmed.keyframes?.[0]?.points).toEqual([
      { id: 'keyframes-opacity~start', frame: 0, value: 0.5 },
      { id: 'opacity-30', frame: 15, value: 1 },
      { id: 'keyframes-opacity~end', frame: 60, value: 0.25 }
    ])
    expect(trimResult.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'keyframe_dropped-before', values: expect.objectContaining({ count: 1 }) }),
      expect.objectContaining({ code: 'keyframe_synthesized-start' }),
      expect.objectContaining({ code: 'keyframe_synthesized-end' })
    ]))
    const committed = {
      ...trimResult.project,
      currentRevision: 1,
      eventGeneration: 1
    }
    const receipt = buildMutationReceipt(
      keyed,
      committed,
      'transaction-keyframes',
      { author: 'manual', sourceOperation: 'timeline.trim', summary: 'Trimmed keyframes' },
      trimResult.notes
    )
    expect(receipt.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'keyframe_dropped-before', severity: 'warning' }),
      expect.objectContaining({ code: 'keyframe_synthesized-start', severity: 'info' })
    ]))

    const split = applyTimelineOperations(keyed, [{
      type: 'split-item', itemId: 'item-1', atFrame: 30
    }]).project.items.filter(({ id }) => id.startsWith('item-1-part'))
    expect(split[0]?.keyframes?.[0]?.points.map(({ frame, value }) => [frame, value])).toEqual([[0, 0], [30, 1]])
    expect(split[1]?.keyframes?.[0]?.points.map(({ frame, value }) => [frame, value])).toEqual([[0, 1], [60, 0]])

    const retimed = applyTimelineOperations(keyed, [{
      type: 'retime-item', itemId: 'item-1', speed: { numerator: 2, denominator: 1 }
    }]).project.items[0]!
    expect(retimed.durationFrames).toBe(45)
    expect(retimed.keyframes?.[0]?.points.map(({ frame }) => frame)).toEqual([0, 15, 45])
  })

  it('carries blend/effect/keyframe nodes into IR and reports a missing blend capability', () => {
    const source = makeProject()
    const effect = planUpsertEffect(source.items[0]!, {
      id: 'look',
      type: 'color.basic',
      enabled: true,
      parameters: { brightness: 0.2, contrast: 1, saturation: 1, gamma: 1 }
    })
    const project = applyTimelineOperations(source, [
      effect,
      { type: 'set-item-keyframes', itemId: 'item-1', keyframes: [opacityTrack] },
      { type: 'update-item-composition', itemId: 'item-1', blendMode: 'multiply', opacity: 0.8 }
    ]).project
    const ir = compileRenderIr(project)
    const report = negotiateRenderIr(ir, capabilities(), 'h264-mp4')

    expect(ir.layers[0]).toMatchObject({
      visual: { blendMode: 'multiply', opacity: 0.8 },
      effects: [{ id: 'look', type: 'color.basic' }],
      keyframes: [{ id: 'keyframes-opacity', property: 'opacity' }]
    })
    expect(report.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'item-1', capability: 'filter:blend:multiply' })
    ]))
  })
})

function capabilities(): RenderBackendCapabilities {
  return {
    id: 'test-ffmpeg',
    version: '1',
    codecs: ['h264'],
    filters: ['overlay', 'color-source', 'scale', 'pad', 'keyframes'],
    effects: ['color.basic'],
    colorSpaces: ['bt709'],
    fonts: ['sans-serif'],
    maxSources: 100,
    maxLayers: 500,
    maxTextLayers: 500,
    hardwareAcceleration: 'none'
  }
}
