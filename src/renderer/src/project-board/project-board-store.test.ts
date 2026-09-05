import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectBoardCard, ProjectBoardSnapshot } from './project-board-types'

const api = vi.hoisted(() => ({
  snapshot: vi.fn(), summaries: vi.fn(), createCard: vi.fn(), patchCard: vi.fn(),
  patchCardStatuses: vi.fn(), deleteCard: vi.fn(), patchTodoOverlay: vi.fn(), patchTodoStatus: vi.fn()
}))

vi.mock('./project-board-api', () => ({
  projectBoardApi: api,
  ProjectBoardApiError: class ProjectBoardApiError extends Error {
    constructor(message: string, readonly status: number, readonly snapshot?: ProjectBoardSnapshot) {
      super(message)
      this.name = 'ProjectBoardApiError'
    }
  }
}))

import { ProjectBoardApiError } from './project-board-api'
import { useProjectBoardStore } from './project-board-store'

function snapshot(workspaceRoot: string, revision = 0): ProjectBoardSnapshot {
  return {
    workspaceRoot, revision, cards: [],
    counts: { pending: 0, inProgress: 0, completed: 0, archived: 0, total: 0 },
    truncated: false
  }
}

function card(id: string, kind: ProjectBoardCard['kind'] = 'manual'): ProjectBoardCard {
  return {
    id,
    kind,
    workspaceRoot: '/A',
    title: id,
    description: '',
    status: 'pending',
    category: kind === 'manual' ? 'other' : 'plan',
    priority: null,
    archived: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    source: kind === 'manual'
      ? { label: 'Manual' }
      : { label: 'Plan', threadId: 'thread-1', todoId: id }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('project board store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useProjectBoardStore.setState({
      selectedWorkspaceRoot: '', snapshotByWorkspace: {}, summariesByWorkspace: {},
      loading: false, mutatingCardIds: {}, loadedAtByWorkspace: {}, error: null, searchQuery: '',
      filters: { categories: [], priorities: [], sources: [], showCompleted: true }, activeTab: 'board'
    })
  })

  it('keeps a late workspace A response from overwriting workspace B page state', async () => {
    const a = deferred<ProjectBoardSnapshot>()
    const b = deferred<ProjectBoardSnapshot>()
    api.snapshot.mockImplementation((workspace: string) => workspace === '/A' ? a.promise : b.promise)
    useProjectBoardStore.getState().selectWorkspace('/A')
    const loadA = useProjectBoardStore.getState().loadBoard('/A')
    useProjectBoardStore.getState().selectWorkspace('/B')
    const loadB = useProjectBoardStore.getState().loadBoard('/B')
    b.resolve(snapshot('/B'))
    await loadB
    a.resolve(snapshot('/A'))
    await loadA

    const state = useProjectBoardStore.getState()
    expect(state.selectedWorkspaceRoot).toBe('/B')
    expect(state.snapshotByWorkspace['/A']?.workspaceRoot).toBe('/A')
    expect(state.snapshotByWorkspace['/B']?.workspaceRoot).toBe('/B')
    expect(state.loading).toBe(false)
  })

  it('rolls an optimistic move back to the authoritative 409 snapshot', async () => {
    const server = snapshot('/A', 2)
    server.cards = [{
      id: 'manual:one', kind: 'manual', workspaceRoot: '/A', title: 'One', description: '',
      status: 'pending', category: 'other', priority: null, archived: false,
      updatedAt: '2026-08-31T00:00:00.000Z', source: { label: 'Manual' }
    }]
    server.counts = { pending: 1, inProgress: 0, completed: 0, archived: 0, total: 1 }
    useProjectBoardStore.setState({ selectedWorkspaceRoot: '/A', snapshotByWorkspace: { '/A': server } })
    api.snapshot.mockResolvedValue(server)
    api.patchCardStatuses.mockRejectedValue(new ProjectBoardApiError('updated elsewhere', 409, server))

    await useProjectBoardStore.getState().moveCard(server.cards[0]!, 'completed')

    expect(useProjectBoardStore.getState().snapshotByWorkspace['/A']?.cards[0]?.status).toBe('pending')
    expect(useProjectBoardStore.getState().error).toBe('updated elsewhere')
  })

  it('moves 500 cards through one bulk request and applies response deltas', async () => {
    const server = snapshot('/A', 3)
    server.cards = Array.from({ length: 500 }, (_, index) => card(`manual:${index}`))
    server.counts = { pending: 500, inProgress: 0, completed: 0, archived: 0, total: 500 }
    useProjectBoardStore.setState({ selectedWorkspaceRoot: '/A', snapshotByWorkspace: { '/A': server } })
    api.patchCardStatuses.mockResolvedValue({
      workspaceRoot: '/A',
      revision: 4,
      counts: { pending: 0, inProgress: 0, completed: 500, archived: 0, total: 500 },
      updatedCards: server.cards.map((item) => ({
        id: item.id,
        status: 'completed',
        updatedAt: '2026-09-01T00:01:00.000Z'
      })),
      failures: []
    })

    const result = await useProjectBoardStore.getState().moveCards(server.cards, 'completed')

    expect(api.patchCardStatuses).toHaveBeenCalledTimes(1)
    expect(result.updatedCardIds).toHaveLength(500)
    expect(useProjectBoardStore.getState().snapshotByWorkspace['/A']?.counts.completed).toBe(500)
    expect(useProjectBoardStore.getState().mutatingCardIds).toEqual({})
  })

  it('keeps failed cards selected by returning partial failure ids', async () => {
    const server = snapshot('/A', 1)
    server.cards = [card('manual:one'), card('manual:two')]
    server.counts = { pending: 2, inProgress: 0, completed: 0, archived: 0, total: 2 }
    useProjectBoardStore.setState({ selectedWorkspaceRoot: '/A', snapshotByWorkspace: { '/A': server } })
    api.patchCardStatuses.mockResolvedValue({
      workspaceRoot: '/A',
      revision: 2,
      counts: { pending: 1, inProgress: 0, completed: 1, archived: 0, total: 2 },
      updatedCards: [{
        id: 'manual:one',
        status: 'completed',
        updatedAt: '2026-09-01T00:01:00.000Z'
      }],
      failures: [{ cardId: 'manual:two', code: 'write_failed', message: 'disk error' }]
    })

    const result = await useProjectBoardStore.getState().moveCards(server.cards, 'completed')

    expect(result).toEqual({ updatedCardIds: ['manual:one'], failedCardIds: ['manual:two'] })
    expect(useProjectBoardStore.getState().snapshotByWorkspace['/A']?.cards.map((item) => item.status))
      .toEqual(['completed', 'pending'])
  })

  it('blocks same-thread Plan selections entering in-progress before the API call', async () => {
    const server = snapshot('/A', 1)
    server.cards = [card('todo:thread-1:one', 'thread_todo'), card('todo:thread-1:two', 'thread_todo')]
    useProjectBoardStore.setState({ selectedWorkspaceRoot: '/A', snapshotByWorkspace: { '/A': server } })

    const result = await useProjectBoardStore.getState().moveCards(server.cards, 'in_progress')

    expect(api.patchCardStatuses).not.toHaveBeenCalled()
    expect(result.failedCardIds).toHaveLength(2)
    expect(useProjectBoardStore.getState().snapshotByWorkspace['/A']?.cards.every((item) =>
      item.status === 'pending')).toBe(true)
  })

  it('backs off repeated snapshot failures instead of retrying every render', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    api.snapshot.mockRejectedValue(new Error('runtime unavailable'))
    useProjectBoardStore.getState().selectWorkspace('/retry-project')

    await useProjectBoardStore.getState().loadBoard('/retry-project')
    await useProjectBoardStore.getState().loadBoard('/retry-project')
    expect(api.snapshot).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(15_000)
    await useProjectBoardStore.getState().loadBoard('/retry-project')
    expect(api.snapshot).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
