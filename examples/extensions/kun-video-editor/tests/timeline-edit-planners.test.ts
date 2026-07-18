import { describe, expect, it } from 'vitest'
import {
  compileTimelineEditPlanOperations,
  planClipProperties,
  planLinkedMove,
  planLinkedTrim,
  planOverwrite,
  planRippleDelete,
  planRippleGapDelete,
  planRippleInsert,
  planRippleTrim
} from '../src/engine/timeline-edit-planners.js'
import { makeItem } from './fixtures.js'

describe('professional timeline edit planners', () => {
  const tracks = [
    { id: 'video-1', syncLocked: true, locked: false },
    { id: 'audio-1', syncLocked: true, locked: false },
    { id: 'video-2', syncLocked: false, locked: false }
  ]

  it('ripple-deletes across sync tracks, trims intersections, and compresses later shifts', () => {
    const items = [
      makeItem('video-span', 0, 0, 4_000_000, 'video-1'),
      makeItem('video-later', 150, 5_000_000, 7_000_000, 'video-1'),
      makeItem('audio-inside', 45, 1_500_000, 2_500_000, 'audio-1'),
      makeItem('audio-later-a', 150, 5_000_000, 6_000_000, 'audio-1'),
      makeItem('audio-later-b', 190, 6_000_000, 7_000_000, 'audio-1'),
      makeItem('unlocked', 150, 5_000_000, 6_000_000, 'video-2')
    ]
    const result = planRippleDelete({
      items,
      tracks,
      targetTrackId: 'video-1',
      startFrame: 30,
      endFrame: 90
    })

    expect(result.removedIds).toEqual(['audio-inside', 'video-span'])
    expect(result.createdIds).toEqual(['video-span~l', 'video-span~r'])
    expect(result.items.find(({ id }) => id === 'video-span~l')).toMatchObject({
      timelineStartFrame: 0,
      durationFrames: 30,
      sourceStartUs: 0,
      sourceEndUs: 1_000_000
    })
    expect(result.items.find(({ id }) => id === 'video-span~r')).toMatchObject({
      timelineStartFrame: 30,
      durationFrames: 30,
      sourceStartUs: 3_000_000,
      sourceEndUs: 4_000_000
    })
    expect(result.items.find(({ id }) => id === 'video-later')?.timelineStartFrame).toBe(90)
    expect(result.items.find(({ id }) => id === 'audio-later-a')?.timelineStartFrame).toBe(90)
    expect(result.items.find(({ id }) => id === 'unlocked')?.timelineStartFrame).toBe(150)
    expect(result.shifts).toEqual([
      { trackId: 'audio-1', fromFrame: 90, deltaFrames: -60, count: 2 },
      { trackId: 'video-1', fromFrame: 90, deltaFrames: -60, count: 1 }
    ])
  })

  it('ripple-inserts on target and sync tracks while preserving unlocked tracks', () => {
    const result = planRippleInsert({
      items: [
        makeItem('video', 90, 3_000_000, 4_000_000, 'video-1'),
        makeItem('audio', 90, 3_000_000, 4_000_000, 'audio-1'),
        makeItem('overlay', 90, 3_000_000, 4_000_000, 'video-2')
      ],
      tracks,
      targetTrackId: 'video-1',
      atFrame: 60,
      durationFrames: 30
    })

    expect(result.items.find(({ id }) => id === 'video')?.timelineStartFrame).toBe(120)
    expect(result.items.find(({ id }) => id === 'audio')?.timelineStartFrame).toBe(120)
    expect(result.items.find(({ id }) => id === 'overlay')?.timelineStartFrame).toBe(90)
  })

  it('overwrite splits a strict interior clip and preserves continuous source ranges', () => {
    const existing = makeItem('interview', 0, 0, 10_000_000, 'video-1')
    const inserted = makeItem('b-roll', 90, 0, 2_000_000, 'video-1')
    const result = planOverwrite({ items: [existing], insertedItem: inserted })

    expect(result.removedIds).toEqual(['interview'])
    expect(result.createdIds).toEqual(['b-roll', 'interview~l', 'interview~r'])
    expect(result.items.find(({ id }) => id === 'interview~l')).toMatchObject({
      timelineStartFrame: 0,
      durationFrames: 90,
      sourceStartUs: 0,
      sourceEndUs: 3_000_000
    })
    expect(result.items.find(({ id }) => id === 'interview~r')).toMatchObject({
      timelineStartFrame: 150,
      durationFrames: 150,
      sourceStartUs: 5_000_000,
      sourceEndUs: 10_000_000
    })
  })

  it('moves transitive linked A/V items and refuses a locked linked track atomically', () => {
    const items = [
      makeItem('video', 30, 1_000_000, 2_000_000, 'video-1'),
      makeItem('audio', 30, 1_000_000, 2_000_000, 'audio-1'),
      makeItem('mic', 30, 1_000_000, 2_000_000, 'audio-2')
    ]
    const linkGroups = [
      { id: 'av', kind: 'av' as const, itemIds: ['video', 'audio'], locked: true },
      { id: 'sync', kind: 'sync' as const, itemIds: ['audio', 'mic'], locked: true }
    ]
    const result = planLinkedMove({
      items,
      linkGroups,
      tracks: [
        { id: 'video-1', locked: false },
        { id: 'audio-1', locked: false },
        { id: 'audio-2', locked: false }
      ],
      itemId: 'video',
      deltaFrames: 15
    })
    expect(result.changedIds).toEqual(['audio', 'mic', 'video'])
    expect(result.items.every(({ timelineStartFrame }) => timelineStartFrame === 45)).toBe(true)

    expect(() => planLinkedMove({
      items,
      linkGroups,
      tracks: [
        { id: 'video-1', locked: false },
        { id: 'audio-1', locked: false },
        { id: 'audio-2', locked: true }
      ],
      itemId: 'video',
      deltaFrames: 15
    })).toThrow(/locked/)
    expect(items.map(({ timelineStartFrame }) => timelineStartFrame)).toEqual([30, 30, 30])
  })

  it('ripple-trims an outgoing edge and closes the same gap on sync-locked tracks', () => {
    const items = [
      makeItem('video-head', 0, 0, 3_000_000, 'video-1'),
      makeItem('video-tail', 90, 3_000_000, 4_000_000, 'video-1'),
      makeItem('audio-tail', 90, 3_000_000, 4_000_000, 'audio-1')
    ]
    const result = planRippleTrim({
      items,
      tracks,
      targetTrackId: 'video-1',
      itemId: 'video-head',
      endFrame: 60
    })

    expect(result.items.find(({ id }) => id === 'video-head')).toMatchObject({
      durationFrames: 60,
      sourceEndUs: 2_000_000
    })
    expect(result.items.find(({ id }) => id === 'video-tail')?.timelineStartFrame).toBe(60)
    expect(result.items.find(({ id }) => id === 'audio-tail')?.timelineStartFrame).toBe(60)
    expect(result.shifts).toEqual([
      { trackId: 'audio-1', fromFrame: 90, deltaFrames: -30, count: 1 },
      { trackId: 'video-1', fromFrame: 90, deltaFrames: -30, count: 1 }
    ])
  })

  it('deletes only a verified target gap and compiles the pure plan into bounded operations', () => {
    const items = [
      makeItem('before', 0, 0, 1_000_000, 'video-1'),
      makeItem('after', 60, 1_000_000, 2_000_000, 'video-1')
    ]
    const result = planRippleGapDelete({
      items,
      tracks,
      targetTrackId: 'video-1',
      startFrame: 30,
      endFrame: 60
    })
    expect(result.kind).toBe('ripple-gap-delete')
    expect(result.items.find(({ id }) => id === 'after')?.timelineStartFrame).toBe(30)
    expect(compileTimelineEditPlanOperations(items, result)).toEqual([
      { type: 'move-item', itemId: 'after', trackId: 'video-1', timelineStartFrame: 30 }
    ])
    expect(() => planRippleGapDelete({
      items,
      tracks,
      targetTrackId: 'video-1',
      startFrame: 15,
      endFrame: 60
    })).toThrow(/empty range/)
  })

  it('propagates trim deltas through a locked A/V group without mutating the input', () => {
    const items = [
      { ...makeItem('video', 30, 1_000_000, 3_000_000, 'video-1'), linkGroupId: 'av' },
      { ...makeItem('audio', 30, 1_000_000, 3_000_000, 'audio-1'), linkGroupId: 'av' }
    ]
    const result = planLinkedTrim({
      items,
      linkGroups: [{ id: 'av', kind: 'av', itemIds: ['video', 'audio'], locked: true }],
      tracks,
      itemId: 'video',
      startFrame: 45,
      endFrame: 75
    })
    expect(result.changedIds).toEqual(['audio', 'video'])
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'video', timelineStartFrame: 45, durationFrames: 30 }),
      expect.objectContaining({ id: 'audio', timelineStartFrame: 45, durationFrames: 30 })
    ]))
    expect(items.map(({ timelineStartFrame, durationFrames }) => ({ timelineStartFrame, durationFrames }))).toEqual([
      { timelineStartFrame: 30, durationFrames: 60 },
      { timelineStartFrame: 30, durationFrames: 60 }
    ])
  })

  it('rejects a plan whose compiled command would exceed the Host transaction bound', () => {
    const items = Array.from({ length: 201 }, (_, index) =>
      makeItem(`item-${index}`, index * 30, 0, 1_000_000, 'audio-1')
    )
    const plan = planRippleInsert({
      items,
      tracks,
      targetTrackId: 'audio-1',
      atFrame: 0,
      durationFrames: 1
    })
    expect(() => compileTimelineEditPlanOperations(items, plan)).toThrow(/bounded limit is 200/)
  })

  it('plans bounded volume, fades, and clip state as a typed property operation', () => {
    const items = [makeItem('clip', 0, 0, 3_000_000, 'audio-1')]
    const plan = planClipProperties({
      items,
      linkGroups: [],
      tracks,
      itemId: 'clip',
      patch: {
        volume: 0.75,
        fadeInFrames: 10,
        fadeOutFrames: 12,
        muted: true,
        visible: false,
        locked: true
      }
    })
    expect(plan.items[0]).toMatchObject({
      volume: 0.75,
      fadeInFrames: 10,
      fadeOutFrames: 12,
      muted: true,
      visible: false,
      locked: true
    })
    expect(compileTimelineEditPlanOperations(items, plan)).toEqual([{
      type: 'update-item-properties',
      itemId: 'clip',
      volume: 0.75,
      fadeInFrames: 10,
      fadeOutFrames: 12,
      muted: true,
      visible: false,
      locked: true
    }])
    expect(() => planClipProperties({
      items,
      linkGroups: [],
      tracks,
      itemId: 'clip',
      patch: { fadeInFrames: 50, fadeOutFrames: 50 }
    })).toThrow(/fades exceed/)
  })
})
