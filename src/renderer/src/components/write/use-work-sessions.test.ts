import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

const { listThreadsPage } = vi.hoisted(() => ({ listThreadsPage: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ listThreadsPage }) }))

import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
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
