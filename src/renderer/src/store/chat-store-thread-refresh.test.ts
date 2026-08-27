import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

function deferredValue<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
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

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
  activeStream: AbortController
} {
  let state = {
    activeThreadId: 'thr_existing',
    blocks: [] as ChatBlock[],
    busy: false,
    busyUnconfirmed: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerPickList: [],
    composerModelGroups: [],
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 1,
    liveAssistant: '',
    liveDeltaSeqFloor: 1,
    liveReasoning: '',
    queuedMessages: [],
    route: 'chat',
    runtimeConnection: 'ready',
    threadHasMoreHistory: false,
    threadHistoryCursor: null,
    threadHistoryLoading: false,
    threadLoadingId: null,
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    unreadThreadIds: {},
    watchTurnCompletion: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const activeStream = new AbortController()
  const actions = createThreadActions({ set, get, sseAbortRef: { current: activeStream } })
  state = Object.assign(state, actions)
  return { actions, state, activeStream }
}

function providerFor<T>(detail: ReturnType<typeof deferredValue<T>>): void {
  registryMock.getProvider.mockReturnValue({
    getThreadDetail: vi.fn(() => detail.promise),
    subscribeThreadEvents: vi.fn(async () => undefined)
  })
}

describe('same-thread detail refresh', () => {
  beforeEach(() => registryMock.getProvider.mockReset())

  it('keeps the current projection until refreshed detail replaces it', async () => {
    const detail = deferredValue<{
      blocks: ChatBlock[]
      latestSeq: number
      threadStatus: 'idle'
    }>()
    providerFor(detail)
    const { actions, state, activeStream } = buildHarness()
    const previous = [{ kind: 'assistant' as const, id: 'old-answer', text: 'old answer' }]
    state.blocks = previous

    const refreshing = actions.selectThread('thr_existing')
    expect(state.threadLoadingId).toBe('thr_existing')
    expect(state.blocks).toBe(previous)
    expect(activeStream.signal.aborted).toBe(false)

    detail.resolve({
      blocks: [{ kind: 'assistant', id: 'new-answer', text: 'new answer' }],
      latestSeq: 2,
      threadStatus: 'idle'
    })
    await refreshing

    expect(state.threadLoadingId).toBeNull()
    expect(activeStream.signal.aborted).toBe(true)
    expect(state.blocks).toEqual([
      expect.objectContaining({ id: 'new-answer', text: 'new answer' })
    ])
  })

  it('keeps the current projection when refresh fails', async () => {
    const detail = deferredValue<never>()
    providerFor(detail)
    const { actions, state, activeStream } = buildHarness()
    const previous = [{ kind: 'assistant' as const, id: 'old-answer', text: 'old answer' }]
    state.blocks = previous

    const refreshing = actions.selectThread('thr_existing')
    detail.reject(new Error('detail unavailable'))
    await refreshing

    expect(state.threadLoadingId).toBeNull()
    expect(activeStream.signal.aborted).toBe(false)
    expect(state.blocks).toBe(previous)
    expect(state.error).toContain('detail unavailable')
  })

  it('clears the previous projection while another thread hydrates', async () => {
    const detail = deferredValue<never>()
    providerFor(detail)
    const { actions, state, activeStream } = buildHarness()
    state.blocks = [{ kind: 'assistant', id: 'old-answer', text: 'old answer' }]
    state.threads = [thread('thr_existing'), thread('thr_next')]

    const selecting = actions.selectThread('thr_next')
    expect(state.activeThreadId).toBe('thr_next')
    expect(activeStream.signal.aborted).toBe(true)
    expect(state.threadLoadingId).toBe('thr_next')
    expect(state.blocks).toEqual([])

    detail.reject(new Error('detail unavailable'))
    await selecting
  })
})
