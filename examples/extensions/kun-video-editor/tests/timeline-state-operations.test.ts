import { describe, expect, it } from 'vitest'
import { applyTimelineOperations } from '../src/engine/timeline.js'
import { makeProject } from './fixtures.js'

describe('timeline state and link operations', () => {
  it('updates track/item state with exact inverse operations', () => {
    const project = makeProject()
    const applied = applyTimelineOperations(project, [
      {
        type: 'update-track-state',
        trackId: 'video-1',
        muted: true,
        locked: false,
        syncLocked: true
      },
      {
        type: 'update-item-properties',
        itemId: 'item-1',
        volume: 0.65,
        fadeInFrames: 8,
        fadeOutFrames: 7,
        muted: true,
        visible: false,
        locked: true
      }
    ])

    expect(applied.project.tracks[0]).toMatchObject({ muted: true, locked: false, syncLocked: true })
    expect(applied.project.items[0]).toMatchObject({
      volume: 0.65,
      fadeInFrames: 8,
      fadeOutFrames: 7,
      muted: true,
      visible: false,
      locked: true
    })
    const restored = applyTimelineOperations(applied.project, applied.inverseOperations).project
    expect(restored.tracks[0]).toMatchObject({ muted: false, locked: false, syncLocked: false })
    expect(restored.items[0]).toMatchObject({
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      muted: false,
      visible: true,
      locked: false
    })
  })

  it('creates and deletes an A/V link group atomically', () => {
    const project = makeProject()
    const audio = { ...project.items[0]!, id: 'audio-clip', trackId: 'audio-1' }
    project.items.push(audio)
    project.sequences[0]!.items = structuredClone(project.items)

    const linked = applyTimelineOperations(project, [{
      type: 'set-link-group',
      group: { id: 'av-main', kind: 'av', itemIds: ['item-1', 'audio-clip'], locked: true }
    }])
    expect(linked.project.linkGroups).toEqual([{
      id: 'av-main', kind: 'av', itemIds: ['item-1', 'audio-clip'], locked: true
    }])
    expect(linked.project.items.filter(({ id }) => id === 'item-1' || id === 'audio-clip'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'item-1', linkGroupId: 'av-main' }),
        expect.objectContaining({ id: 'audio-clip', linkGroupId: 'av-main' })
      ]))

    const unlinked = applyTimelineOperations(linked.project, [{
      type: 'delete-link-group',
      linkGroupId: 'av-main'
    }])
    expect(unlinked.project.linkGroups).toEqual([])
    expect(unlinked.project.items.some(({ linkGroupId }) => linkGroupId === 'av-main')).toBe(false)
    const restored = applyTimelineOperations(unlinked.project, unlinked.inverseOperations).project
    expect(restored.linkGroups[0]?.id).toBe('av-main')
  })

  it('enforces item and track locks without partially applying a batch', () => {
    const itemLocked = applyTimelineOperations(makeProject(), [{
      type: 'update-item-properties', itemId: 'item-1', locked: true
    }]).project
    expect(() => applyTimelineOperations(itemLocked, [{
      type: 'move-item', itemId: 'item-1', trackId: 'video-1', timelineStartFrame: 10
    }])).toThrow(/item is locked/)
    expect(itemLocked.items[0]!.timelineStartFrame).toBe(0)

    const trackLocked = applyTimelineOperations(makeProject(), [{
      type: 'update-track-state', trackId: 'video-1', locked: true
    }]).project
    expect(() => applyTimelineOperations(trackLocked, [{
      type: 'trim-item', itemId: 'item-1', startFrame: 0, endFrame: 60
    }])).toThrow(/track is locked/)
    expect(trackLocked.items[0]!.durationFrames).toBe(90)
  })
})
