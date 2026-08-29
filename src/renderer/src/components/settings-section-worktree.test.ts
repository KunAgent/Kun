import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeSettingsSection } from './settings-section-worktree'

describe('worktree settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manages the default plan-isolation setting alongside worktrees', async () => {
    const updateKun = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        listGitBranchWorktrees: vi.fn(async () => ({
          ok: true,
          worktreeRoot: '/managed',
          mainBranch: 'feature/source',
          worktrees: []
        }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorktreeSettingsSection, {
        ctx: {
          t: (key: string) => key,
          form: {
            workspaceRoot: '/repo',
            gitBranchPrefix: 'codex/'
          },
          kun: {},
          update: vi.fn(),
          updateKun,
          threads: [],
          locale: 'en'
        }
      }))
    })

    const toggle = renderer!.root.findByProps({ role: 'switch' })
    expect(toggle.props['aria-checked']).toBe(true)
    act(() => toggle.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      planExecution: { useWorktreeByDefault: false }
    })
    act(() => renderer!.unmount())
  })
})
