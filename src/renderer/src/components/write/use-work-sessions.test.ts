import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

const { listThreadsPage, recoverWorkTitle } = vi.hoisted(() => ({ listThreadsPage: vi.fn(), recoverWorkTitle: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ listThreadsPage }) }))
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

function Harness(): null {
  latest = useWorkSessions('')
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
