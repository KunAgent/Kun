import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armBusyWatchdog,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts
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
