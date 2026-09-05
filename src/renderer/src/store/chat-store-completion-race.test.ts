import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { stopTurnCompletionPoll } from './chat-store-schedulers'
import {
  clearWatchedCompletionNotification,
  clearWatchedCompletionNotifications,
  currentCompletionWatchToken,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  createAutoPlanBuildIntent,
  patchAutoPlanBuildIntent,
  saveAutoPlanBuildIntent
} from '../plan/auto-plan-build-intents'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

function makeHarness(initial: Partial<ChatState> = {}): {
  getState: () => ChatState
  set: ChatStoreSet
  get: () => ChatState
} {
  let state: ChatState = {
    activeThreadId: 'thr_aba',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn_B',
    currentTurnUserId: 'u_B',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: [],
    recoverActiveTurn: vi.fn().mockResolvedValue(false),
    refreshThreads: vi.fn(async () => undefined),
    ...initial
  } as ChatState
  return {
    getState: () => state,
    set: (partial) => {
      const update =
        typeof partial === 'function'
          ? (partial as (s: ChatState) => Partial<ChatState>)(state)
          : partial
      state = { ...state, ...update }
    },
    get: () => state
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('background completion poll turn-identity race', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    clearWatchedCompletionNotifications()
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopTurnCompletionPoll()
    clearWatchedCompletionNotifications()
    vi.useRealTimers()
  })

  it('does not let an old turn terminal result clear a newer turn watch (ABA)', async () => {
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', {
      kunGui: { showTurnCompleteNotification }
    })

    // Watch turn A is armed first; the poll request starts and stays in flight.
    watchTurnCompletionNotification('thr_aba', 1_000)
    const firstWatchToken = currentCompletionWatchToken('thr_aba')
    expect(firstWatchToken).toBeTruthy()
    const pending = deferred<{
      status: string
      latestTurnId: string
      latestTurnStatus: string
    }>()
    registryMock.getProvider.mockReturnValue({
      // Only the first (turn-A) poll request stays in flight; later ticks read
      // the current runtime state, which reports the newer turn B as running.
      getThreadState: vi.fn()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValue({
          status: 'running',
          latestTurnId: 'turn_B',
          latestTurnStatus: 'running'
        })
    })
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_aba: true },
      // The thread currently shows the newer turn B as running.
      threads: [{
        id: 'thr_aba',
        title: 'Aba',
        updatedAt: '2026-06-12T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        status: 'running',
        latestTurnId: 'turn_B',
        latestTurnStatus: 'running'
      }]
    })
    syncTurnCompletionPoll(h.set, h.get)
    await vi.advanceTimersByTimeAsync(0)

    // The user reopens the thread (watch removed), turn B starts, then the user
    // switches away, recreating a fresh watch with a new token.
    clearWatchedCompletionNotification('thr_aba')
    h.set({ watchTurnCompletion: {} })
    h.set({
      watchTurnCompletion: { thr_aba: true },
      currentTurnId: 'turn_B',
      threads: [{
        id: 'thr_aba',
        title: 'Aba',
        updatedAt: '2026-06-12T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        status: 'running',
        latestTurnId: 'turn_B',
        latestTurnStatus: 'running'
      }]
    })
    watchTurnCompletionNotification('thr_aba', 2_000)
    const secondWatchToken = currentCompletionWatchToken('thr_aba')
    expect(secondWatchToken).not.toBe(firstWatchToken)

    // The old poll for turn A finally resolves as completed.
    pending.resolve({
      status: 'running',
      latestTurnId: 'turn_A',
      latestTurnStatus: 'completed'
    })
    await vi.advanceTimersByTimeAsync(2_500)

    // The newer turn-B watch must survive, the sidebar must still show B
    // running, no completion notification or unread may be produced for A.
    expect(h.getState().watchTurnCompletion).toEqual({ thr_aba: true })
    expect(currentCompletionWatchToken('thr_aba')).toBe(secondWatchToken)
    expect(h.getState().threads[0]).toMatchObject({
      status: 'running',
      latestTurnId: 'turn_B',
      latestTurnStatus: 'running'
    })
    expect(h.getState().unreadThreadIds).toEqual({})
    expect(showTurnCompleteNotification).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('claims a terminal watch once and notifies only for the claimed result', async () => {
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', {
      kunGui: { showTurnCompleteNotification }
    })

    watchTurnCompletionNotification('thr_once', 1_000)
    registryMock.getProvider.mockReturnValue({
      getThreadState: vi.fn(async () => ({
        status: 'running',
        latestTurnId: 'turn_once',
        latestTurnStatus: 'completed'
      }))
    })
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_once: true },
      threads: [{
        id: 'thr_once',
        title: 'Once',
        updatedAt: '2026-06-12T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        status: 'running'
      }]
    })
    syncTurnCompletionPoll(h.set, h.get)
    await vi.advanceTimersByTimeAsync(2_500)

    expect(h.getState().watchTurnCompletion).toEqual({})
    expect(h.getState().threads[0]).toMatchObject({
      status: 'idle',
      latestTurnId: 'turn_once',
      latestTurnStatus: 'completed'
    })
    expect(showTurnCompleteNotification).toHaveBeenCalledTimes(1)

    // A second poll tick after the claim sees no watch and must not notify again.
    await vi.advanceTimersByTimeAsync(2_500)
    expect(showTurnCompleteNotification).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('claims a watched auto-plan completion without unread or notification', async () => {
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      kunGui: { showTurnCompleteNotification }
    })
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/auto.md',
      relativePath: '.kunsdd/plan/auto.md',
      workspaceRoot: '/repo',
      threadId: 'thr_auto',
      selection: { buildMode: 'direct', useWorktree: false }
    })
    saveAutoPlanBuildIntent(intent)
    patchAutoPlanBuildIntent(intent.id, { planTurnId: 'turn_plan_auto', status: 'planning' })

    watchTurnCompletionNotification('thr_auto', 1_000)
    registryMock.getProvider.mockReturnValue({
      getThreadState: vi.fn(async () => ({
        status: 'running',
        latestTurnId: 'turn_plan_auto',
        latestTurnStatus: 'completed'
      }))
    })
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_auto: true },
      threads: [{
        id: 'thr_auto',
        title: 'Auto',
        updatedAt: '2026-06-12T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        status: 'running'
      }]
    })
    syncTurnCompletionPoll(h.set, h.get)
    await vi.advanceTimersByTimeAsync(2_500)

    expect(h.getState().watchTurnCompletion).toEqual({})
    expect(h.getState().unreadThreadIds).toEqual({})
    expect(showTurnCompleteNotification).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
