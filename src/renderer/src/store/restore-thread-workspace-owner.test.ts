import { beforeEach, describe, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ listTaskWorkspaces: vi.fn(), bindThreadTaskWorkspace: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('./review-store', () => ({ ensureThreadBinding: vi.fn() }))
import { restoreThreadWorkspaceOwner } from './restore-thread-workspace-owner'
import { threadWorkspaceBlocksSend, useTaskWorkspaceStore } from './task-workspace-store'
import type { ChatState, ChatStoreSet } from './chat-store-types'

const record = { ownerThreadId: 'task', workspaceId: 'w', sourceRoot: '/repo', path: '/task/worktree',
  state: 'ready', isolation: 'worktree', createdAt: '2026-09-30T00:00:00Z' }
function harness() {
  const state = { activeThreadId: 'task', threads: [{ id: 'task', workspace: '/repo', executionConfig: { isolation: 'worktree' } }],
    adeThreads: [], error: null, drainQueuedMessages: vi.fn() } as unknown as ChatState
  const set: ChatStoreSet = (update) => Object.assign(state, typeof update === 'function' ? update(state) : update)
  const run = () => restoreThreadWorkspaceOwner(provider as never, 'task', set, () => state,
    () => state.activeThreadId === 'task')
  return { state, run }
}
beforeEach(() => {
  vi.resetAllMocks()
  provider.listTaskWorkspaces.mockResolvedValue({ records: [record] })
  provider.bindThreadTaskWorkspace.mockResolvedValue(undefined)
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})

describe('selection restores a missed owner workspace event', () => {
  it('binds the exact owner before draining its queued input', async () => {
    const { state, run } = harness()
    expect(await run()).toBe(true)
    expect(provider.listTaskWorkspaces).toHaveBeenCalledWith({ ownerThreadId: 'task' })
    expect(provider.bindThreadTaskWorkspace).toHaveBeenCalledWith('task', { taskWorkspaceId: 'w', workspace: '/task/worktree' })
    expect(state.threads[0]).toMatchObject({ id: 'task', workspace: '/task/worktree', taskWorkspaceId: 'w' })
    expect(state.drainQueuedMessages).toHaveBeenCalledOnce()
  })
  it('does not consume a late lookup after another task was selected', async () => {
    let complete!: (value: unknown) => void
    provider.listTaskWorkspaces.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const { state, run } = harness()
    const pending = run()
    state.activeThreadId = 'other'
    complete({ records: [record] })
    expect(await pending).toBe(false)
    expect(provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
    expect(state.threads[0].workspace).toBe('/repo')
  })
  it('does not overwrite the new conversation or its error after a late bind failure', async () => {
    let reject!: (error: Error) => void
    provider.bindThreadTaskWorkspace.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    const { state, run } = harness()
    const pending = run()
    await vi.waitFor(() => expect(provider.bindThreadTaskWorkspace).toHaveBeenCalledOnce())
    state.activeThreadId = 'other'
    state.error = 'other task error'
    reject(new Error('late failure'))
    expect(await pending).toBe(false)
    expect(state.error).toBe('other task error')
    expect(state.drainQueuedMessages).not.toHaveBeenCalled()
  })
  it('ignores worker and foreign-owner records even if returned by an older host', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [
      { ...record, unitId: 'worker' }, { ...record, ownerThreadId: 'foreign' }
    ] })
    const { run } = harness()
    expect(await run()).toBe(true)
    expect(provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
  })
  it('does not bind a ready result over a newer workspace preparation generation', async () => {
    let complete!: (value: unknown) => void
    provider.listTaskWorkspaces.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const { run } = harness()
    const pending = run()
    useTaskWorkspaceStore.setState({ prepByThread: {
      task: { ownerThreadId: 'task', workspaceId: 'newer', state: 'creating' }
    } })
    complete({ records: [record] })
    expect(await pending).toBe(true)
    expect(provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
    expect(useTaskWorkspaceStore.getState().prepByThread.task.workspaceId).toBe('newer')
  })

  it('repairs a bound parent whose prep was poisoned by an older worker event', async () => {
    const { state, run } = harness()
    Object.assign(state.threads[0], { taskWorkspaceId: 'w', workspace: '/task/worktree' })
    state.error = 'taskWorkspaceId is bound once; create a new thread to rebind'
    useTaskWorkspaceStore.setState({ prepByThread: { task: { ownerThreadId: 'task', workspaceId: 'w',
      state: 'failed', error: state.error } } })
    provider.listTaskWorkspaces.mockResolvedValue({ records: [record, { ...record,
      workspaceId: 'worker-w', unitId: 'worker', path: '/worker/worktree', createdAt: '2026-10-01T00:00:00Z' }] })
    expect(threadWorkspaceBlocksSend('task')).toBe(true)
    expect(await run()).toBe(true)
    expect(provider.bindThreadTaskWorkspace).not.toHaveBeenCalled()
    expect(threadWorkspaceBlocksSend('task')).toBe(false)
    expect(state.error).toBeNull()
    expect(state.threads[0].workspace).toBe('/task/worktree')
  })

})
