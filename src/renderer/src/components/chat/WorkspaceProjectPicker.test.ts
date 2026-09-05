import { describe, it, expect } from 'vitest'
import { buildWorkspaceProjectPickerOptions } from './WorkspaceProjectPicker'
import { filterRemovedCodeWorkspaceRoots } from '../../lib/removed-code-workspaces'

describe('buildWorkspaceProjectPickerOptions', () => {
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

  it('excludes conversation workspaces from project picker options', () => {
    // Conversation workspaces created via "New Conversation" should not appear
    // in the project picker dropdown
    const result = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/Documents/Kun/20260626-153012', // conversation workspace
        '/Users/zxy/project-b'
      ],
      conversationWorkspaceRoot: '/Users/zxy/Documents/Kun'
    })

    // Only regular project folders should be included
    expect(result.options.map((opt) => opt.root)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])

    // Current root should be the selected project
    expect(result.currentRoot).toBe('/Users/zxy/project-a')
  })

  it('includes regular project folders but excludes conversation workspaces', () => {
    const result = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: '/Users/zxy/Documents/Kun/20260627-091234', // conversation workspace as current
      workspaceRoots: [
        '/Users/zxy/project-x',
        '/Users/zxy/project-y',
        '/Users/zxy/Documents/Kun/20260626-153012' // another conversation workspace
      ],
      conversationWorkspaceRoot: '/Users/zxy/Documents/Kun'
    })

    // Even if current workspace is a conversation workspace, it should not
    // appear in the options list (but will be returned as currentRoot)
    const optionRoots = result.options.map((opt) => opt.root)
    expect(optionRoots).toContain('/Users/zxy/project-x')
    expect(optionRoots).toContain('/Users/zxy/project-y')
    expect(optionRoots).not.toContain('/Users/zxy/Documents/Kun/20260626-153012')

    // Current root should still be returned even if it's a conversation workspace
    expect(result.currentRoot).toBe('/Users/zxy/Documents/Kun/20260627-091234')
  })

  it('handles empty workspace roots gracefully', () => {
    const result = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: '',
      workspaceRoots: [],
      conversationWorkspaceRoot: '/Users/zxy/Documents/Kun'
    })

    expect(result.currentRoot).toBe('')
    expect(result.options).toEqual([])
  })

  it('deduplicates workspace roots by identity key', () => {
    const result = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a', // duplicate
        '/Users/zxy/project-a/', // duplicate with trailing slash
        '/Users/zxy/project-b'
      ],
      conversationWorkspaceRoot: '/Users/zxy/Documents/Kun'
    })

    // Should only have unique entries
    const optionRoots = result.options.map((opt) => opt.root)
    expect(optionRoots.filter((r) => r === '/Users/zxy/project-a')).toHaveLength(1)
    expect(optionRoots).toContain('/Users/zxy/project-b')
  })

  it('hides removed projects from candidates until they are re-added', () => {
    const projectA = '/Users/zxy/project-a'
    const projectB = '/Users/zxy/project-b'
    const registry = {
      version: 1 as const,
      removed: [
        {
          projectPath: projectA,
          aliases: [] as string[],
          removedAt: '2026-08-28T00:00:00.000Z'
        }
      ]
    }

    // Store keeps the removed root out of `codeWorkspaceRoots` after removal;
    // the picker options derive from the filtered list, so re-add via picker's
    // "Add workspace" restores it (filterRemovedCodeWorkspaceRoots reflects the
    // post-restoration list which no longer matches the removed identity).
    const candidateRoots = filterRemovedCodeWorkspaceRoots([projectA, projectB], registry)
    expect(candidateRoots).toEqual([projectB])

    const options = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: projectB,
      workspaceRoots: candidateRoots
    })
    expect(options.options.map((option) => option.root)).toEqual([projectB])

    // After an explicit re-add the marker is cleared and the project returns.
    const restoredRoots = filterRemovedCodeWorkspaceRoots([projectA, projectB], {
      version: 1,
      removed: []
    })
    expect(restoredRoots).toEqual([projectA, projectB])
  })

  it('does not reinsert a removed current root or its custom worktree alias', () => {
    const project = '/Users/zxy/project-a'
    const worktree = '/Users/zxy/project-a.worktrees/feature'
    const registry = {
      version: 1 as const,
      removed: [{ projectPath: project, aliases: [worktree], removedAt: 'now' }]
    }

    const result = buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: worktree,
      workspaceRoots: [project, worktree, '/Users/zxy/project-b'],
      removedCodeWorkspaces: registry
    })

    expect(result.currentRoot).toBe('')
    expect(result.options.map((option) => option.root)).toEqual(['/Users/zxy/project-b'])
  })
})
