import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { clearThreadSnapshotCache } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-23T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running',
    ...overrides
  }
}

function buildHarness(busyUnconfirmed = false): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_a',
    activeThreadRelation: 'primary',
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    awaitingUserInputThreadIds: {},
    blocks: [{ kind: 'user', id: 'a-user', text: 'Run the long task' }],
    busy: true,
    busyUnconfirmed,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerPickList: [],
    composerModelGroups: [],
    composerProviderId: '',
    currentTurnId: 'turn_a',
    currentTurnOrchestration: 'direct',
    currentTurnUserId: 'a-user',
    error: null,
    extensionComposerContexts: [],
    lastSeq: 11,
    liveDeltaSeqFloor: 11,
    liveReasoning: 'Still working',
    liveReasoningItemId: 'reasoning_a',
    liveReasoningTurnId: 'turn_a',
    liveReasoningCreatedAt: '2026-08-23T00:00:01.000Z',
    liveAssistant: '',
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
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
    threads: [
      thread('thr_a', {
        latestSeq: 11,
        latestTurnId: 'turn_a',
        latestTurnStatus: 'running'
      }),
      thread('thr_b', {
        status: 'idle',
        latestSeq: 22,
        latestTurnId: 'turn_b',
        latestTurnStatus: 'completed'
      })
    ]
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  return { actions, state }
}

function settledDetail() {
  return {
    blocks: [{ kind: 'assistant' as const, id: 'b-answer', text: 'B' }],
    latestSeq: 22,
    threadStatus: 'idle',
    latestTurnId: 'turn_b',
    latestTurnStatus: 'completed'
  }
}

