import { describe, expect, it } from 'vitest'
import { resolveProjectWorkspacePath } from './worktree-project-path'

describe('worktree-project-path', () => {
  it('maps a Kun worktree path back to a known project root', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.kun/worktrees/ab12/Kook-VoiceShop-Bot'
    expect(
      resolveProjectWorkspacePath(worktreePath, {
        candidateProjectPaths: [projectPath, worktreePath]
      })
    ).toBe(projectPath)
  })
})
