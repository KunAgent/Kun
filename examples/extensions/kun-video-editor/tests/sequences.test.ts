import { describe, expect, it } from 'vitest'
import {
  VideoEngineError,
  applyTimelineOperations,
  assertSequenceNestAllowed,
  compileRenderIr,
  flattenNestedRenderIr,
  generateRenderPlan,
  planDecomposeNestedSequence,
  planNestedSequenceItem,
  planOpenNestedSequence,
  propagateNestedSequenceDuration,
  sequenceDurationFrames
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('sequence editing domain', () => {
  it('creates, activates, renames, persists view state, closes, deletes, and restores a sequence safely', () => {
    const source = makeProject()
    const created = applyTimelineOperations(source, [{
      type: 'create-sequence',
      sequenceId: 'sequence-alt',
      name: 'Alternate cut',
      activate: true
    }]).project

    expect(created.activeSequenceId).toBe('sequence-alt')
    expect(created.items).toEqual([])
    expect(created.sequences.find(({ id }) => id === 'sequence-main')?.items).toEqual(source.items)

    const configured = applyTimelineOperations(created, [
      { type: 'rename-sequence', sequenceId: 'sequence-alt', name: 'Short social cut' },
      { type: 'set-sequence-view', sequenceId: 'sequence-alt', zoom: 2.5, scrollFrame: 120 },
      { type: 'close-sequence', sequenceId: 'sequence-alt', fallbackSequenceId: 'sequence-main' }
    ]).project
    expect(configured.activeSequenceId).toBe('sequence-main')
    expect(configured.sequences.find(({ id }) => id === 'sequence-alt')).toMatchObject({
      name: 'Short social cut',
      viewState: { zoom: 2.5, scrollFrame: 120, open: false }
    })

    const deletion = applyTimelineOperations(configured, [{
      type: 'delete-sequence', sequenceId: 'sequence-alt'
    }])
    expect(deletion.project.sequences.map(({ id }) => id)).toEqual(['sequence-main'])

    const restored = applyTimelineOperations(deletion.project, deletion.inverseOperations).project
    expect(restored.sequences.find(({ id }) => id === 'sequence-alt')).toEqual(
      configured.sequences.find(({ id }) => id === 'sequence-alt')
    )
    expect(() => applyTimelineOperations(restored, [{
      type: 'delete-sequence', sequenceId: 'sequence-main'
    }])).toThrow(VideoEngineError)
  })

  it('duplicates content with fresh mutable IDs without changing the original sequence', () => {
    const source = makeProject()
    source.linkGroups.push({
      id: 'link-main',
      kind: 'sync',
      itemIds: ['item-1', 'item-2'],
      locked: false
    })
    source.items.forEach((item) => { item.linkGroupId = 'link-main' })
    source.sequences[0]!.items = structuredClone(source.items)

    const next = applyTimelineOperations(source, [{
      type: 'duplicate-sequence',
      sourceSequenceId: 'sequence-main',
      sequenceId: 'sequence-copy',
      name: 'Copy',
      activate: true
    }]).project
    const original = next.sequences.find(({ id }) => id === 'sequence-main')!
    const copy = next.sequences.find(({ id }) => id === 'sequence-copy')!

    expect(original).toEqual(source.sequences[0])
    expect(copy.items).toHaveLength(original.items.length)
    expect(new Set(copy.items.map(({ id }) => id))).not.toEqual(new Set(original.items.map(({ id }) => id)))
    expect(copy.items.every(({ trackId }) => copy.tracks.some(({ id }) => id === trackId))).toBe(true)
    const copiedGroup = next.linkGroups.find(({ id }) => id !== 'link-main')!
    expect(copiedGroup.itemIds).toEqual(copy.items.map(({ id }) => id))
    expect(copy.items.every(({ linkGroupId }) => linkGroupId === copiedGroup.id)).toBe(true)
  })

  it('plans nested clips, rejects cycles, opens the child, and decomposes neutral nests', () => {
    const source = makeProject()
    const duplicated = applyTimelineOperations(source, [{
      type: 'duplicate-sequence',
      sourceSequenceId: 'sequence-main',
      sequenceId: 'sequence-child',
      name: 'Child',
      activate: false
    }]).project
    const child = duplicated.sequences.find(({ id }) => id === 'sequence-child')!
    const nested = planNestedSequenceItem(duplicated, {
      parentSequenceId: 'sequence-main',
      nestedSequenceId: child.id,
      itemId: 'item-nest',
      trackId: 'video-2',
      timelineStartFrame: 0
    })
    const withNest = applyTimelineOperations(duplicated, [{ type: 'add-item', item: nested }]).project

    expect(nested.durationFrames).toBe(sequenceDurationFrames(child))
    expect(planOpenNestedSequence(nested)).toEqual([
      { type: 'open-sequence', sequenceId: child.id },
      { type: 'select-sequence', sequenceId: child.id }
    ])
    expect(() => assertSequenceNestAllowed(withNest, child.id, 'sequence-main')).toThrow(/cycle/u)

    const trackMap = Object.fromEntries(child.tracks.map((track) => [
      track.id,
      track.kind === 'video' ? 'video-2' : track.kind === 'audio' ? 'audio-1' : 'captions-1'
    ]))
    const plan = planDecomposeNestedSequence(withNest, {
      parentSequenceId: 'sequence-main',
      itemId: nested.id,
      trackMap
    })
    expect(plan.operations[0]).toEqual({ type: 'delete-item', itemId: nested.id })
    expect(plan.items).toHaveLength(child.items.length)
    expect(plan.captions).toHaveLength(child.captions.length)
    expect(plan.items.every(({ nestedSequenceId }) => nestedSequenceId === undefined)).toBe(true)
  })

  it('rejects a nest that would exceed the bounded transitive depth', () => {
    const project = makeProject()
    project.sequences = Array.from({ length: 10 }, (_, index) => {
      const trackId = `depth-track-${index}`
      return {
        id: `depth-sequence-${index}`,
        name: `Depth ${index}`,
        tracks: [{ id: trackId, name: 'Video', kind: 'video' as const, order: 0, overlap: 'reject' as const }],
        items: index < 8 ? [{
          ...structuredClone(project.items[0]!),
          id: `depth-item-${index}`,
          assetId: `depth-sequence-${index + 1}`,
          nestedSequenceId: `depth-sequence-${index + 1}`,
          trackId
        }] : [],
        captions: [],
        viewState: { zoom: 1, scrollFrame: 0, open: true }
      }
    })

    expect(() => assertSequenceNestAllowed(
      project,
      'depth-sequence-8',
      'depth-sequence-9'
    )).toThrow(/depth exceeds 8/u)
  })

  it('propagates a child duration change to full-range nested clips', () => {
    const source = makeProject()
    const duplicated = applyTimelineOperations(source, [{
      type: 'duplicate-sequence',
      sourceSequenceId: 'sequence-main',
      sequenceId: 'sequence-child',
      name: 'Child',
      activate: false
    }]).project
    const child = duplicated.sequences.find(({ id }) => id === 'sequence-child')!
    const previousDuration = sequenceDurationFrames(child)
    const nested = planNestedSequenceItem(duplicated, {
      parentSequenceId: 'sequence-main',
      nestedSequenceId: child.id,
      itemId: 'item-nest',
      trackId: 'video-2',
      timelineStartFrame: 0
    })
    const withNest = applyTimelineOperations(duplicated, [{ type: 'add-item', item: nested }]).project
    const changedChild = withNest.sequences.find(({ id }) => id === child.id)!
    changedChild.items = changedChild.items.slice(0, 1)

    const propagated = propagateNestedSequenceDuration(withNest, child.id, previousDuration)
    const updated = propagated.project.items.find(({ id }) => id === nested.id)!
    expect(updated.durationFrames).toBe(90)
    expect(updated.sourceEndUs).toBe(3_000_000)
    expect(propagated.changedItemIds).toContain(nested.id)
    expect(propagated.changedSequenceIds).toContain('sequence-main')
  })

  it('automatically propagates nested duration changes through timeline transactions and inverses', () => {
    const source = makeProject()
    const duplicated = applyTimelineOperations(source, [{
      type: 'duplicate-sequence',
      sourceSequenceId: 'sequence-main',
      sequenceId: 'sequence-child',
      name: 'Child',
      activate: false
    }]).project
    const child = duplicated.sequences.find(({ id }) => id === 'sequence-child')!
    const nested = planNestedSequenceItem(duplicated, {
      parentSequenceId: 'sequence-main',
      nestedSequenceId: child.id,
      itemId: 'item-nest',
      trackId: 'video-2',
      timelineStartFrame: 0
    })
    const withNest = applyTimelineOperations(duplicated, [{ type: 'add-item', item: nested }]).project
    const childLastItem = [...child.items]
      .sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)
      .at(-1)!

    const shortened = applyTimelineOperations(withNest, [
      { type: 'select-sequence', sequenceId: child.id },
      { type: 'delete-item', itemId: childLastItem.id }
    ])
    const shortenedParent = shortened.project.sequences.find(({ id }) => id === 'sequence-main')!
    expect(shortenedParent.items.find(({ id }) => id === nested.id)).toMatchObject({
      durationFrames: 90,
      sourceStartUs: 0,
      sourceEndUs: 3_000_000
    })
    expect(shortened.changedIds).toEqual(expect.arrayContaining([
      child.id,
      childLastItem.id,
      nested.id,
      'sequence-main'
    ]))
    expect(shortened.notes).toContainEqual(expect.objectContaining({
      code: 'nested-duration-propagated',
      messageKey: 'video.receipt.nestedDurationPropagated',
      values: { itemCount: 1, sequenceCount: 2 }
    }))

    const restored = applyTimelineOperations(shortened.project, shortened.inverseOperations)
    const restoredParent = restored.project.sequences.find(({ id }) => id === 'sequence-main')!
    expect(restoredParent.items.find(({ id }) => id === nested.id)).toEqual(nested)
    expect(sequenceDurationFrames(
      restored.project.sequences.find(({ id }) => id === child.id)!
    )).toBe(sequenceDurationFrames(child))
  })

  it('propagates a grandchild duration change across every full-range parent nest', () => {
    const source = makeProject()
    const withSequences = applyTimelineOperations(source, [
      {
        type: 'duplicate-sequence', sourceSequenceId: 'sequence-main',
        sequenceId: 'sequence-child', name: 'Child', activate: false
      },
      {
        type: 'duplicate-sequence', sourceSequenceId: 'sequence-main',
        sequenceId: 'sequence-grandchild', name: 'Grandchild', activate: false
      }
    ]).project
    const childNest = planNestedSequenceItem(withSequences, {
      parentSequenceId: 'sequence-main', nestedSequenceId: 'sequence-child',
      itemId: 'item-child-nest', trackId: 'video-2', timelineStartFrame: 0
    })
    const childSelected = applyTimelineOperations(withSequences, [
      { type: 'add-item', item: childNest },
      { type: 'select-sequence', sequenceId: 'sequence-child' }
    ]).project
    const grandchildNest = planNestedSequenceItem(childSelected, {
      parentSequenceId: 'sequence-child', nestedSequenceId: 'sequence-grandchild',
      itemId: 'item-grandchild-nest', trackId: childSelected.tracks[1]!.id,
      timelineStartFrame: 180
    })
    const nested = applyTimelineOperations(childSelected, [{ type: 'add-item', item: grandchildNest }]).project
    const grandchild = nested.sequences.find(({ id }) => id === 'sequence-grandchild')!
    const lastItem = [...grandchild.items]
      .sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)
      .at(-1)!

    const shortened = applyTimelineOperations(nested, [
      { type: 'select-sequence', sequenceId: grandchild.id },
      { type: 'delete-item', itemId: lastItem.id }
    ])
    const child = shortened.project.sequences.find(({ id }) => id === 'sequence-child')!
    const main = shortened.project.sequences.find(({ id }) => id === 'sequence-main')!
    expect(child.items.find(({ id }) => id === grandchildNest.id)?.durationFrames).toBe(90)
    expect(main.items.find(({ id }) => id === childNest.id)?.durationFrames).toBe(270)
    expect(shortened.notes).toContainEqual(expect.objectContaining({
      code: 'nested-duration-propagated',
      values: { itemCount: 2, sequenceCount: 3 }
    }))
  })

  it('expands neutral nested video, audio, captions, and speed into executable FFmpeg input layers', () => {
    const source = makeProject()
    const duplicated = applyTimelineOperations(source, [{
      type: 'duplicate-sequence',
      sourceSequenceId: 'sequence-main',
      sequenceId: 'sequence-child',
      name: 'Child',
      activate: false
    }]).project
    const nested = planNestedSequenceItem(duplicated, {
      parentSequenceId: 'sequence-main',
      nestedSequenceId: 'sequence-child',
      itemId: 'item-nest',
      trackId: 'video-2',
      timelineStartFrame: 180,
      speed: { numerator: 2, denominator: 1 }
    })
    const project = applyTimelineOperations(duplicated, [{ type: 'add-item', item: nested }]).project
    const nestedIr = compileRenderIr(project)
    const flattened = flattenNestedRenderIr(project, nestedIr)

    expect(nestedIr.layers.find(({ id }) => id === nested.id)?.source).toEqual({
      kind: 'sequence', sequenceId: 'sequence-child'
    })
    expect(flattened.layers.every(({ source: layerSource }) => layerSource.kind === 'asset')).toBe(true)
    const expanded = flattened.layers.filter(({ id }) => id.startsWith('item-nest~'))
    expect(expanded.map(({ timeline }) => timeline)).toEqual([
      { startFrame: 180, endFrame: 225 },
      { startFrame: 225, endFrame: 270 }
    ])
    expect(expanded.every(({ sourceMap, audio }) =>
      sourceMap.speed.numerator === 2 && sourceMap.speed.denominator === 1 && audio.enabled
    )).toBe(true)
    expect(flattened.textLayers.some(({ id }) => id.startsWith('item-nest~'))).toBe(true)

    const render = generateRenderPlan(project, {
      kind: 'h264-mp4',
      expectedRevision: project.currentRevision,
      outputHandleId: 'output_video'
    })
    expect(render.renderIr.layers.every(({ source: layerSource }) => layerSource.kind === 'asset')).toBe(true)
    expect(render.steps[0]).toMatchObject({ kind: 'ffmpeg', id: 'h264-mp4' })

    const transformed = structuredClone(project)
    transformed.items.find(({ id }) => id === nested.id)!.transform.x = 20
    transformed.sequences.find(({ id }) => id === 'sequence-main')!.items = structuredClone(transformed.items)
    expect(() => flattenNestedRenderIr(transformed, compileRenderIr(transformed))).toThrow(/composed proxy/u)
  })
})
