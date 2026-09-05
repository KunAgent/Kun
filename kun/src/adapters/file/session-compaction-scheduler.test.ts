import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionCompactionScheduler } from './session-compaction-scheduler.js'

describe('SessionCompactionScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces repeated schedules into one run after the debounce window', async () => {
    vi.useFakeTimers()
    const runs: string[] = []
    const scheduler = new SessionCompactionScheduler({
      delayMs: 100,
      run: async (threadId, kind) => {
        runs.push(`${kind}:${threadId}`)
      }
    })
    scheduler.schedule('thr_1', 'items')
    scheduler.schedule('thr_1', 'items')
    scheduler.schedule('thr_1', 'items')
    expect(runs).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    await scheduler.flush('thr_1')
    expect(runs).toEqual(['items:thr_1'])
    await scheduler.close()
  })

  it('does not await compaction work on schedule()', async () => {
    let started = false
    const scheduler = new SessionCompactionScheduler({
      delayMs: 50,
      run: async () => {
        started = true
      }
    })
    const before = Date.now()
    scheduler.schedule('thr_block', 'usage')
    expect(Date.now() - before).toBeLessThan(20)
    expect(started).toBe(false)
    // Drop the pending timer without waiting for a hangable in-flight run.
    await scheduler.close()
  })

  it('runs physical repairs one at a time across threads', async () => {
    vi.useFakeTimers()
    const started: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const scheduler = new SessionCompactionScheduler({
      delayMs: 0,
      run: async (threadId) => {
        started.push(threadId)
        if (threadId === 'thr_1') await firstGate
      }
    })
    scheduler.schedule('thr_1', 'items')
    scheduler.schedule('thr_2', 'items')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(started).toEqual(['thr_1']))

    releaseFirst()
    await scheduler.flush()

    expect(started).toEqual(['thr_1', 'thr_2'])
    await scheduler.close()
  })

  it('waits for in-flight work and refuses new schedules after close', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const run = vi.fn(async () => gate)
    const scheduler = new SessionCompactionScheduler({ delayMs: 0, run })
    scheduler.schedule('thr_1', 'events')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

    let closed = false
    const closing = scheduler.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release()
    await closing
    scheduler.schedule('thr_2', 'events')
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledOnce()
  })
})
