import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store/chat-store'
import { useTaskWorkspaceStore } from '../store/task-workspace-store'
import { prepareAutomaticWorkspace } from './auto-plan-workspace'

const baseline = useChatStore.getState()
afterEach(() => {
  useChatStore.setState(baseline)
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})

describe('automatic plan workspace reservation', () => {
  it('uses the bound execution path before reserving the first plan', async () => {
    const createThread = vi.fn(async () => {
      useChatStore.setState({ activeThreadId: 'new', threads: [{ id: 'new', workspace: '/task/worktree', taskWorkspaceId: 'w' } as never] })
      return 'new'
    })
    useChatStore.setState({ activeThreadId: null, composerIsolation: 'worktree', createThread })
    expect(await prepareAutomaticWorkspace('/repo')).toEqual({ threadId: 'new', workspaceRoot: '/task/worktree' })
    expect(createThread).toHaveBeenCalledOnce()
  })
  it('reuses an existing task without asking a second owner to allocate', async () => {
    const createThread = vi.fn()
    useChatStore.setState({ activeThreadId: 'current', composerIsolation: 'worktree', createThread })
    expect(await prepareAutomaticWorkspace('/task/worktree')).toEqual({ threadId: 'current', workspaceRoot: '/task/worktree' })
    expect(createThread).not.toHaveBeenCalled()
  })
  it('refuses to reserve a plan in a failed workspace source directory', async () => {
    const createThread = vi.fn(async () => {
      useChatStore.setState({ activeThreadId: 'new', threads: [{ id: 'new', workspace: '/repo' } as never] })
      useTaskWorkspaceStore.setState({ prepByThread: { new: { ownerThreadId: 'new', workspaceId: 'w', state: 'failed', error: 'no Git' } } })
      return 'new'
    })
    useChatStore.setState({ activeThreadId: null, composerIsolation: 'worktree', createThread })
    await expect(prepareAutomaticWorkspace('/repo')).rejects.toThrow('no Git')
  })
})
