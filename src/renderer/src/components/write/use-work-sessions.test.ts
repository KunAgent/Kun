import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

const { listThreadsPage, recoverWorkTitle } = vi.hoisted(() => ({ listThreadsPage: vi.fn(), recoverWorkTitle: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({
  listThreadsPage: async (...args: unknown[]) => ({ workbenchScopeApplied: true, hasMore: false, ...await listThreadsPage(...args) })
}) }))
vi.mock('../../write/work-session-title-recovery', () => ({ recoverWorkTitle }))

import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useWorkSessionStore } from '../../write/work-session-store'
import { useWorkSessions } from './use-work-sessions'

const SPACE_A = '/Users/me/A'
const SPACE_B = '/Users/me/B'

function workThread(id: string, workspace: string): NormalizedThread {
  return {
    id, title: id, workspace, agentSurface: 'write', updatedAt: '2026-10-07T00:00:00.000Z',
    model: 'deepseek-v4', mode: 'agent'
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let latest: ReturnType<typeof useWorkSessions>
let query = ''

function Harness(): null {
  latest = useWorkSessions(query)
  return null
}

const sessionIds = (): string[] => latest.sessions.map((session) => session.id)

describe('useWorkSessions', () => {
  const initialChat = useChatStore.getState()
  const initialWrite = useWriteWorkspaceStore.getState()
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    listThreadsPage.mockReset()
    query = ''
    recoverWorkTitle.mockReset()
    recoverWorkTitle.mockResolvedValue(null)
    useWorkSessionStore.setState({ titles: {} })
    useChatStore.setState({ runtimeConnection: 'ready', threads: [] })
    useWriteWorkspaceStore.setState({ workspaceRoot: SPACE_A, workspaceRoots: [SPACE_A, SPACE_B], whiteboards: {} })
  })

  afterEach(async () => {
    await act(async () => renderer?.unmount())
    renderer = null
    useChatStore.setState(initialChat, true)
    useWriteWorkspaceStore.setState(initialWrite, true)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists the current space\'s own Work threads', async () => {
    listThreadsPage.mockResolvedValue({ threads: [workThread('a-1', SPACE_A)] })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(sessionIds()).toEqual(['a-1'])
    expect(latest.loading).toBe(false)
  })

  it('never shows a late listing of the previous space after switching', async () => {
    const slow = deferred<{ threads: NormalizedThread[] }>()
    listThreadsPage.mockImplementation(({ workspace }: { workspace: string }) =>
      workspace === SPACE_A ? slow.promise : Promise.resolve({ threads: [workThread('b-1', SPACE_B)] }))
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => { useWriteWorkspaceStore.setState({ workspaceRoot: SPACE_B }) })
    await act(async () => {
      slow.resolve({ threads: [workThread('a-1', SPACE_A)] })
      await slow.promise
    })
    expect(sessionIds()).toEqual(['b-1'])
  })

  it('recovers old titles in both the workspace list and the tab title store', async () => {
    const old = { ...workThread('old-session', SPACE_A), title: 'Write Assistant', titleAuto: true, turnCount: 1 }
    listThreadsPage.mockResolvedValue({ threads: [old] })
    recoverWorkTitle.mockResolvedValue({ title: '阅读论文', titleAuto: true, agentSurface: 'write' })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(recoverWorkTitle).toHaveBeenCalledWith('old-session')
    expect(latest.sessions[0]?.title).toBe('阅读论文')
    expect(useWorkSessionStore.getState().titles['old-session']).toBe('阅读论文')
  })

  it('updates an old title already present in the shared thread list', async () => {
    const old = { ...workThread('old-session', SPACE_A), title: 'Write Assistant', titleAuto: true, turnCount: 1 }
    useChatStore.setState({ threads: [old] })
    listThreadsPage.mockResolvedValue({ threads: [old] })
    recoverWorkTitle.mockResolvedValue({ title: 'Historical discussion', titleAuto: true, agentSurface: 'write' })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(useChatStore.getState().threads[0]?.title).toBe('Historical discussion')
    expect(latest.sessions[0]?.title).toBe('Historical discussion')
  })

  it('does not overwrite a title manually changed while recovery is pending', async () => {
    const old = { ...workThread('old-session', SPACE_A), title: 'Write Assistant', titleAuto: true, turnCount: 1 }
    const pending = deferred<{ title: string; titleAuto: boolean; agentSurface: 'write' }>()
    useChatStore.setState({ threads: [old] })
    listThreadsPage.mockResolvedValue({ threads: [old] })
    recoverWorkTitle.mockReturnValue(pending.promise)
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => {
      latest.patchThread('old-session', { title: 'Manual title', titleAuto: false })
      useChatStore.setState({ threads: [{ ...old, title: 'Manual title', titleAuto: false }] })
    })
    await act(async () => {
      pending.resolve({ title: 'Old recovery', titleAuto: true, agentSurface: 'write' })
      await pending.promise
    })
    expect(latest.sessions[0]?.title).toBe('Manual title')
    expect(useWorkSessionStore.getState().titles['old-session']).toBe('Manual title')
  })

  it('never requests title recovery for locked or empty sessions', async () => {
    listThreadsPage.mockResolvedValue({ threads: [
      { ...workThread('locked', SPACE_A), title: 'Write Assistant', titleAuto: false, turnCount: 1 },
      { ...workThread('empty', SPACE_A), title: 'Write Assistant', titleAuto: true, turnCount: 0 }
    ] })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(recoverWorkTitle).not.toHaveBeenCalled()
    expect(latest.sessions.find((session) => session.id === 'locked')?.title).toBe('Write Assistant')
  })

  it('retries an unresolved title when the session listing is refreshed', async () => {
    const old = { ...workThread('old-session', SPACE_A), title: 'Write Assistant', titleAuto: true, turnCount: 1 }
    listThreadsPage.mockResolvedValue({ threads: [old] })
    recoverWorkTitle
      .mockResolvedValueOnce({ title: 'Write Assistant', titleAuto: true, agentSurface: 'write' })
      .mockResolvedValueOnce({ title: 'Recovered later', titleAuto: true, agentSurface: 'write' })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(recoverWorkTitle).toHaveBeenCalledTimes(1)
    await act(async () => { latest.reload() })
    expect(recoverWorkTitle).toHaveBeenCalledTimes(2)
    expect(latest.sessions[0]?.title).toBe('Recovered later')
  })

  it('pages independently through older Work sessions and retries a failed page', async () => {
    const first = Array.from({ length: 80 }, (_, index) => workThread(`work-${index}`, SPACE_A))
    listThreadsPage.mockResolvedValueOnce({ threads: first, hasMore: true, nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ threads: [first[79], workThread('older-work', SPACE_A)] })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(listThreadsPage).toHaveBeenCalledWith(expect.objectContaining({
      workspace: SPACE_A, workspaceMode: 'code', workbenchScope: 'work', limit: 80
    }))
    expect(latest.hasMore).toBe(true)
    await act(async () => latest.loadMore())
    expect(latest.error).toBe('more')
    expect(sessionIds()).toHaveLength(80)
    await act(async () => latest.loadMore())
    expect(listThreadsPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next' }))
    expect(sessionIds()).toHaveLength(81)
    expect(sessionIds()).toContain('older-work')
    expect(latest.hasMore).toBe(false)
  })

  it('keeps previously loaded older pages after a refresh', async () => {
    listThreadsPage.mockResolvedValueOnce({ threads: [workThread('recent', SPACE_A)], hasMore: true, nextCursor: 'next' })
      .mockResolvedValueOnce({ threads: [workThread('older', SPACE_A)] })
      .mockResolvedValueOnce({ threads: [workThread('recent', SPACE_A)], hasMore: true, nextCursor: 'next' })
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => latest.loadMore())
    await act(async () => latest.reload())
    expect(sessionIds()).toEqual(['recent', 'older'])
    expect(latest.hasMore).toBe(true)
  })

  it('does not restore stale titles or removed rows from an in-flight refresh', async () => {
    const renamed = workThread('renamed', SPACE_A)
    const removed = workThread('removed', SPACE_A)
    const pending = deferred<{ threads: NormalizedThread[] }>()
    listThreadsPage.mockResolvedValueOnce({ threads: [renamed, removed] }).mockReturnValueOnce(pending.promise)
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => latest.reload())
    await act(async () => {
      latest.patchThread('renamed', { title: 'New name', titleAuto: false })
      latest.forgetThread('removed')
    })
    await act(async () => { pending.resolve({ threads: [renamed, removed] }); await pending.promise })
    expect(sessionIds()).toEqual(['renamed'])
    expect(latest.sessions[0]?.title).toBe('New name')
  })

  it('searches the server beyond loaded pages and rejects stale search results', async () => {
    vi.useFakeTimers()
    const slow = deferred<{ threads: NormalizedThread[] }>()
    listThreadsPage.mockImplementation(({ search }: { search?: string }) => {
      if (search === 'old') return slow.promise
      if (search === 'new') return Promise.resolve({ threads: [workThread('remote-result', SPACE_A)] })
      return Promise.resolve({ threads: [workThread('recent', SPACE_A)] })
    })
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => { query = 'old'; renderer?.update(createElement(Harness)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await act(async () => { query = 'new'; renderer?.update(createElement(Harness)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await act(async () => { slow.resolve({ threads: [workThread('stale-result', SPACE_A)] }); await slow.promise })
    expect(listThreadsPage).toHaveBeenLastCalledWith(expect.objectContaining({ workbenchScope: 'work', search: 'new' }))
    expect(sessionIds()).toEqual(['remote-result'])
  })

  it('ignores a pending older page when switching spaces', async () => {
    const oldPage = deferred<{ threads: NormalizedThread[] }>()
    listThreadsPage.mockImplementation(({ workspace, cursor }: { workspace: string; cursor?: string }) => {
      if (cursor) return oldPage.promise
      return workspace === SPACE_A
        ? Promise.resolve({ threads: [workThread('a-1', SPACE_A)], hasMore: true, nextCursor: 'next' })
        : Promise.resolve({ threads: [workThread('b-1', SPACE_B)] })
    })
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => latest.loadMore())
    await act(async () => { useWriteWorkspaceStore.setState({ workspaceRoot: SPACE_B }) })
    await act(async () => { oldPage.resolve({ threads: [workThread('a-old', SPACE_A)] }); await oldPage.promise })
    expect(sessionIds()).toEqual(['b-1'])
  })

  it('surfaces an unacknowledged server scope instead of silently truncating the list', async () => {
    listThreadsPage.mockResolvedValue({ threads: [], workbenchScopeApplied: false })
    await act(async () => { renderer = create(createElement(Harness)) })
    expect(latest.error).toBe('initial')
    expect(latest.loading).toBe(false)
  })

  it('lists the space again on reload and keeps only the newest answer', async () => {
    const stale = deferred<{ threads: NormalizedThread[] }>()
    listThreadsPage
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => Promise.resolve({ threads: [workThread('restored', SPACE_A)] }))
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => { latest.reload() })
    await act(async () => {
      stale.resolve({ threads: [] })
      await stale.promise
    })

    expect(listThreadsPage).toHaveBeenCalledTimes(2)
    expect(sessionIds()).toEqual(['restored'])
  })
})
