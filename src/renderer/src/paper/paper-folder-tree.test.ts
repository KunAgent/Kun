import { describe, expect, it } from 'vitest'

import {
  ancestorFolders,
  buildFolderRows,
  expandFolderPaths,
  folderTotals,
  parentFolder
} from './paper-folder-tree'

describe('paper folder tree', () => {
  it('fills in missing ancestors and orders parents before children', () => {
    expect(expandFolderPaths(['qa/round1', 'agents', 'qa/round1/x', 'agents/rl'])).toEqual([
      'agents',
      'agents/rl',
      'qa',
      'qa/round1',
      'qa/round1/x'
    ])
    expect(ancestorFolders('a/b/c')).toEqual(['a', 'a/b'])
    expect(parentFolder('a/b')).toBe('a')
    expect(parentFolder('a')).toBe('')
  })

  it('counts every paper in its folder and in each ancestor', () => {
    const totals = folderTotals(['', 'qa/round1', 'qa/round1', 'qa'])
    expect(totals.get('qa/round1')).toBe(2)
    expect(totals.get('qa')).toBe(3)
    expect(totals.has('')).toBe(false)
  })

  it('shows a collapsed branch as one row and its children once expanded', () => {
    const input = { groups: ['qa/round1', 'nlp'], entryGroups: ['qa/round1', 'nlp'] }
    const collapsed = buildFolderRows({ ...input, expanded: new Set() })
    expect(collapsed.map((row) => [row.folder, row.depth, row.hasChildren, row.expanded])).toEqual([
      ['nlp', 0, false, false],
      ['qa', 0, true, false]
    ])
    const open = buildFolderRows({ ...input, expanded: new Set(['qa']) })
    expect(open.map((row) => [row.name, row.depth, row.total])).toEqual([
      ['nlp', 0, 1],
      ['qa', 0, 1],
      ['round1', 1, 1]
    ])
  })

  it('flattens to matching full paths while searching', () => {
    const rows = buildFolderRows({
      groups: ['qa/round1', 'nlp/round2', 'misc'],
      entryGroups: [],
      expanded: new Set(),
      query: ' ROUND'
    })
    expect(rows.map((row) => [row.folder, row.depth])).toEqual([
      ['nlp/round2', 0],
      ['qa/round1', 0]
    ])
  })
})
