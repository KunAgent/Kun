import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestScheduler } from './provider-request-scheduler.js'

const limits = { maxConcurrent: 1, maxQueued: 4, queueWaitMs: 1000 }
const signal = () => new AbortController().signal

describe('shared provider account admission', () => {
  it('shares account capacity across callers and rotates fairly through their waiting queues', async () => {
    const scheduler = new ProviderRequestScheduler()
    const first = await scheduler.acquire('account', 'client-a', limits, signal())
    const order: string[] = []
    const second = scheduler.acquire('account', 'client-a', limits, signal()).then((release) => { order.push('a'); return release })
    const third = scheduler.acquire('account', 'client-b', limits, signal()).then((release) => { order.push('b'); return release })
    expect(scheduler.status()).toEqual([{ accountId: 'account', active: 1, queued: 2 }])
    first()
    const releaseB = await third
    expect(order).toEqual(['b'])
    releaseB()
    const releaseA = await second
    expect(order).toEqual(['b', 'a'])
    releaseA(); releaseA()
    expect(scheduler.status()).toEqual([])
  })

  it('removes cancelled queued work without consuming a slot', async () => {
    const scheduler = new ProviderRequestScheduler()
    const release = await scheduler.acquire('account', 'native', limits, signal())
    const controller = new AbortController()
    const queued = scheduler.acquire('account', 'external', limits, controller.signal)
    const cancelled = expect(queued).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await cancelled
    expect(scheduler.status()).toEqual([{ accountId: 'account', active: 1, queued: 0 }])
    release()
    expect(scheduler.status()).toEqual([])
  })

  it('bounds queue size and wait time independently of a long upstream request', async () => {
    vi.useFakeTimers()
    try {
      const scheduler = new ProviderRequestScheduler()
      const release = await scheduler.acquire('account', 'one', { ...limits, maxQueued: 1 }, signal())
      const queued = scheduler.acquire('account', 'two', { ...limits, maxQueued: 1 }, signal())
      const timedOut = expect(queued).rejects.toThrow('wait expired')
      await expect(scheduler.acquire('account', 'three', { ...limits, maxQueued: 1 }, signal())).rejects.toThrow('queue is full')
      await vi.advanceTimersByTimeAsync(1000)
      await timedOut
      release()
      expect(scheduler.status()).toEqual([])
    } finally { vi.useRealTimers() }
  })

  it('releases an active lease on cancellation and isolates different accounts', async () => {
    const scheduler = new ProviderRequestScheduler(), controller = new AbortController()
    const release = await scheduler.acquire('one', 'a', limits, controller.signal)
    const other = await scheduler.acquire('two', 'a', limits, signal())
    controller.abort()
    release()
    expect(scheduler.status()).toEqual([{ accountId: 'two', active: 1, queued: 0 }])
    other()
  })
})
