import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrajectorySummary } from '../contracts/trajectory.js'
import { TrajectorySummaryCache } from './trajectory-summary-cache.js'

const summary = (requestCount: number) => ({ requestCount }) as TrajectorySummary
afterEach(() => vi.useRealTimers())

describe('trajectory summary cache', () => {
  it('coalesces the same version and only retains compact bounded summaries', async () => {
    const cache = new TrajectorySummaryCache(2)
    const load = vi.fn(async () => summary(1))
    const first = cache.get('a', '1', load)
    expect(cache.get('a', '1', load)).toBe(first)
    await first
    await cache.get('a', '1', load)
    expect(load).toHaveBeenCalledOnce()
    await cache.get('b', '1', load)
    await cache.get('c', '1', load)
    await cache.get('a', '1', load)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('does not let an older in-flight projection replace a newer terminal version', async () => {
    const cache = new TrajectorySummaryCache()
    let resolve!: (value: TrajectorySummary) => void
    const old = cache.get('a', 'running', () => new Promise(done => { resolve = done }))
    await Promise.resolve()
    await cache.get('a', 'completed', async () => summary(2))
    resolve(summary(1))
    await old
    const load = vi.fn(async () => summary(3))
    expect(await cache.get('a', 'completed', load)).toEqual(summary(2))
    expect(load).not.toHaveBeenCalled()
  })

  it('refreshes external/recorder changes after a bounded TTL and retries failed reads', async () => {
    vi.useFakeTimers()
    const cache = new TrajectorySummaryCache()
    const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(summary(1))
    await expect(cache.get('a', '1', load)).rejects.toThrow('unavailable')
    await cache.get('a', '1', load)
    await vi.advanceTimersByTimeAsync(2_001)
    await cache.get('a', '1', load)
    expect(load).toHaveBeenCalledTimes(3)
  })
})
