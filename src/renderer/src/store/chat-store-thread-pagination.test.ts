import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../agent/provider-types'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  initialWorkspaceThreadPages,
  loadMoreThreads,
  type WorkspaceThreadPageMeta
} from './chat-store-thread-pagination'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

function thread(id: string): NormalizedThread {
  return {
    id, title: id, updatedAt: `2026-01-0${id.endsWith('2') ? '2' : '1'}T00:00:00.000Z`,
    model: 'test', mode: 'agent', workspace: '/project'
  }
}

function harness(page: WorkspaceThreadPageMeta, archived = false): {
  state: ChatState
  set: ChatStoreSet
  get: ChatStoreGet
} {
  let state = {
    runtimeConnection: 'ready', showArchivedThreads: archived, threads: [thread('thread-1')],
    threadListCursorByWorkspace: { '/project': page }
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  return { get state() { return state }, set, get: () => state }
}

describe('sidebar thread pagination', () => {
  beforeEach(() => registryMock.getProvider.mockReset())

  it('marks project pagination unknown without borrowing a global cursor or total', () => {
    expect(initialWorkspaceThreadPages(['/project'], true, 'active')).toEqual({
      '/project': {
        workspaceKey: '/project', mode: 'active', status: 'unknown', hasMore: true
      }
    })
    expect(initialWorkspaceThreadPages(['/project'], false, 'active')['/project']).toMatchObject({
      status: 'complete', hasMore: false
    })
  })

  it('establishes a project cursor, advances it, and deduplicates repeated rows', async () => {
    let resolveFirst!: (value: { threads: NormalizedThread[]; hasMore: boolean; nextCursor?: string }) => void
    const first = new Promise<{ threads: NormalizedThread[]; hasMore: boolean; nextCursor?: string }>((resolve) => {
      resolveFirst = resolve
    })
    const listThreadsPage = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ threads: [thread('thread-2')], hasMore: false })
    registryMock.getProvider.mockReturnValue({
      listThreadsPage,
      getThreadDetail: vi.fn(async () => ({ blocks: [{ kind: 'user', id: 'u', text: 'ok' }] }))
    } as unknown as AgentProvider)
    const h = harness({
      workspaceKey: '/project', mode: 'active', status: 'unknown', hasMore: true
    })

    const request = loadMoreThreads('/project', h.set, h.get)
    const duplicate = loadMoreThreads('/project', h.set, h.get)
    expect(listThreadsPage).toHaveBeenCalledTimes(1)
    expect(listThreadsPage).toHaveBeenCalledWith(expect.not.objectContaining({ cursor: expect.anything() }))
    resolveFirst({ threads: [thread('thread-1')], hasMore: true, nextCursor: 'project-cursor' })
    await Promise.all([request, duplicate])
    expect(h.state.threads).toHaveLength(1)

    await loadMoreThreads('/project', h.set, h.get)
    expect(listThreadsPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'project-cursor' }))
    expect(h.state.threads.map((item) => item.id)).toEqual(['thread-2', 'thread-1'])
    expect(h.state.threadListCursorByWorkspace['/project']).toMatchObject({ status: 'complete', hasMore: false })
  })

  it('uses archived-only scope and completes malformed hasMore pages without a cursor', async () => {
    const listThreadsPage = vi.fn(async () => ({ threads: [], hasMore: true }))
    registryMock.getProvider.mockReturnValue({ listThreadsPage } as unknown as AgentProvider)
    const h = harness({
      workspaceKey: '/project', mode: 'archived', status: 'unknown', hasMore: true
    }, true)

    await loadMoreThreads('/project', h.set, h.get)
    expect(listThreadsPage).toHaveBeenCalledWith(expect.objectContaining({
      archivedOnly: true, includeSide: false, workspace: '/project'
    }))
    expect(h.state.threadListCursorByWorkspace['/project']).toMatchObject({
      status: 'complete', hasMore: false
    })
  })
})
