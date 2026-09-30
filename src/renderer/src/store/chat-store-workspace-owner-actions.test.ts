import { beforeEach, describe, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ createTaskWorkspace: vi.fn(), retryTaskWorkspace: vi.fn() }))
const registry = vi.hoisted(() => ({ worktrees: {} as Record<string, unknown> }))
vi.mock('../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('../lib/thread-worktree-registry', () => ({ readThreadWorktreeRegistry: () => registry }))
vi.mock('./chat-store-runtime-helpers', () => ({ bindReadyTaskWorkspace: vi.fn() }))
import { createAppActions } from './chat-store-app-actions'
import { useTaskWorkspaceStore } from './task-workspace-store'
import type { ChatState, ChatStoreSet } from './chat-store-types'

beforeEach(() => {
  vi.clearAllMocks()
  registry.worktrees = {}
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})
function actions() {
  const state = { threads: [{ id: 't', workspace: '/repo' }], adeThreads: [] } as unknown as ChatState
  const set: ChatStoreSet = (update) => Object.assign(state, typeof update === 'function' ? update(state) : update)
  return createAppActions({ get: () => state, set, normalizeWorkspaceRoot: (root: string) => root } as never)
}

describe('workspace owner actions', () => {
  it('keeps historical pool ownership without allocating a TaskWorkspace', async () => {
    registry.worktrees.t = { projectPath: '/repo', worktreePath: '/pool/1', poolIndex: 1 }
    expect(await actions().requestAdeThreadWorkspace('t')).toBe(true)
    expect(provider.createTaskWorkspace).not.toHaveBeenCalled()
    expect(provider.retryTaskWorkspace).not.toHaveBeenCalled()
  })
  it('retries the original workspace id and retains its frozen start point', async () => {
    useTaskWorkspaceStore.setState({ prepByThread: {
      t: { ownerThreadId: 't', workspaceId: 'original', state: 'failed', error: 'setup failed' }
    } })
    provider.retryTaskWorkspace.mockResolvedValue({ record: { ownerThreadId: 't', workspaceId: 'original',
      state: 'creating', sourceRoot: '/repo', path: '/task', isolation: 'worktree' } })
    expect(await actions().requestAdeThreadWorkspace('t', { kind: 'default-branch' })).toBe(true)
    expect(provider.retryTaskWorkspace).toHaveBeenCalledExactlyOnceWith('original')
    expect(provider.createTaskWorkspace).not.toHaveBeenCalled()
  })
})
