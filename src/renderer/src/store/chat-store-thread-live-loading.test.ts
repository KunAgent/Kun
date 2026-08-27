import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ThreadDetail } from '../agent/provider-types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-23T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle'
  }
}

function detail(id: string): ThreadDetail {
  return {
    blocks: [{ kind: 'assistant', id: `${id}-answer`, text: `${id} ready` }],
    latestSeq: 9,
    threadStatus: 'idle'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
  sseAbortRef: { current: AbortController | null }
} {
  let state: ChatState
  state = {
    activeThreadId: 'thread-a',
    activeThreadRelation: 'primary',
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    awaitingUserInputThreadIds: {},
    blocks: [{ kind: 'assistant', id: 'thread-a-answer', text: 'thread-a ready' }],
    busy: false,
    busyUnconfirmed: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerModelGroups: [],
    composerOrchestration: 'direct',
    composerPickList: [],
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 5,
    liveDeltaSeqFloor: 5,
    liveReasoning: '',
    liveAssistant: '',
    queuedMessages: [],
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    threadLoadingId: null,
    threadHistoryCursor: null,
    threadHasMoreHistory: false,
    threadHistoryLoading: false,
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    unreadThreadIds: {},
    watchTurnCompletion: {},
    threads: [thread('thread-a'), thread('thread-b'), thread('thread-c')]
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const sseAbortRef = { current: null as AbortController | null }
  return {
    actions: createThreadActions({ set, get, sseAbortRef }),
    state,
    sseAbortRef
  }
}

describe('live thread hydration loading', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes the active thread transactionally without blanking its projection or SSE', async () => {
    const pending = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents
    })
    const { actions, state, sseAbortRef } = buildHarness()
    const existingBlocks: ChatBlock[] = [...state.blocks]
    const existingSse = new AbortController()
    sseAbortRef.current = existingSse

    const refresh = actions.selectThread('thread-a')

    expect(state.threadRefreshingId).toBe('thread-a')
    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual(existingBlocks)
    expect(existingSse.signal.aborted).toBe(false)
    expect(sseAbortRef.current).toBe(existingSse)
    expect(subscribeThreadEvents).not.toHaveBeenCalled()

    pending.resolve(detail('thread-a'))
    await refresh

    expect(existingSse.signal.aborted).toBe(true)
    expect(state.threadRefreshingId).toBeNull()
    expect(state.blocks).toEqual(detail('thread-a').blocks)
    expect(subscribeThreadEvents).toHaveBeenCalledWith(
      'thread-a',
      detail('thread-a').latestSeq,
      expect.anything(),
      expect.anything()
    )
  })

  it('preserves the active projection and SSE when a same-thread refresh fails', async () => {
    const pending = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents
    })
    const { actions, state, sseAbortRef } = buildHarness()
    const existingBlocks: ChatBlock[] = [...state.blocks]
    const existingSse = new AbortController()
    sseAbortRef.current = existingSse

    const refresh = actions.selectThread('thread-a')
    pending.reject(new Error('refresh failed'))
    await refresh

    expect(state.threadRefreshingId).toBeNull()
    expect(state.blocks).toEqual(existingBlocks)
    expect(existingSse.signal.aborted).toBe(false)
    expect(sseAbortRef.current).toBe(existingSse)
    expect(subscribeThreadEvents).not.toHaveBeenCalled()
    expect(state.error).toContain('refresh failed')
  })

  it('keeps a cross-thread live target loading until canonical detail commits', async () => {
    const pending = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()

    const hydration = actions.subscribeThreadEventsLive('thread-b')
    expect(state.activeThreadId).toBe('thread-b')
    expect(state.threadLoadingId).toBe('thread-b')
    expect(state.blocks).toEqual([])

    pending.resolve(detail('thread-b'))
    await hydration

    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual(detail('thread-b').blocks)
  })

  it('restores running text immediately and reveals it only after replay synchronization', async () => {
    const pending = deferred<ThreadDetail>()
    let sink: ThreadEventSink | undefined
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents: vi.fn(async (
        _threadId: string,
        _sinceSeq: number,
        eventSink: ThreadEventSink
      ) => { sink = eventSink })
    })
    const { actions, state } = buildHarness()

    const hydration = actions.subscribeThreadEventsLive('thread-b')
    pending.resolve({
      blocks: [{ kind: 'user', id: 'thread-b-user', text: 'Run it' }],
      latestSeq: 12,
      threadStatus: 'running',
      latestTurnId: 'turn-b',
      latestTurnStatus: 'running',
      liveProjection: {
        assistant: {
          text: 'Partial result',
          itemId: 'thread-b-live',
          turnId: 'turn-b',
          createdAt: '2026-08-23T00:00:01.000Z'
        }
      }
    })
    await hydration

    expect(state.threadLoadingId).toBe('thread-b')
    expect(state.busy).toBe(true)
    expect(state.busyUnconfirmed).toBe(true)
    expect(state.liveAssistant).toBe('Partial result')
    expect(state.liveAssistantItemId).toBe('thread-b-live')
    sink!.onSeq(13)
    expect(state.threadLoadingId).toBe('thread-b')

    sink!.onReplaySynchronized?.(13)
    expect(state.threadLoadingId).toBeNull()
    expect(state.busyUnconfirmed).toBe(false)
    expect(state.lastSeq).toBe(13)
  })

  it('clears only the current target loading state when live detail fails', async () => {
    const pending = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents
    })
    const { actions, state } = buildHarness()

    const hydration = actions.subscribeThreadEventsLive('thread-b')
    expect(state.threadLoadingId).toBe('thread-b')
    pending.reject(new Error('network down'))
    await hydration

    expect(state.threadLoadingId).toBeNull()
    expect(state.error).toContain('network down')
    expect(subscribeThreadEvents).toHaveBeenCalledWith(
      'thread-b',
      0,
      expect.anything(),
      expect.anything()
    )
  })

  it('keeps a same-thread ready projection visible during live recovery', async () => {
    const pending = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const existingBlocks: ChatBlock[] = [...state.blocks]

    const hydration = actions.subscribeThreadEventsLive('thread-a')
    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual(existingBlocks)

    pending.resolve(detail('thread-a'))
    await hydration
    expect(state.threadLoadingId).toBeNull()
  })

  it('does not let a stale live snapshot clear or replace a newer target', async () => {
    const pending = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents
    })
    const { actions, state } = buildHarness()

    const staleHydration = actions.subscribeThreadEventsLive('thread-b')
    state.activeThreadId = 'thread-c'
    state.threadLoadingId = 'thread-c'
    state.blocks = [{ kind: 'assistant', id: 'thread-c-answer', text: 'thread-c ready' }]

    pending.resolve(detail('thread-b'))
    await staleHydration

    expect(state.activeThreadId).toBe('thread-c')
    expect(state.threadLoadingId).toBe('thread-c')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'thread-c-answer', text: 'thread-c ready' }])
    expect(subscribeThreadEvents).not.toHaveBeenCalled()
  })
})
