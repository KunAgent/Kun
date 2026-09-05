import { describe, expect, it, vi } from 'vitest'
import {
  ManagerStateWriteQueue
} from './service-manager-state-write-queue.js'
import type { ServiceManagerStateSnapshot } from './service-manager-state-snapshot.js'

function snapshot(): ServiceManagerStateSnapshot {
  return {
    version: 5,
    slots: [],
    leases: [],
    pendingExpiredLeases: [],
    threadLeaseFenceHighWater: {},
    resourceLeases: [],
    resourceFenceHighWater: {},
    hostLiveness: {
      suspendedAtMs: null,
      lastReconcileAtMs: null,
      lastReportObservedAtMs: null,
      lastReportSourceId: null,
      lastReportPhase: null,
      sequences: {}
    }
  }
}

describe('ManagerStateWriteQueue', () => {
  it('coalesces a burst into at most two durable writes', async () => {
    let releaseFirst!: () => void
    let calls = 0
    const written: ServiceManagerStateSnapshot[] = []
    const writer = vi.fn((_path: string, snapshot: ServiceManagerStateSnapshot) => {
      calls += 1
      written.push(snapshot)
      if (calls === 1) {
        return new Promise<void>((resolve) => { releaseFirst = resolve })
      }
      return Promise.resolve()
    })
    const queue = new ManagerStateWriteQueue('unused.json', { writer })
    const snapshots = Array.from({ length: 20 }, () => snapshot())

    for (const next of snapshots) queue.enqueue(next)
    // The first write is blocked; the other 19 enqueues have coalesced.
    releaseFirst()
    await queue.flush()

    expect(calls).toBeLessThanOrEqual(2)
    expect(written[written.length - 1]).toBe(snapshots[19])
    expect(queue.stats().durableWrites).toBe(calls)
    expect(queue.stats().durableLag).toBe(0)
  })

  it('does not advance durable tracking until the write completes', async () => {
    let release!: () => void
    const writer = vi.fn(() =>
      new Promise<void>((resolve) => { release = resolve })
    )
    const queue = new ManagerStateWriteQueue('unused.json', { writer })
    const before = queue.lastDurableFlushAt

    queue.enqueue(snapshot())

    expect(queue.stats().durableLag).toBe(1)
    expect(queue.lastDurableFlushAt).toBe(before)

    release()
    await queue.flush()

    expect(queue.stats().durableLag).toBe(0)
    expect(queue.lastDurableFlushAt).toBeGreaterThanOrEqual(before)
  })

  it('retries a recoverable failure and clears degraded on success', async () => {
    let calls = 0
    const onPermanentFailure = vi.fn()
    const writer = vi.fn(() => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('EACCES: permission denied'))
      return Promise.resolve()
    })
    const queue = new ManagerStateWriteQueue('unused.json', {
      writer,
      retry: { attempts: 3, baseDelayMs: 1 },
      onPermanentFailure
    })

    queue.enqueue(snapshot())
    await queue.flush()

    expect(calls).toBe(2)
    expect(queue.degraded).toBe(false)
    expect(queue.failed).toBeUndefined()
    expect(queue.stats().durableWrites).toBe(1)
    expect(onPermanentFailure).not.toHaveBeenCalled()
  })

  it('enters permanent failure after exhausting retries', async () => {
    const error = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    const onPermanentFailure = vi.fn()
    const writer = vi.fn(() => Promise.reject(error))
    const queue = new ManagerStateWriteQueue('unused.json', {
      writer,
      retry: { attempts: 3, baseDelayMs: 1 },
      onPermanentFailure
    })

    queue.enqueue(snapshot())
    await expect(queue.flush()).rejects.toBe(error)

    expect(writer).toHaveBeenCalledTimes(3)
    expect(onPermanentFailure).toHaveBeenCalledTimes(1)
    expect(onPermanentFailure).toHaveBeenCalledWith(error)
    expect(queue.failed).toBe(error)
    expect(queue.degraded).toBe(true)

    // Subsequent enqueues are no-ops.
    queue.enqueue(snapshot())
    expect(writer).toHaveBeenCalledTimes(3)
  })
})
