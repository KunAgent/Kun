import { describe, expect, it, vi } from 'vitest'
import { MAX_INFLIGHT_SSE_BATCHES, SseAckWindow } from './sse-ack-window'

describe('SseAckWindow', () => {
  it('allows sending up to maxInflight batches without waiting', async () => {
    const window = new SseAckWindow()
    const controller = new AbortController()
    for (let i = 0; i < MAX_INFLIGHT_SSE_BATCHES; i += 1) {
      await expect(window.waitForCapacity(controller.signal)).resolves.toBe(true)
      window.registerSentBatch({
        batchId: `batch-${i}`,
        eventCount: 1,
        signal: controller.signal
      })
    }
    expect(window.inflightCount).toBe(MAX_INFLIGHT_SSE_BATCHES)
  })

  it('unblocks a capacity waiter when the oldest batch is acknowledged (FIFO)', async () => {
    const window = new SseAckWindow()
    const controller = new AbortController()
    for (let i = 0; i < MAX_INFLIGHT_SSE_BATCHES; i += 1) {
      await window.waitForCapacity(controller.signal)
      window.registerSentBatch({
        batchId: `batch-${i}`,
        eventCount: i + 1,
        signal: controller.signal
      })
    }
    expect(window.inflightCount).toBe(MAX_INFLIGHT_SSE_BATCHES)

    const capacity = window.waitForCapacity(controller.signal)
    let unblocked = false
    void capacity.then(() => {
      unblocked = true
    })
    await Promise.resolve()
    expect(unblocked).toBe(false)

    expect(window.acknowledge('batch-0')).toBe(true)
    await expect(capacity).resolves.toBe(true)
    expect(unblocked).toBe(true)
    expect(window.inflightCount).toBe(MAX_INFLIGHT_SSE_BATCHES - 1)
  })

  it('records ack latency and batch-size stats for B1 metrics', async () => {
    let clock = 1_000
    const window = new SseAckWindow(4, 15_000, () => clock)
    const controller = new AbortController()
    await window.waitForCapacity(controller.signal)
    window.registerSentBatch({ batchId: 'b1', eventCount: 7, signal: controller.signal })
    clock += 120
    window.acknowledge('b1')
    const stats = window.getStats()
    expect(stats.sentBatches).toBe(1)
    expect(stats.ackedBatches).toBe(1)
    expect(stats.batchSizes).toEqual([7])
    expect(stats.ackLatenciesMs).toEqual([120])
    expect(stats.batchSentAtMs).toEqual([1_000])
    expect(stats.timedOutBatches).toBe(0)
  })

  it('settles a timed-out batch as unacknowledged and unblocks capacity waiters', async () => {
    vi.useFakeTimers()
    try {
      const window = new SseAckWindow(2, 100)
      const controller = new AbortController()
      await window.waitForCapacity(controller.signal)
      window.registerSentBatch({ batchId: 'b1', eventCount: 1, signal: controller.signal })
      await window.waitForCapacity(controller.signal)
      window.registerSentBatch({ batchId: 'b2', eventCount: 1, signal: controller.signal })
      const capacity = window.waitForCapacity(controller.signal)
      // Both batches registered at the same fake-time origin, so both
      // watchdogs fire together and both settle as timed out.
      vi.advanceTimersByTime(150)
      await expect(capacity).resolves.toBe(false)
      expect(window.getStats().timedOutBatches).toBe(2)
      expect(window.getStats().ackedBatches).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies the stream owner on timeout even when the window is not full', async () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()
      const window = new SseAckWindow(4, 100, Date.now, onTimeout)
      const controller = new AbortController()
      window.registerSentBatch({ batchId: 'single', eventCount: 1, signal: controller.signal })
      vi.advanceTimersByTime(100)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(onTimeout).toHaveBeenCalledWith('single')
      expect(window.getStats().timedOutBatches).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes the shared abort listener after acknowledgement and rejectAll', async () => {
    const window = new SseAckWindow()
    const controller = new AbortController()
    const signal = controller.signal
    const addSpy = vi.spyOn(signal, 'addEventListener')
    const removeSpy = vi.spyOn(signal, 'removeEventListener')

    window.registerSentBatch({ batchId: 'acked', eventCount: 1, signal })
    window.registerSentBatch({ batchId: 'rejected-1', eventCount: 1, signal })
    window.registerSentBatch({ batchId: 'rejected-2', eventCount: 1, signal })
    expect(addSpy).toHaveBeenCalledTimes(3)

    expect(window.acknowledge('acked')).toBe(true)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy.mock.calls[0]?.[0]).toBe('abort')

    window.rejectAll()
    expect(removeSpy).toHaveBeenCalledTimes(3)
    expect(removeSpy.mock.calls.map((call) => call[0])).toEqual(['abort', 'abort', 'abort'])
  })

  it('bounds retained metric samples across long-lived subscriptions', async () => {
    let clock = 0
    const window = new SseAckWindow(4, 1_000, () => clock)
    const controller = new AbortController()
    for (let i = 0; i < 1_200; i += 1) {
      await window.waitForCapacity(controller.signal)
      window.registerSentBatch({ batchId: `batch-${i}`, eventCount: 1, signal: controller.signal })
      clock += 1
      expect(window.acknowledge(`batch-${i}`)).toBe(true)
    }
    const stats = window.getStats()
    expect(stats.sentBatches).toBe(1_200)
    expect(stats.ackedBatches).toBe(1_200)
    expect(stats.ackLatenciesMs).toHaveLength(1_000)
    expect(stats.batchSizes).toHaveLength(1_000)
    expect(stats.batchSentAtMs).toHaveLength(1_000)
    expect(stats.ackLatenciesMs[0]).toBe(1)
    expect(stats.batchSentAtMs.at(-1)).toBe(1_199)
  })

  it('rejectAll settles every in-flight batch as unacknowledged', async () => {
    const window = new SseAckWindow()
    const controller = new AbortController()
    for (let i = 0; i < MAX_INFLIGHT_SSE_BATCHES; i += 1) {
      await window.waitForCapacity(controller.signal)
      window.registerSentBatch({
        batchId: `batch-${i}`,
        eventCount: i + 1,
        signal: controller.signal
      })
    }
    const capacity = window.waitForCapacity(controller.signal)
    window.rejectAll()
    await expect(capacity).resolves.toBe(false)
    expect(window.inflightCount).toBe(0)
    // Late ACKs for settled batches are ignored, not errors.
    expect(window.acknowledge('batch-0')).toBe(false)
  })

  it('ignores acknowledgements for unknown batches', () => {
    const window = new SseAckWindow()
    expect(window.acknowledge('nope')).toBe(false)
  })

  it('waitForCapacity returns false once aborted', async () => {
    const window = new SseAckWindow()
    const controller = new AbortController()
    await window.waitForCapacity(controller.signal)
    window.registerSentBatch({ batchId: 'a', eventCount: 1, signal: controller.signal })
    controller.abort()
    await expect(window.waitForCapacity(controller.signal)).resolves.toBe(false)
  })
})
