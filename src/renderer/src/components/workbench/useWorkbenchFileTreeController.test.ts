import { describe, expect, it } from 'vitest'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import {
  retainFilePreviewTargets,
  workspaceFileTargetKey
} from './useWorkbenchFileTreeController'

const targets: WorkspaceFileTarget[] = [
  { path: 'C:\\repo\\docs\\one.md', workspaceRoot: 'C:\\repo' },
  { path: 'D:\\other\\two.md', workspaceRoot: 'D:\\other' }
]

describe('file preview tab lifecycle', () => {
  it('uses a workspace-scoped, separator-independent target key', () => {
    expect(workspaceFileTargetKey(targets[0])).toBe('c:/repo\nc:/repo/docs/one.md')
  })

  it('keeps all tabs when cross-thread preservation is enabled', () => {
    expect(retainFilePreviewTargets(targets, new Set(), true)).toEqual(targets)
  })

  it('keeps only pinned tabs when switching threads in the default mode', () => {
    const pinned = new Set([workspaceFileTargetKey(targets[1])])
    expect(retainFilePreviewTargets(targets, pinned, false)).toEqual([targets[1]])
  })
})
