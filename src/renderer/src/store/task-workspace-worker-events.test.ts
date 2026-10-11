import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ bindThreadTaskWorkspace: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('./review-store', () => ({ ensureThreadBinding: vi.fn() }))
import { dispatchKunRuntimeEvents } from '../agent/kun-mapper-events'
import { buildThreadEventSink } from './chat-store-runtime'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'
import { receiveTaskWorkspaceRecord, threadWorkspaceBlocksSend, useTaskWorkspaceStore } from './task-workspace-store'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { markThreadWorktree, readThreadWorktreeRegistry, saveThreadWorktreeRegistry } from '../lib/thread-worktree-registry'

beforeEach(() => {
  vi.resetAllMocks()
  provider.bindThreadTaskWorkspace.mockRejectedValue(new Error('taskWorkspaceId is bound once'))
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})
afterEach(() => vi.unstubAllGlobals())

it('keeps worker lifecycle SSE out of the parent prep, binding, and project registry', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) } })
  const root = { ownerThreadId: 'parent', workspaceId: 'parent-w', sourceRoot: '/source',
    path: '/parent/worktree', state: 'ready' as const, isolation: 'worktree' as const,
    changedFiles: [], createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' }
  receiveTaskWorkspaceRecord(root)
  saveThreadWorktreeRegistry(markThreadWorktree('parent', { projectPath: '/source', worktreePath: root.path, branch: 'parent' }))
  let state = { activeThreadId: 'parent', threads: [{ id: 'parent', workspace: root.path, taskWorkspaceId: root.workspaceId }],
    adeThreads: [], blocks: [], lastSeq: 0, error: null, busy: false, watchTurnCompletion: {}, unreadThreadIds: {},
    drainQueuedMessages: vi.fn(), queuedMessages: [] } as unknown as ChatState
  const set: ChatStoreSet = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) } }
  const sink = buildThreadEventSink(set, () => state, { threadId: 'parent', sinceSeq: 0 })
  await dispatchKunRuntimeEvents(['creating', 'setting-up', 'ready', 'failed'].map((status, index) => ({
    kind: 'task_workspace', seq: index + 1, threadId: 'parent', timestamp: root.createdAt,
    taskWorkspace: { workspaceId: 'worker-w', unitId: 'child', state: status,
      workspace: { path: '/child/worktree', sourceRoot: root.path, kind: 'worktree' } }
  })), sink, async () => undefined)
  // Also protect REST hydration and an older event without unitId metadata.
  receiveTaskWorkspaceRecord({ ...root, unitId: 'child', workspaceId: 'worker-w', path: '/child/worktree' })
  await bindReadyTaskWorkspace({ threadId: 'parent', workspaceId: 'worker-w', state: 'ready',
    workspace: { path: '/child/worktree' } }, set, () => state)
  expect(provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
  expect(state.error).toBeNull()
  expect(threadWorkspaceBlocksSend('parent')).toBe(false)
  expect(useTaskWorkspaceStore.getState().prepByThread.parent).toMatchObject({ workspaceId: 'parent-w', state: 'ready', sourceRoot: '/source' })
  expect(readThreadWorktreeRegistry().worktrees.parent).toMatchObject({ projectPath: '/source', worktreePath: root.path })
})
