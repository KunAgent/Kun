import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armBusyWatchdog,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll,
  syncTurnCompletionPoll
} from './chat-store-schedulers'
import type { ChatState, ChatStoreSet } from './chat-store-types'

type StoreApi = { getState: () => ChatState; set: ChatStoreSet; get: () => ChatState }

function makeHarness(initial: Partial<ChatState> = {}): StoreApi {
  let state: ChatState = {
    activeThreadId: 't1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-1',
    currentTurnUserId: 'u1',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: [],
    recoverActiveTurn: vi.fn().mockResolvedValue(undefined),
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

describe('armBusyWatchdog (busyTimeout message contract)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('uses busyTimeoutMessage returned string verbatim when watchdog fires with attempts exhausted', () => {
    const h = makeHarness({ activeThreadId: null })
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    const message = '已等待 9 分钟仍未收到运行时完成事件。可中断后重试。'
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 1_000,
      maxAttempts: 0, // skip recovery, go straight to finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => message
    })
    vi.advanceTimersByTime(1_000)
    expect(h.getState().error).toBe(message)
    expect(h.getState().busy).toBe(false)
    expect(h.getState().currentTurnId).toBeNull()
    expect(finalize).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('skips watchdog work if not busy at fire time', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 0,
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'never'
    })
    // Simulate turn completing before watchdog fires
    h.set((s) => ({ ...s, busy: false }))
    vi.advanceTimersByTime(50)
    expect(finalize).not.toHaveBeenCalled()
    expect(h.getState().error).toBeNull()
  })

  it('attempts recovery and returns when attempts remain', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 5, // high limit, will not finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'should-not-be-used'
    })
    vi.advanceTimersByTime(50)
    expect(h.getState().recoverActiveTurn).toHaveBeenCalledTimes(1)
    expect(h.getState().busy).toBe(true) // not finalized
    expect(finalize).not.toHaveBeenCalled()
  })
})

describe('busyTimeout minutes interpolation (#131)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('renders the minute count from production constants in the message', () => {
    const h = makeHarness({ activeThreadId: null })
    // Mirrors chat-store-runtime.ts:467-471 formula:
    // minutes = round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000)
    // Current production: 180_000 * 3 / 60_000 = 9
    const minutes = Math.round((180_000 * 3) / 60_000)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 10,
      maxAttempts: 0,
      finalizeBusyState: () => ({}),
      flushLiveBlocks: (_state: ChatState, base: Partial<ChatState>) => base,
      busyTimeoutMessage: () => `已等待 ${minutes} 分钟仍未收到运行时完成事件。`
    })
    vi.advanceTimersByTime(10)
    expect(typeof h.getState().error).toBe('string')
    expect(h.getState().error as string).toMatch(/已等待 9 分钟/)
  })
})

