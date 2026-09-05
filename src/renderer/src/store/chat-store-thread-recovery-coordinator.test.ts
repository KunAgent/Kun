import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createThreadActions } from './chat-store-thread-actions'
import { resetThreadRecoveryCoordinator } from './thread-recovery-coordinator'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

function harness() {
  let state = {
    activeThreadId: 'thread-recovery',
    blocks: [],
    busy: true,
    busyUnconfirmed: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    lastSeq: 0,
    queuedMessages: [],
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [],
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    watchTurnCompletion: {}
  } as unknown as ChatState
  const sseAbortRef = { current: null as AbortController | null }
  const actionsHolder: { current: ReturnType<typeof createThreadActions> | null } = { current: null }
  // The deadline callback resolves recovery through the store, so `get()` must
  // expose the actions in addition to state. Spreading keeps a fresh snapshot
  // per call, matching the real store's snapshot semantics.
  const get: ChatStoreGet = () => ({ ...state, ...(actionsHolder.current ?? {}) }) as unknown as ChatState
  const set: ChatStoreSet = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const actions = createThreadActions({ set, get, sseAbortRef })
  actionsHolder.current = actions
  return { state: () => state, actions }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function runningDetail() {
  return {
    blocks: [{ id: 'u1', kind: 'user', text: 'recover once' }],
    latestSeq: 4,
    threadStatus: 'running',
    latestTurnId: 'turn_1',
    latestTurnStatus: 'running',
    latestTurnOrchestration: 'direct',
    latestUserMessageId: 'u1'
  }
}

// A stream that stays open but never emits a sync barrier, completion, or
// error, and never disconnects: the half-open state this suite targets.
function halfOpenProvider() {
  return {
    getThreadState: vi.fn(async () => ({
      status: 'idle',
      updatedAt: '2026-09-03T00:00:00.000Z',
      latestSeq: 0,
      replayFloorSeq: 0,
      latestTurnId: null,
      latestTurnStatus: 'idle',
      latestTurnOrchestration: 'direct'
    })),
    getThreadDetail: vi.fn(async () => runningDetail()),
    subscribeThreadEvents: vi.fn(async () => new Promise<never>(() => undefined))
  }
}

describe('coordinated active-thread recovery', () => {
  beforeEach(() => {
    resetThreadRecoveryCoordinator()
    registryMock.getProvider.mockReset()
  })
  afterEach(() => resetThreadRecoveryCoordinator())

  it('coalesces concurrent triggers into one timeline read', async () => {
    const detail = deferred<Record<string, unknown>>()
    const provider = {
      getThreadDetail: vi.fn(() => detail.promise as never),
      subscribeThreadEvents: vi.fn(async () => new Promise(() => undefined))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const { actions } = harness()
    const first = actions.recoverActiveTurn({ reason: 'watchdog' })
    const second = actions.recoverActiveTurn({ reason: 'manual_retry' })
    await Promise.resolve()
    expect(provider.getThreadDetail).toHaveBeenCalledOnce()
    detail.resolve(runningDetail())
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(provider.subscribeThreadEvents).toHaveBeenCalledOnce()
  })

  it('uses lightweight state and cursor replay for trusted content', async () => {
    const provider = {
      getThreadState: vi.fn(async () => ({
        status: 'running', updatedAt: '2026-09-03T00:00:00.000Z',
        latestSeq: 12, replayFloorSeq: 8, latestTurnId: 'turn_1',
        latestTurnStatus: 'running', latestTurnOrchestration: 'direct' as const
      })),
      getThreadDetail: vi.fn(),
      subscribeThreadEvents: vi.fn(async () => new Promise(() => undefined))
    }
    registryMock.getProvider.mockReturnValue(provider)
    const test = harness()
    Object.assign(test.state(), {
      blocks: [{ id: 'u1', kind: 'user', text: 'trusted' }],
      lastSeq: 10,
      currentTurnId: 'turn_1'
    })
    await expect(test.actions.recoverActiveTurn({ reason: 'sse_disconnect' })).resolves.toBe(true)
    expect(provider.getThreadState).toHaveBeenCalledOnce()
    expect(provider.getThreadDetail).not.toHaveBeenCalled()
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thread-recovery', 10, expect.any(Object), expect.any(AbortSignal)
    )
  })

  it('starts exactly one new physical recovery when manual_retry supersedes a half-open stream', async () => {
    const provider = halfOpenProvider()
    registryMock.getProvider.mockReturnValue(provider)
    const { actions } = harness()

    await expect(actions.recoverActiveTurn({ reason: 'watchdog' })).resolves.toBe(true)
    expect(provider.getThreadDetail).toHaveBeenCalledOnce()
    expect(provider.subscribeThreadEvents).toHaveBeenCalledOnce()

    await expect(actions.recoverActiveTurn({ reason: 'manual_retry' })).resolves.toBe(true)
    expect(provider.getThreadDetail).toHaveBeenCalledTimes(2)
    expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2)
  })

  it('forces a timeline hydration when the catch-up deadline expires on a half-open stream', async () => {
    vi.useFakeTimers()
    try {
      const provider = halfOpenProvider()
      registryMock.getProvider.mockReturnValue(provider)
      const { actions } = harness()

      await actions.recoverActiveTurn({ reason: 'watchdog' })
      expect(provider.getThreadDetail).toHaveBeenCalledOnce()
      expect(provider.subscribeThreadEvents).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(30_000)
      await Promise.resolve()

      // The deadline recovery forces a full timeline read and skips the
      // lightweight state probe, then establishes a fresh subscription.
      expect(provider.getThreadDetail).toHaveBeenCalledTimes(2)
      expect(provider.getThreadState).not.toHaveBeenCalled()
      expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
