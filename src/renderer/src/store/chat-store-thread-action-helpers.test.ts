import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider, ThreadEventSink } from '../agent/types'
import type { ChatState } from './chat-store-types'
import {
  composerSelectionForThread,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { rememberThreadComposerSelection } from './chat-store-helpers'
import { resetThreadRecoveryCoordinator } from './thread-recovery-coordinator'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('composerSelectionForThread', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a user-selected model before the model catalog has loaded', () => {
    rememberThreadComposerSelection('thread-a', 'k3', 'test-provider', 'user')
    const state = {
      composerPickList: [],
      composerModelGroups: []
    } as unknown as ChatState

    const selection = composerSelectionForThread(state, { id: 'thread-a', model: 'terra' }, {
      hasUserMessages: true,
      runtimeModel: 'terra'
    })

    // Catalog not ready yet: the explicit user selection wins instead of
    // flashing back to the first-sent thread model.
    expect(selection).toEqual({ model: 'k3', providerId: 'test-provider' })
  })

  it('falls back to the thread model once the loaded catalog excludes the stored selection', () => {
    rememberThreadComposerSelection('thread-b', 'k3', 'test-provider', 'user')
    const state = {
      composerPickList: ['terra'],
      composerModelGroups: [{
        providerId: 'test-provider',
        label: 'Test',
        modelIds: ['terra']
      }]
    } as unknown as ChatState

    const selection = composerSelectionForThread(state, { id: 'thread-b', model: 'terra' }, {
      hasUserMessages: true,
      runtimeModel: 'terra'
    })

    // Catalog is ready and genuinely lacks k3: existing fallback behavior.
    expect(selection).toEqual({ model: 'terra', providerId: 'test-provider' })
  })
})

describe('subscribeThreadEventsWithRecovery', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetThreadRecoveryCoordinator()
  })

  it('rehydrates a selected idle thread after SSE ends so late restart events are not lost', async () => {
    vi.useFakeTimers()
    const recoverActiveTurn = vi.fn(async () => false)
    const state = {
      activeThreadId: 'thread_idle_restart',
      busy: false,
      recoverActiveTurn
    } as unknown as ChatState
    const provider = {
      subscribeThreadEvents: vi.fn(async (
        _threadId: string,
        _sinceSeq: number,
        sink: ThreadEventSink
      ) => {
        sink.onError(new Error('runtime restarted'))
      })
    } as unknown as AgentProvider
    const sink = { onError: vi.fn() } as unknown as ThreadEventSink
    const controller = new AbortController()

    subscribeThreadEventsWithRecovery(
      provider,
      state.activeThreadId!,
      42,
      sink,
      controller.signal,
      () => state
    )
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)

    expect(recoverActiveTurn).toHaveBeenCalledOnce()
    controller.abort()
  })

  it('immediately rehydrates a replay reset without surfacing a false chat error', async () => {
    vi.useFakeTimers()
    const recoverActiveTurn = vi.fn(async () => true)
    const state = {
      activeThreadId: 'thread_reset',
      busy: true,
      recoverActiveTurn
    } as unknown as ChatState
    const reset = Object.assign(new Error('reload snapshot'), {
      code: 'replay_reset_required',
      threadId: 'thread_reset',
      floorSeq: 80
    })
    const provider = {
      subscribeThreadEvents: vi.fn(async (
        _threadId: string,
        _sinceSeq: number,
        recoverySink: ThreadEventSink
      ) => {
        recoverySink.onError(reset)
      })
    } as unknown as AgentProvider
    const sink = { onError: vi.fn() } as unknown as ThreadEventSink

    subscribeThreadEventsWithRecovery(
      provider,
      state.activeThreadId!,
      7,
      sink,
      new AbortController().signal,
      () => state
    )
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(sink.onError).not.toHaveBeenCalled()
    expect(recoverActiveTurn).toHaveBeenCalledOnce()
  })
})