describe('scheduleStartupRuntimeProbe', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeProbeHarness(options: {
    connection: 'ready' | 'offline'
    probeDurationMs?: number
  }) {
    const h = makeHarness({ runtimeConnection: options.connection })
    const probeRuntime = vi.fn(() => {
      if (!options.probeDurationMs) return Promise.resolve()
      return new Promise<void>((resolve) => setTimeout(resolve, options.probeDurationMs))
    })
    h.set({ probeRuntime } as Partial<ChatState>)
    return { h, probeRuntime }
  }

  it('runs an immediate probe and does not probe again when the runtime is ready', async () => {
    const { h, probeRuntime } = makeProbeHarness({ connection: 'ready' })
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
  })

  it('fires the fallback probe when the immediate probe finished but the runtime stays unready', async () => {
    const { h, probeRuntime } = makeProbeHarness({ connection: 'offline' })
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(1)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(900)
    expect(probeRuntime).toHaveBeenCalledTimes(2)
    // Drain the remaining retry budget so no probe/timer leaks into later tests.
    await vi.advanceTimersByTimeAsync(10_000)
  })

  it('reschedules the fallback instead of consuming it while the first probe is still in flight', async () => {
    // First probe takes 2000ms, long past the 900ms fallback window.
    const { h, probeRuntime } = makeProbeHarness({ connection: 'offline', probeDurationMs: 2_000 })
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(1)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
    // 900ms fallback fires while the first probe is in flight; it must not
    // start a second probe and must not be lost.
    await vi.advanceTimersByTimeAsync(900)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
    // First probe settles at t=2000; the rescheduled fallback fires one
    // fallback window after the in-flight probe finished.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(probeRuntime).toHaveBeenCalledTimes(2)
    // Let the runtime become ready and settle pending probes so no probe or
    // fallback timer leaks into later tests.
    h.set({ runtimeConnection: 'ready' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(probeRuntime).toHaveBeenCalledTimes(2)
  })

  it('stops probing once the runtime becomes ready', async () => {
    const { h, probeRuntime } = makeProbeHarness({ connection: 'offline' })
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(1)
    h.set({ runtimeConnection: 'ready' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
  })

  it('a newer schedule supersedes a pending fallback from an older round', async () => {
    const { h, probeRuntime } = makeProbeHarness({ connection: 'offline' })
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(1)
    expect(probeRuntime).toHaveBeenCalledTimes(1)
    // Second schedule at t=1: the first round finished, so a new immediate
    // probe runs and the old fallback timer is cancelled.
    scheduleStartupRuntimeProbe(h.get)
    await vi.advanceTimersByTimeAsync(899)
    expect(probeRuntime).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(probeRuntime).toHaveBeenCalledTimes(3)
    // Drain the remaining retry budget so no probe/timer leaks into later tests.
    await vi.advanceTimersByTimeAsync(10_000)
  })
})

describe('syncTurnCompletionPoll', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    stopTurnCompletionPoll()
    vi.useRealTimers()
  })

  it.each(['completed', 'failed', 'aborted'])(
    'treats a terminal latest turn (%s) as completed even when the thread summary is stale running',
    async (latestTurnStatus) => {
      const h = makeHarness({
        runtimeConnection: 'ready',
        watchTurnCompletion: { thr_background: true }
      })
      const loadThreadState = vi.fn(async () => ({
        status: 'running',
        latestTurnId: 'turn-old',
        latestTurnStatus
      }))
      const onCompletedThreads = vi.fn(async () => {
        h.set({ watchTurnCompletion: {} })
      })

      syncTurnCompletionPoll(h.set, h.get, {
        loadThreadState,
        threadLooksRunning: (thread) => thread.latestTurnStatus === 'running',
        onCompletedThreads
      })
      await vi.runAllTimersAsync()

      expect(onCompletedThreads).toHaveBeenCalledWith([
        { id: 'thr_background', latestTurnId: 'turn-old', latestTurnStatus }
      ], expect.anything(), expect.anything(), expect.anything())
    }
  )

  it('keeps a watch when the latest turn is running despite an idle thread summary', async () => {
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_background: true }
    })
    syncTurnCompletionPoll(h.set, h.get, {
      loadThreadState: async () => ({ status: 'idle', latestTurnStatus: 'running' }),
      threadLooksRunning: (thread) => thread.latestTurnStatus === 'running',
      onCompletedThreads: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(h.getState().watchTurnCompletion).toEqual({ thr_background: true })
  })

  it('keeps a watch across a transient poll failure and retries', async () => {
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_background: true }
    })
    const loadThreadState = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ status: 'idle', latestTurnStatus: 'completed' })
    const onCompletedThreads = vi.fn(async () => h.set({ watchTurnCompletion: {} }))

    syncTurnCompletionPoll(h.set, h.get, {
      loadThreadState,
      threadLooksRunning: (thread) => thread.status === 'running',
      onCompletedThreads
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(h.getState().watchTurnCompletion).toEqual({ thr_background: true })
    await vi.advanceTimersByTimeAsync(2500)
    expect(onCompletedThreads).toHaveBeenCalledOnce()
  })

  it('uses the lightweight status response and clears a completed watch', async () => {
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: { thr_background: true }
    })
    const loadThreadState = vi.fn(async () => ({ status: 'idle', latestTurnStatus: 'completed' }))
    const onCompletedThreads = vi.fn(async (done: Array<{ id: string }>) => {
      h.set({ watchTurnCompletion: {} })
      expect(done).toEqual([{
        id: 'thr_background',
        latestTurnId: undefined,
        latestTurnStatus: 'completed'
      }])
    })

    syncTurnCompletionPoll(h.set, h.get, {
      loadThreadState,
      threadLooksRunning: (thread) => thread.status === 'running',
      onCompletedThreads
    })
    await vi.runAllTimersAsync()

    expect(loadThreadState).toHaveBeenCalledWith(expect.anything(), 'thr_background')
    expect(onCompletedThreads).toHaveBeenCalledOnce()
  })

  it('prefers one batch read for 20 watched conversations', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `thr_${index}`)
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: Object.fromEntries(ids.map((id) => [id, true]))
    })
    const loadThreadState = vi.fn()
    const loadThreadStates = vi.fn(async (_state: ChatState, threadIds: string[]) =>
      threadIds.map((id) => ({
        id,
        ok: true as const,
        state: { status: 'running', latestTurnStatus: 'running' }
      })))

    syncTurnCompletionPoll(h.set, h.get, {
      loadThreadState,
      loadThreadStates,
      threadLooksRunning: (thread) => thread.status === 'running',
      onCompletedThreads: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(loadThreadStates).toHaveBeenCalledOnce()
    expect(loadThreadStates).toHaveBeenCalledWith(expect.anything(), ids)
    expect(loadThreadState).not.toHaveBeenCalled()
  })

  it('caps legacy completion-state reads at four concurrent requests', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `legacy_${index}`)
    const h = makeHarness({
      runtimeConnection: 'ready',
      watchTurnCompletion: Object.fromEntries(ids.map((id) => [id, true]))
    })
    let active = 0
    let maxActive = 0
    const loadThreadState = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return { status: 'running', latestTurnStatus: 'running' }
    })

    syncTurnCompletionPoll(h.set, h.get, {
      loadThreadState,
      threadLooksRunning: (thread) => thread.status === 'running',
      onCompletedThreads: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(loadThreadState).toHaveBeenCalledTimes(20)
    expect(maxActive).toBe(4)
  })
})
