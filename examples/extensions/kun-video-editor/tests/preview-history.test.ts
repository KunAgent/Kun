import { describe, expect, it } from 'vitest'
import {
  PREVIEW_HISTORY_LIMITS,
  VideoEngineError,
  appendPreviewHistory,
  applyTimelineOperations,
  buildVideoSelectionAttachment,
  comparePreviewHistory,
  emptyPreviewHistory,
  planReplaceTimelineItemFromPreview,
  selectPreviewHistory,
  validateHistory,
  type PreviewHistoryEntry
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('preview sources, history, compare, replace, and public context', () => {
  it('keeps deterministic bounded history and selects entries by stable ID', () => {
    let history = emptyPreviewHistory()
    for (let index = 0; index < PREVIEW_HISTORY_LIMITS.entries + 5; index += 1) {
      history = appendPreviewHistory(history, timelineEntry(index))
    }

    expect(history.entries).toHaveLength(PREVIEW_HISTORY_LIMITS.entries)
    expect(history.entries[0]?.id).toBe('preview-5')
    expect(history.activeEntryId).toBe('preview-44')
    expect(history.generation).toBe(45)
    expect(selectPreviewHistory(history, 'preview-6')).toMatchObject({
      activeEntryId: 'preview-6', generation: 46
    })
    expect(() => validateHistory({ ...history, entries: [...history.entries, history.entries[0]!] })).toThrow(
      VideoEngineError
    )
  })

  it('compares two timeline proofs without losing revision identity', () => {
    let history = appendPreviewHistory(emptyPreviewHistory(), timelineEntry(1))
    history = appendPreviewHistory(history, timelineEntry(2))
    const comparison = comparePreviewHistory(history, 'preview-1', 'preview-2', 'wipe')

    expect(comparison).toMatchObject({ mode: 'wipe', sameRevision: false })
    expect(comparison.left.source).toMatchObject({ kind: 'timeline', revision: 1 })
    expect(comparison.right.source).toMatchObject({ kind: 'timeline', revision: 2 })
    expect(() => comparePreviewHistory(history, 'preview-1', 'preview-1', 'side-by-side')).toThrow(
      VideoEngineError
    )
  })

  it('replaces a selected clip from an asset preview while preserving timeline duration', () => {
    const source = makeProject()
    const operations = planReplaceTimelineItemFromPreview(source, {
      itemId: 'item-1',
      preview: { kind: 'asset', assetId: 'asset-1', startUs: 1_000_000, endUs: 2_000_000 }
    })
    const project = applyTimelineOperations(source, operations).project
    const replaced = project.items.find(({ id }) => id === 'item-1')!

    expect(operations.map(({ type }) => type)).toEqual(['delete-item', 'add-item'])
    expect(replaced).toMatchObject({
      timelineStartFrame: 0,
      durationFrames: 90,
      sourceStartUs: 1_000_000,
      sourceEndUs: 2_000_000,
      speed: { numerator: 1, denominator: 3 }
    })
  })

  it('builds a bounded revision-bound selection attachment without source paths', () => {
    const project = makeProject()
    project.selection = {
      ...project.selection,
      generation: 7,
      playheadFrame: 42,
      selectedAssetIds: ['asset-1'],
      selectedItemIds: ['item-1'],
      selectedCaptionIds: ['caption-1'],
      selectedWordIds: ['word-1'],
      range: { startFrame: 30, endFrame: 60 }
    }
    const attachment = buildVideoSelectionAttachment(project, ['preview-1'])

    expect(attachment).toMatchObject({
      schemaVersion: 1,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision,
      selectionGeneration: 7,
      playheadFrame: 42,
      selectedItemIds: ['item-1'],
      range: { startFrame: 30, endFrame: 60 },
      previewEntryIds: ['preview-1']
    })
    expect(JSON.stringify(attachment)).not.toMatch(/workspaceRelativePath|mediaHandleId|\/Users\//u)
    expect(() => buildVideoSelectionAttachment(project, Array.from(
      { length: PREVIEW_HISTORY_LIMITS.selectedIds + 1 },
      (_, index) => `preview-${index}`
    ))).toThrow(VideoEngineError)
  })
})

function timelineEntry(index: number): PreviewHistoryEntry {
  return {
    id: `preview-${index}`,
    projectId: 'demo-project',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    label: `Revision ${index}`,
    source: {
      kind: 'timeline',
      sequenceId: 'sequence-main',
      revision: index,
      startFrame: 0,
      endFrame: 90,
      artifactId: `proof-${index}`
    }
  }
}
