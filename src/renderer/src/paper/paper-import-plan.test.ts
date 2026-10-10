import { describe, expect, it } from 'vitest'
import {
  childFolder,
  childFolderNames,
  importGroupLabels,
  planPaperImport,
  plannedFolderRows,
  plannedImportCount,
  proposedImportFolder,
  sanitizeFolderSegment,
  suggestTopicFolder,
  type ImportCandidate
} from './paper-import-plan'

function candidate(key: string, extra: Partial<ImportCandidate> = {}): ImportCandidate {
  return { key, keys: [key], title: `Paper ${key}`, input: `1706.${key}`, ...extra }
}

describe('paper import planning', () => {
  it('sanitizes names without producing hidden or reserved segments', () => {
    expect(sanitizeFolderSegment('  a/b:c  ')).toBe('a b c')
    expect(sanitizeFolderSegment('.hidden')).toBe('hidden')
    expect(sanitizeFolderSegment('x'.repeat(80))).toHaveLength(40)
  })

  it('keeps group subfolders inside the three-level limit', () => {
    expect(childFolder('', '问题定位')).toBe('问题定位')
    expect(childFolder('topic', 'a')).toBe('topic/a')
    expect(childFolder('a/b/c', 'deep')).toBe('a/b/c')
    expect(childFolder('topic', '   ')).toBe('topic')
  })

  it('suggests a topic folder that avoids existing folders', () => {
    expect(suggestTopicFolder('Fast context\nsecond line', [])).toBe('Fast context')
    expect(suggestTopicFolder('Fast context', ['fast context'])).toBe('Fast context 2')
    expect(suggestTopicFolder('///', [])).toBe('')
  })

  it('splits candidates into one batch per group folder', () => {
    const items = [
      candidate('1', { group: 'A' }),
      candidate('2', { group: 'B' }),
      candidate('3', { group: 'A' }),
      candidate('4')
    ]
    const plan = planPaperImport(items, { folder: 'topic', byGroup: true, owned: 'keep' })
    expect(plan.batches.map((batch) => [batch.folder, batch.items.map((item) => item.key)])).toEqual([
      ['topic/A', ['1', '3']],
      ['topic/B', ['2']],
      ['topic', ['4']]
    ])
    expect(plannedImportCount(plan)).toBe(4)
    expect(importGroupLabels(items)).toEqual(['A', 'B'])
  })

  it('files everything in one folder when grouping is off', () => {
    const plan = planPaperImport([candidate('1', { group: 'A' }), candidate('2')], {
      folder: 'topic',
      byGroup: false,
      owned: 'keep'
    })
    expect(plan.batches).toEqual([{ folder: 'topic', items: expect.any(Array) }])
    expect(plan.batches[0]!.items).toHaveLength(2)
  })

  it('keeps or moves papers that are already in the library', () => {
    const owned = candidate('9', { owned: { unitDir: 'papers/x', group: '' }, group: 'A' })
    const keep = planPaperImport([owned], { folder: 'topic', byGroup: true, owned: 'keep' })
    expect(keep.kept).toHaveLength(1)
    expect(keep.moves).toHaveLength(0)
    const move = planPaperImport([owned], { folder: 'topic', byGroup: true, owned: 'move' })
    expect(move.moves).toEqual([{ candidate: owned, folder: 'topic/A' }])
    const already = candidate('8', { owned: { unitDir: 'papers/topic/A/y', group: 'topic/A' }, group: 'A' })
    expect(planPaperImport([already], { folder: 'topic', byGroup: true, owned: 'move' }).kept).toHaveLength(1)
  })

  it('reports candidates without an import handle', () => {
    const plan = planPaperImport([candidate('1', { input: '' })], { folder: '', byGroup: false, owned: 'keep' })
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.batches).toHaveLength(0)
  })

  it('previews the folder tree with parent counts', () => {
    const plan = planPaperImport(
      [candidate('1', { group: 'A' }), candidate('2', { group: 'B' }), candidate('3', { group: 'A' })],
      { folder: 'topic', byGroup: true, owned: 'keep' }
    )
    expect(plannedFolderRows(plan, 'topic')).toEqual([
      { folder: 'topic', count: 3 },
      { folder: 'topic/A', count: 2 },
      { folder: 'topic/B', count: 1 }
    ])
  })

  it('lists the folders directly inside a parent, ancestors included', () => {
    const groups = ['qa/round1', 'nlp', 'qa/round2/x']
    expect(childFolderNames(groups, '')).toEqual(['nlp', 'qa'])
    expect(childFolderNames(groups, 'qa')).toEqual(['round1', 'round2'])
    expect(childFolderNames(groups, 'nlp')).toEqual([])
  })

  it('proposes the remembered folder, with a topic subfolder when asked', () => {
    const groups = ['qa/round1', 'agents']
    expect(proposedImportFolder({ parent: 'qa', topicFolder: true }, 'tool use', groups)).toBe('qa/tool use')
    expect(proposedImportFolder({ parent: 'qa', topicFolder: false }, 'tool use', groups)).toBe('qa')
    // A folder that no longer exists falls back to the papers dir.
    expect(proposedImportFolder({ parent: 'gone', topicFolder: false }, 'tool use', groups)).toBe('')
    // The topic name avoids a sibling that already exists.
    expect(proposedImportFolder({ parent: 'qa', topicFolder: true }, 'round1', groups)).toBe('qa/round1 2')
    expect(proposedImportFolder({ parent: '', topicFolder: true }, '  ', groups)).toBe('')
  })
})
