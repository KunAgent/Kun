import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  clearThreadSnapshotCache,
  getThreadSnapshot,
  invalidateThreadSnapshot,
  threadSnapshotFingerprint
} from './thread-snapshot-cache'
import { requestThreadPrewarm, resetThreadPrewarmState } from './thread-detail-prewarm'
import { runtimeErrorToError } from '@shared/runtime-error'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

type ThreadDetail = {
  blocks: Array<{ kind: 'user' | 'assistant'; id: string; text: string }>
  latestSeq: number
  threadStatus: 'idle'
  model?: string
}

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function thread(
  id: string,
  overrides: Partial<NormalizedThread> = {}
): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: '',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle',
    ...overrides
  }
}

function buildHarness(): { actions: ReturnType<typeof createThreadActions>; state: ChatState } {
  let state: ChatState
  state = {
    activeThreadId: null,
    blocks: [],
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
    composerReasoningEffort: 'max',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [],
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {}
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  return { actions, state }
}

function detail(blocks: ThreadDetail['blocks'] = [], model = ''): ThreadDetail {
  return {
    blocks,
    latestSeq: blocks.length,
    threadStatus: 'idle',
    ...(model ? { model } : {})
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('thread selection prewarm hydration', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    resetThreadPrewarmState()
    vi.stubGlobal('localStorage', new MemoryStorage())
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    resetThreadPrewarmState()
    clearThreadSnapshotCache()
    vi.unstubAllGlobals()
  })

  it('switches synchronously when a settled thread detail was already prewarmed', async () => {
    const getThreadDetail = vi.fn(async () => detail([
      { kind: 'assistant', id: 'answer-b', text: 'already ready' }
    ]))
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]
    state.blocks = [{ kind: 'assistant', id: 'answer-a', text: 'thread a' }]

    requestThreadPrewarm(target)
    await flushAsyncWork()
    expect(getThreadSnapshot(target.id, threadSnapshotFingerprint(target))).not.toBeNull()

    const selecting = actions.selectThread(target.id)
    expect(state.activeThreadId).toBe(target.id)
    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'already ready' }
    ])
    await selecting
    expect(getThreadDetail).toHaveBeenCalledTimes(1)
  })

  it('reuses an in-flight prewarm request when the thread is selected', async () => {
    const pending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn(() => pending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.activeThreadId).toBe(target.id)
    expect(state.threadLoadingId).toBe(target.id)

    pending.resolve(detail([
      { kind: 'assistant', id: 'answer-b', text: 'shared request' }
    ]))
    await selecting

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'shared request' }
    ])
  })

  it('refetches when the thread advances while an awaited prewarm is in flight', async () => {
    const prewarmPending = deferred<ThreadDetail>()
    const freshPending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn()
      .mockImplementationOnce(() => prewarmPending.promise)
      .mockImplementationOnce(() => freshPending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    const advanced = thread('thread-b', {
      updatedAt: '2026-06-09T00:05:00.000Z',
      latestSeq: 3
    })
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)

    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    // The sidebar refreshed the thread metadata while the prewarm request
    // was still awaited by selectThread, so its detail is stale on arrival.
    state.threads = [thread('thread-a'), advanced]
    prewarmPending.resolve(detail([
      { kind: 'assistant', id: 'stale-b', text: 'outdated blocks' }
    ]))
    await Promise.resolve()
    await Promise.resolve()

    expect(getThreadDetail).toHaveBeenCalledTimes(2)
    expect(state.blocks).toEqual([])

    freshPending.resolve(detail([
      { kind: 'assistant', id: 'answer-b', text: 'fresh blocks' }
    ]))
    await selecting

    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'fresh blocks' }
    ])
    const cached = getThreadSnapshot(target.id, threadSnapshotFingerprint(advanced))
    expect(cached?.blocks.map((block) => block.id)).not.toContain('stale-b')
  })

  it('refetches when the prewarm snapshot cache token is invalidated mid-flight', async () => {
    const prewarmPending = deferred<ThreadDetail>()
    const freshPending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn()
      .mockImplementationOnce(() => prewarmPending.promise)
      .mockImplementationOnce(() => freshPending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)

    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    invalidateThreadSnapshot(target.id)
    prewarmPending.resolve(detail([
      { kind: 'assistant', id: 'stale-b', text: 'outdated blocks' }
    ]))
    await Promise.resolve()
    await Promise.resolve()

    expect(getThreadDetail).toHaveBeenCalledTimes(2)

    freshPending.resolve(detail([
      { kind: 'assistant', id: 'answer-b', text: 'fresh blocks' }
    ]))
    await selecting

    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'fresh blocks' }
    ])
  })

  it('refetches in the foreground when an awaited prewarm request is aborted', async () => {
    const prewarmPending = deferred<ThreadDetail>()
    const freshPending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn()
      .mockImplementationOnce(() => prewarmPending.promise)
      .mockImplementationOnce(() => freshPending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    // The prewarm controller aborted for its own reasons (hover leave,
    // foreground recovery) while selectThread awaited its shared promise.
    prewarmPending.reject(new DOMException('signal is aborted without reason', 'AbortError'))
    await Promise.resolve()
    await Promise.resolve()
    expect(getThreadDetail).toHaveBeenCalledTimes(2)

    freshPending.resolve(detail([
      { kind: 'assistant', id: 'answer-b', text: 'foreground fallback' }
    ]))
    await selecting

    expect(state.error).toBeNull()
    expect(state.threadLoadingId).toBeNull()
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'foreground fallback' }
    ])
  })

  it('stays silent when the selection itself is cancelled mid-hydration', async () => {
    const prewarmPending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn(() => prewarmPending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    // Switching to another thread aborts the first selection's hydration.
    await actions.selectThread('thread-a')
    prewarmPending.reject(new DOMException('The operation was aborted.', 'AbortError'))
    await selecting

    expect(state.error).toBeNull()
  })

  it('does not refetch when the prewarm request succeeds and stays current', async () => {
    const pending = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn(() => pending.promise)
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    requestThreadPrewarm(target)
    const selecting = actions.selectThread(target.id)
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    pending.resolve(detail([
      { kind: 'assistant', id: 'answer-b', text: 'shared request' }
    ]))
    await selecting

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(state.error).toBeNull()
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'answer-b', text: 'shared request' }
    ])
  })

  it('surfaces a real error whose message merely mentions "aborted"', async () => {
    const getThreadDetail = vi.fn(() => Promise.reject(new Error('transaction aborted')))
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    await actions.selectThread(target.id)

    expect(state.error).toContain('transaction aborted')
    expect(state.threadLoadingId).toBeNull()
  })

  it('stays silent when hydration rejects with the Kun aborted error code', async () => {
    const getThreadDetail = vi.fn(() => Promise.reject(
      runtimeErrorToError({ code: 'aborted', message: 'Runtime request was cancelled.' })
    ))
    registryMock.getProvider.mockReturnValue({
      getThreadDetail,
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    const target = thread('thread-b')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a'), target]

    await actions.selectThread(target.id)

    expect(state.error).toBeNull()
    expect(state.threadLoadingId).toBeNull()
  })

})
