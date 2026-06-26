import { describe, expect, it } from 'vitest'
import { buildWorkspaceProjectPickerOptions } from './WorkspaceProjectPicker'

describe('WorkspaceProjectPicker options', () => {
  it('groups remembered worktree roots under their source project', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktree38e2 = '/Users/zxy/.kun/worktrees/38e2/Kook-VoiceShop-Bot'
    const worktreePython = '/Users/zxy/.kun/worktrees/python/Kook-VoiceShop-Bot'
    const { currentRoot, options } = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: worktree38e2,
      workspaceRoots: [
        projectPath,
        worktree38e2,
        worktreePython,
        '/Users/zxy/code/DeepSeek-GUI',
        '~/.kun/write_workspace'
      ],
      threadWorktrees: {
        'thread-38e2': {
          projectPath,
          worktreePath: worktree38e2
        },
        'thread-python': {
          projectPath,
          worktreePath: worktreePython
        }
      }
    })

    expect(currentRoot).toBe(projectPath)
    expect(options.map((option) => option.root)).toEqual([
      '/Users/zxy/code/DeepSeek-GUI',
      projectPath
    ])
    expect(options.filter((option) => option.label === 'Kook-VoiceShop-Bot')).toHaveLength(1)
  })

  it('resolves worktree roots to their source project without a registry entry', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.kun/worktrees/ab12/Kook-VoiceShop-Bot'
    const { currentRoot, options } = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: worktreePath,
      workspaceRoots: [projectPath, worktreePath],
      threadWorktrees: {}
    })

    expect(currentRoot).toBe(projectPath)
    expect(options.map((option) => option.root)).toEqual([projectPath])
  })
})