describe('running thread parked projection resume', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    registryMock.getProvider.mockReset()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
  })

  afterEach(() => {
    clearThreadSnapshotCache()
    vi.unstubAllGlobals()
  })

  it('keeps a parked running thread covered until replay is explicitly synchronized', async () => {
    const sinks = new Map<string, ThreadEventSink>()
    const subscribeThreadEvents = vi.fn(async (
      id: string,
      _sinceSeq: number,
      sink: ThreadEventSink
    ) => {
      sinks.set(id, sink)
    })
    const getThreadDetail = vi.fn(async (id: string) => {
      if (id === 'thr_b') return settledDetail()
      throw new Error(`unexpected detail request for ${id}`)
    })
    registryMock.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents })
    const { actions, state } = buildHarness()

    await actions.selectThread('thr_b')
    state.threads = state.threads.map((candidate) => candidate.id === 'thr_a'
      ? { ...candidate, updatedAt: '2026-08-23T00:01:00.000Z', latestSeq: 15 }
      : candidate)

    const selecting = actions.selectThread('thr_a')

    expect(state.activeThreadId).toBe('thr_a')
    expect(state.threadLoadingId).toBe('thr_a')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'a-user', text: 'Run the long task' }])
    expect(state.busy).toBe(true)
    expect(state.busyUnconfirmed).toBe(false)
    expect(state.liveReasoning).toBe('Still working')
    expect(state.liveReasoningItemId).toBe('reasoning_a')
    expect(state.liveReasoningTurnId).toBe('turn_a')
    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    await selecting
    expect(subscribeThreadEvents).toHaveBeenLastCalledWith(
      'thr_a',
      11,
      expect.anything(),
      expect.anything()
    )

    const resumedSink = sinks.get('thr_a')
    expect(resumedSink).toBeDefined()
    resumedSink!.onDeltas([{
      kind: 'agent_message',
      text: 'Caught up',
      seq: 15,
      itemId: 'assistant_a',
      turnId: 'turn_a'
    }])
    expect(state.threadLoadingId).toBe('thr_a')
    resumedSink!.onSeq(15)
    expect(state.threadLoadingId).toBe('thr_a')
    resumedSink!.onReplaySynchronized?.(15)
    expect(state.threadLoadingId).toBeNull()
    expect(state.liveAssistant).toBe('Caught up')
    expect(state.liveAssistantItemId).toBe('assistant_a')
    expect(state.liveAssistantTurnId).toBe('turn_a')
    expect(state.lastSeq).toBe(15)

    resumedSink!.onTurnComplete({
      threadId: 'thr_a',
      turnId: 'turn_a',
      status: 'completed',
      seq: 16
    })
    expect(state.busy).toBe(false)
    expect(state.busyUnconfirmed).toBe(false)
    expect(state.currentTurnId).toBeNull()
  })

  it('preserves the unconfirmed guard for an exact parked snapshot', async () => {
    const getThreadDetail = vi.fn(async (id: string) => {
      if (id === 'thr_b') return settledDetail()
      throw new Error(`unexpected detail request for ${id}`)
    })
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness(true)

    await actions.selectThread('thr_b')
    await actions.selectThread('thr_a')

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.busy).toBe(true)
    expect(state.busyUnconfirmed).toBe(true)
    expect(state.threadLoadingId).toBe('thr_a')
  })

  it('reveals the cached projection when catch-up replay must recover', async () => {
    let resumedSink: ThreadEventSink | undefined
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async (id: string) => {
        if (id === 'thr_b') return settledDetail()
        throw new Error(`unexpected detail request for ${id}`)
      }),
      subscribeThreadEvents: vi.fn(async (id: string, _sinceSeq: number, sink: ThreadEventSink) => {
        if (id === 'thr_a') resumedSink = sink
      })
    })
    const { actions, state } = buildHarness()

    await actions.selectThread('thr_b')
    state.threads = state.threads.map((candidate) => candidate.id === 'thr_a'
      ? { ...candidate, updatedAt: '2026-08-23T00:01:00.000Z', latestSeq: 15 }
      : candidate)
    await actions.selectThread('thr_a')

    expect(state.threadLoadingId).toBe('thr_a')
    resumedSink!.onError(new Error('replay connection lost'))
    expect(state.threadLoadingId).toBeNull()
    expect(state.error).toContain('replay connection lost')
  })

  it('keeps live identity isolated while repeatedly switching running threads', async () => {
    const sinks = new Map<string, ThreadEventSink>()
    const getThreadDetail = vi.fn(async (id: string) => {
      if (id !== 'thr_b') throw new Error(`unexpected detail request for ${id}`)
      return {
        blocks: [{ kind: 'user' as const, id: 'b-user', turnId: 'turn_b', text: 'Run B' }],
        latestSeq: 22,
        threadStatus: 'running',
        latestTurnId: 'turn_b',
        latestTurnStatus: 'running'
      }
    })
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async (
        id: string,
        _sinceSeq: number,
        sink: ThreadEventSink
      ) => { sinks.set(id, sink) })
    })
    const { actions, state } = buildHarness()
    state.threads = state.threads.map((candidate) => candidate.id === 'thr_b'
      ? {
          ...candidate,
          status: 'running',
          latestSeq: 22,
          latestTurnId: 'turn_b',
          latestTurnStatus: 'running'
        }
      : candidate)

    await actions.selectThread('thr_b')
    sinks.get('thr_b')!.onReplaySynchronized?.(22)
    sinks.get('thr_b')!.onDeltas([{
      kind: 'agent_message',
      text: 'B is working',
      seq: 23,
      itemId: 'assistant_b',
      turnId: 'turn_b'
    }])

    await actions.selectThread('thr_a')
    sinks.get('thr_a')!.onReplaySynchronized?.(11)
    expect(state.liveReasoning).toBe('Still working')
    expect(state.liveReasoningItemId).toBe('reasoning_a')
    expect(state.liveReasoningTurnId).toBe('turn_a')
    expect(state.blocks.some((block) => block.turnId === 'turn_b')).toBe(false)

    sinks.get('thr_a')!.onDeltas([{
      kind: 'agent_reasoning',
      text: ' on A',
      seq: 12,
      itemId: 'reasoning_a',
      turnId: 'turn_a'
    }])
    await actions.selectThread('thr_b')
    sinks.get('thr_b')!.onReplaySynchronized?.(23)
    expect(state.liveAssistant).toBe('B is working')
    expect(state.liveAssistantItemId).toBe('assistant_b')
    expect(state.liveAssistantTurnId).toBe('turn_b')
    expect(state.blocks.some((block) => block.turnId === 'turn_a')).toBe(false)

    await actions.selectThread('thr_a')
    sinks.get('thr_a')!.onReplaySynchronized?.(12)
    expect(state.liveReasoning).toBe('Still working on A')
    expect(state.liveReasoningItemId).toBe('reasoning_a')
    expect(state.liveReasoningTurnId).toBe('turn_a')
    expect(getThreadDetail).toHaveBeenCalledTimes(1)
  })
})
