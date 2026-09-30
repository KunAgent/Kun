import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from './chat-store-types'
import { codeThreadWorkspaceIntent } from './code-thread-workspace-intent'
vi.mock('../lib/workspace-availability', () => ({
  workspaceDirectoryExists: async () => true, workspaceMissingError: () => 'missing'
}))
const revision = `ade-project-v1:${'a'.repeat(64)}`
const state = { workspaceRoot: '/repo', activeThreadId: null,
  composerProjectDefaults: { workspaceRoot: '/repo', revision, value: { isolation: 'worktree' } }
} as unknown as ChatState
const args = () => ({ state, workspaceRoot: '/repo', provider: { createTaskWorkspace: vi.fn() } as never,
  stillCurrent: () => true })
afterEach(() => vi.unstubAllGlobals())

describe('Code new-task workspace intent', () => {
  it('freezes the displayed project revision before any physical allocation', async () => {
    const allocate = vi.fn()
    vi.stubGlobal('window', { kunGui: { getGitBranches: vi.fn(async () => ({ ok: true, branches: [{ name: 'main' }] })),
      checkoutGitBranchWorktree: allocate } })
    const result = await codeThreadWorkspaceIntent({ ...args(), worktreeBranch: 'main' })
    expect(result?.createFields).toEqual({ workspaceIsolation: 'worktree', routeIntent: 'inherit', projectDefaultsRevision: revision })
    expect(result?.startFrom).toEqual({ kind: 'branch', name: 'main' })
    expect(allocate).not.toHaveBeenCalled()
  })
  it('allows explicit current-directory override over the project worktree default', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    expect((await codeThreadWorkspaceIntent({ ...args(), useWorktreePool: false }))?.isolation).toBe('local')
  })
  it('rejects non-Git isolation instead of silently executing in the source directory', async () => {
    vi.stubGlobal('window', { kunGui: { getGitBranches: async () => ({ ok: false, message: 'not a Git repository' }) } })
    await expect(codeThreadWorkspaceIntent(args())).rejects.toThrow('not a Git repository')
  })
  it('abandons a stale navigation before admission or allocation', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    expect(await codeThreadWorkspaceIntent({ ...args(), stillCurrent: () => false })).toBeNull()
  })
})
