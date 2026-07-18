import { describe, expect, it } from 'vitest'
import {
  applyTimelineOperations,
  assertValidTimeline,
  removeAssetTimeRanges
} from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

describe('timeline operations', () => {
  it('splits and trims without changing the source project', () => {
    const source = makeProject()
    const split = applyTimelineOperations(source, [
      { type: 'split-item', itemId: 'item-1', atFrame: 30 }
    ])
    expect(source.items.map(({ id }) => id)).toEqual(['item-1', 'item-2'])
    expect(split.project.items.slice(0, 2).map(({ id }) => id)).toEqual([
      'item-1-part-1',
      'item-1-part-2'
    ])
    expect(split.project.items[0]).toMatchObject({ durationFrames: 30, sourceEndUs: 1_000_000 })
    expect(split.project.items[1]).toMatchObject({
      timelineStartFrame: 30,
      durationFrames: 60,
      sourceStartUs: 1_000_000
    })

    const trimmed = applyTimelineOperations(source, [
      { type: 'trim-item', itemId: 'item-1', startFrame: 15, endFrame: 75 }
    ])
    expect(trimmed.project.items[0]).toMatchObject({
      timelineStartFrame: 15,
      durationFrames: 60,
      sourceStartUs: 500_000,
      sourceEndUs: 2_500_000
    })
  })

  it('applies add, delete, move, reorder, transform, caption, and canvas operations', () => {
    const project = makeProject()
    const added = makeItem('item-3', 180, 6_000_000, 7_000_000)
    const result = applyTimelineOperations(project, [
      { type: 'add-item', item: added },
      { type: 'move-item', itemId: 'item-3', trackId: 'video-2', timelineStartFrame: 30 },
      {
        type: 'update-transform',
        itemId: 'item-3',
        transform: { x: 24, scaleX: 0.5 },
        opacity: 0.8
      },
      {
        type: 'add-caption',
        caption: {
          id: 'caption-2',
          trackId: 'captions-1',
          startFrame: 45,
          endFrame: 60,
          text: 'Second',
          placement: 'top'
        }
      },
      { type: 'update-caption', captionId: 'caption-2', patch: { text: 'Updated' } },
      { type: 'set-canvas', preset: '9:16', fit: 'crop' },
      { type: 'delete-caption', captionId: 'caption-1' }
    ])
    expect(result.project.items.find(({ id }) => id === 'item-3')).toMatchObject({
      trackId: 'video-2',
      timelineStartFrame: 30,
      opacity: 0.8,
      transform: { x: 24, scaleX: 0.5 }
    })
    expect(result.project.captions).toHaveLength(1)
    expect(result.project.captions[0]!.text).toBe('Updated')
    expect(result.project.canvas).toMatchObject({ preset: '9:16', width: 1080, height: 1920, fit: 'crop' })
    expect(result.inverseOperations.length).toBeGreaterThan(0)
    expect(() => assertValidTimeline(result.project)).not.toThrow()
  })

  it('reorders a reject-overlap track and rejects invalid placement transactionally', () => {
    const project = makeProject()
    const reordered = applyTimelineOperations(project, [
      { type: 'reorder-item', itemId: 'item-2', beforeItemId: 'item-1' }
    ])
    expect(reordered.project.items.map(({ id }) => id)).toEqual(['item-2', 'item-1'])
    expect(reordered.project.items.map(({ timelineStartFrame }) => timelineStartFrame).sort((a, b) => a - b)).toEqual([0, 90])

    expect(() => applyTimelineOperations(project, [
      { type: 'move-item', itemId: 'item-2', trackId: 'video-1', timelineStartFrame: 30 }
    ])).toThrowError(/overlap/u)
    expect(project.items[1]!.timelineStartFrame).toBe(90)
  })

  it('removes timed transcript ranges, splits items, and ripples later media', () => {
    const project = makeProject()
    const result = removeAssetTimeRanges(project, [{
      assetId: 'asset-1',
      startUs: 1_000_000,
      endUs: 2_000_000,
      reason: 'filler'
    }])
    expect(result.removed).toEqual([{
      assetId: 'asset-1',
      startUs: 1_000_000,
      endUs: 2_000_000,
      reason: 'filler'
    }])
    expect(result.project.items).toMatchObject([
      { sourceStartUs: 0, sourceEndUs: 1_000_000, timelineStartFrame: 0, durationFrames: 30 },
      { sourceStartUs: 2_000_000, sourceEndUs: 3_000_000, timelineStartFrame: 30, durationFrames: 30 },
      { sourceStartUs: 3_000_000, sourceEndUs: 6_000_000, timelineStartFrame: 60, durationFrames: 90 }
    ])
    expect(project.items).toHaveLength(2)
  })
})
