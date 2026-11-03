import { describe, expect, it } from 'vitest'
import { workspaceFileTargetKey } from '../../lib/workspace-file-target-key'
import { keepFilePreviewTargets } from './file-preview-close-scope'

const targets = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({ path, workspaceRoot: '/repo' }))
const paths = (items: { path: string }[]): string[] => items.map((item) => item.path)

describe('keepFilePreviewTargets', () => {
  it('keeps the anchor, the tabs to its left, or nothing, plus pinned tabs', () => {
    const pinned = new Set([workspaceFileTargetKey(targets[3])])
    expect(paths(keepFilePreviewTargets(targets, targets[1], pinned, 'others'))).toEqual(['b.ts', 'd.ts'])
    expect(paths(keepFilePreviewTargets(targets, targets[1], pinned, 'right'))).toEqual(['a.ts', 'b.ts', 'd.ts'])
    expect(paths(keepFilePreviewTargets(targets, targets[1], pinned, 'all'))).toEqual(['d.ts'])
  })

  it('closes nothing to the right of an unknown anchor', () => {
    expect(keepFilePreviewTargets(targets, { path: 'x.ts', workspaceRoot: '/repo' }, new Set(), 'right')).toEqual(targets)
  })
})
