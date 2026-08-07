import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEventSink } from '../agent/types'
import {
  GRAPH_THREAD_OBSERVER_RECONNECT_BASE_MS,
  startGraphThreadObserver
} from './graph-thread-observer'

describe('Graph thread observer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes independently of chat busy and advances a monotonic SSE cursor', async () => {
    const statuses: string[] = []
    const seqs: number[] = []
    let cursor = 2
    const subscribe = vi.fn(async (
      threadId: string,
      sinceSeq: number,
      sink: ThreadEventSink,
      signal: AbortSignal
    ) => {
      expect(threadId).toBe('thread_graph')
      expect(sinceSeq).toBe(2)
      sink.onConnected?.()
      sink.onSeq(5)
      sink.onGraphEvent?.({ graphSeq: 4 })
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    })

    const observer = startGraphThreadObserver({
      threadId: 'thread_graph',
      getSinceSeq: () => cursor,
      onSeq: (seq) => {
        cursor = Math.max(cursor, seq)
        seqs.push(seq)
      },
      onStatus: (status) => statuses.push(status),
      onGraphEvent: vi.fn(),
      subscribe
    })

    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1)
      expect(seqs).toEqual([5])
    })
    expect(statuses).toContain('connecting')
    expect(statuses).toContain('live')
    expect(cursor).toBe(5)

    observer.stop()
    expect(statuses.at(-1)).toBe('stopped')
  })

  it('reconnects from the latest cursor after disconnect without requiring a remount', async () => {
    vi.useFakeTimers()
    const subscribe = vi.fn()
    let cursor = 0
    subscribe
      .mockImplementationOnce(async (
        _threadId: string,
        sinceSeq: number,
        sink: ThreadEventSink
      ) => {
        expect(sinceSeq).toBe(0)
        sink.onSeq(3)
      })
      .mockImplementationOnce(async (
        _threadId: string,
        sinceSeq: number,
        sink: ThreadEventSink,
        signal: AbortSignal
      ) => {
        expect(sinceSeq).toBe(3)
        sink.onConnected?.()
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      })

    const observer = startGraphThreadObserver({
      threadId: 'thread_graph',
      getSinceSeq: () => cursor,
      onSeq: (seq) => {
        cursor = Math.max(cursor, seq)
      },
      onStatus: vi.fn(),
      onGraphEvent: vi.fn(),
      subscribe
    })

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(GRAPH_THREAD_OBSERVER_RECONNECT_BASE_MS)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2))
    expect(subscribe.mock.calls[1]?.[1]).toBe(3)

    observer.stop()
  })

  it('stops reconnecting when shouldReconnect becomes false (terminal Graph)', async () => {
    vi.useFakeTimers()
    let live = true
    const statuses: string[] = []
    const subscribe = vi.fn(async () => {
      live = false
    })

    startGraphThreadObserver({
      threadId: 'thread_graph',
      getSinceSeq: () => 0,
      onSeq: vi.fn(),
      onStatus: (status) => statuses.push(status),
      onGraphEvent: vi.fn(),
      subscribe,
      shouldReconnect: () => live
    })

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(GRAPH_THREAD_OBSERVER_RECONNECT_BASE_MS * 4)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe('stopped')
  })

  it('aborts the active subscription on stop so thread switches cannot leak', async () => {
    let aborted = false
    const subscribe = vi.fn(async (
      _threadId: string,
      _sinceSeq: number,
      _sink: ThreadEventSink,
      signal: AbortSignal
    ) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      })
    })

    const observer = startGraphThreadObserver({
      threadId: 'thread_old',
      getSinceSeq: () => 1,
      onSeq: vi.fn(),
      onStatus: vi.fn(),
      onGraphEvent: vi.fn(),
      subscribe
    })

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1))
    observer.stop()
    await vi.waitFor(() => expect(aborted).toBe(true))
  })
})
