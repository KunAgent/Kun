import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider, ThreadEventSink } from '../agent/types'
import type { ChatState } from './chat-store-types'
import { subscribeThreadEventsWithRecovery } from './chat-store-thread-action-helpers'

describe('subscribeThreadEventsWithRecovery', () => {
  afterEach(() => {
    vi.useRealTimers()
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
    await vi.advanceTimersByTimeAsync(250)

    expect(recoverActiveTurn).toHaveBeenCalledOnce()
    controller.abort()
  })

  it('compounds backoff for ordinary errors but treats a seq_conflict as a fresh incident', async () => {
    vi.useFakeTimers()
    const recoverActiveTurn = vi.fn(async () => false)
    const state = {
      activeThreadId: 'thread_seq_conflict',
      busy: true,
      recoverActiveTurn
    } as unknown as ChatState
    const sink = { onError: vi.fn() } as unknown as ThreadEventSink
    const subscribeWith = (makeError: () => Error) => {
      const controller = new AbortController()
      const provider = {
        subscribeThreadEvents: vi.fn(async (
          _threadId: string,
          _sinceSeq: number,
          eventSink: ThreadEventSink
        ) => {
          eventSink.onError(makeError())
        })
      } as unknown as AgentProvider
      subscribeThreadEventsWithRecovery(
        provider,
        'thread_seq_conflict',
        42,
        sink,
        controller.signal,
        () => state
      )
      return controller
    }

    // First ordinary failure recovers after the initial 250ms delay.
    subscribeWith(() => new Error('boom-1'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)

    // Second ordinary failure compounds: it needs the full 500ms, not 250ms.
    subscribeWith(() => new Error('boom-2'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(recoverActiveTurn).toHaveBeenCalledTimes(2)

    // A wire seq conflict means the cursor is provably dead: idempotent
    // backoff must not stall a frozen thread, so this fires after 250ms
    // (fresh-incident) instead of the compounded 1000ms.
    const conflict = Object.assign(new Error('wire regression'), { code: 'seq_conflict' })
    subscribeWith(() => conflict)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    expect(recoverActiveTurn).toHaveBeenCalledTimes(3)
  })
})
