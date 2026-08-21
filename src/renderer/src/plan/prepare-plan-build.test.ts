import { describe, expect, it, vi } from 'vitest'
import type { GuiPlanArtifact } from './plan-store'
import { preparePlanBuild } from './prepare-plan-build'

const plan: GuiPlanArtifact = {
  id: 'plan-1', featureName: 'Scheduled build', sourceRequest: 'Build it', relativePath: '.kunsdd/plan/test.md',
  workspaceRoot: '/repo', createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z'
}

describe('preparePlanBuild', () => {
  it('saves before reading the branch and snapshots latest markdown', async () => {
    const order: string[] = []
    const result = await preparePlanBuild({
      plan, content: '# Latest\nbody', orchestration: 'direct', graphEnabled: true,
      usePromptWorktree: true, branchPrefix: 'codex/', activeThreadId: 'thread-1',
      save: vi.fn(async () => { order.push('save'); return true }),
      currentPlanId: () => plan.id, currentThreadId: () => 'thread-1',
      getGitBranches: vi.fn(async () => { order.push('branch'); return { ok: true as const, repositoryRoot: '/repo', primaryRepositoryRoot: '/repo', currentBranch: 'develop', branches: [], dirtyCount: 2 } })
    })
    expect(order).toEqual(['save', 'branch'])
    expect(result.prompt).toContain('"# Latest\\nbody"')
    expect(result.prompt).toContain('"targetBranch": "develop"')
    expect(result.prompt).toContain('"sourceDirtyFileCount": 2')
  })

  it('preserves graph orchestration without reading git', async () => {
    const getGitBranches = vi.fn()
    const result = await preparePlanBuild({
      plan, content: '# Graph', orchestration: 'graph', graphEnabled: true,
      usePromptWorktree: true, branchPrefix: 'codex/', activeThreadId: null,
      save: async () => true, currentPlanId: () => plan.id, currentThreadId: () => null,
      getGitBranches
    })
    expect(result.orchestration).toBe('graph')
    expect(result.prompt).toContain('Graph orchestration')
    expect(getGitBranches).not.toHaveBeenCalled()
  })

  it('cancels when active context changes while preparing', async () => {
    await expect(preparePlanBuild({
      plan, content: '# Changed', orchestration: 'direct', graphEnabled: true,
      usePromptWorktree: false, branchPrefix: 'codex/', activeThreadId: 'old',
      save: async () => true, currentPlanId: () => 'another-plan', currentThreadId: () => 'old',
      getGitBranches: vi.fn()
    })).rejects.toThrow('active plan or conversation changed')
  })
})
