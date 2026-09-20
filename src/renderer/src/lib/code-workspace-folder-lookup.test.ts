import { describe, expect, it } from 'vitest'
import { extraRootsForWorkspace, folderSetPrimaryForWorkspace } from './code-workspace-folder-lookup'

describe('code workspace folder lookup', () => {
  it('resolves extras from the project primary, not a worktree path', () => {
    const projectPath = '/Users/zxy/code/app'
    const worktreePath = '/Users/zxy/.kun/worktrees/ab12/app'
    const registry = {
      version: 1 as const,
      sets: [{ primary: projectPath, extraRoots: ['/Users/zxy/code/api'] }]
    }
    const worktrees = {
      thr_1: { projectPath, worktreePath, branch: 'feat' }
    }
    expect(folderSetPrimaryForWorkspace(worktreePath, worktrees)).toBe(projectPath)
    expect(extraRootsForWorkspace(worktreePath, registry, worktrees)).toEqual(['/Users/zxy/code/api'])
    expect(extraRootsForWorkspace('/Users/zxy/code/other', registry)).toEqual([])
  })
})
