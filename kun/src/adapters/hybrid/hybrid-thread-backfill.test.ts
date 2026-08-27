import { describe, expect, it, vi } from 'vitest'
import {
  HybridThreadBackfillCoordinator,
  type HybridThreadBackfillDeps
} from './hybrid-thread-backfill.js'

type Usage = { seq: number }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function makeDeps(
  overrides: Partial<HybridThreadBackfillDeps<Usage>> = {}
): HybridThreadBackfillDeps<Usage> {
  return {
    indexedRows: vi.fn(() => [{ id: 'thread_1', usage_backfilled: 0 }]),
    filesystemThreadIds: vi.fn(async () => ['thread_1']),
    readMissingThread: vi.fn(async () => true),
    scanEvents: vi.fn(async () => ({ highWater: 1, usage: [{ seq: 1 }] })),
    upsertMissing: vi.fn(async () => undefined),
    noteExistingHighWater: vi.fn(),
    insertUsage: vi.fn(async () => undefined),
    markUsageBackfilled: vi.fn(),
    threadDirectoryExists: vi.fn(async () => true),
    deleteIndexRow: vi.fn(),
    yieldToEventLoop: vi.fn(async () => undefined),
    warn: vi.fn(),
    ...overrides
  }
}

describe('HybridThreadBackfillCoordinator shutdown', () => {
  it('indexes every readable thread before waiting for slow event replay', async () => {
    const scan = deferred<{ highWater: number; usage: Usage[] }>()
    const deps = makeDeps({ indexedRows: vi.fn(() => []), scanEvents: vi.fn(() => scan.promise) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(deps.readMissingThread).toHaveBeenCalledWith('thread_1')
    expect(deps.upsertMissing).toHaveBeenCalledWith('thread_1', 0)
    expect(deps.scanEvents).toHaveBeenCalledTimes(1)
    expect(deps.markUsageBackfilled).not.toHaveBeenCalled()

    scan.resolve({ highWater: 3, usage: [{ seq: 3 }] })
    await coordinator.wait()
    expect(deps.noteExistingHighWater).toHaveBeenCalledWith('thread_1', 3)
    expect(deps.markUsageBackfilled).toHaveBeenCalledWith('thread_1')
  })

  it('stops before scanning when shutdown races filesystem discovery', async () => {
    const ids = deferred<string[]>()
    const deps = makeDeps({ filesystemThreadIds: vi.fn(() => ids.promise) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    coordinator.stop()
    ids.resolve(['thread_1'])
    await coordinator.wait()

    expect(deps.scanEvents).not.toHaveBeenCalled()
    expect(deps.insertUsage).not.toHaveBeenCalled()
    expect(deps.markUsageBackfilled).not.toHaveBeenCalled()
  })

  it('does not write late scan results after shutdown begins', async () => {
    const scan = deferred<{ highWater: number; usage: Usage[] }>()
    const deps = makeDeps({ scanEvents: vi.fn(() => scan.promise) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await vi.waitFor(() => expect(deps.scanEvents).toHaveBeenCalledTimes(1))
    coordinator.stop()
    scan.resolve({ highWater: 2, usage: [{ seq: 2 }] })
    await coordinator.wait()

    expect(deps.noteExistingHighWater).not.toHaveBeenCalled()
    expect(deps.insertUsage).not.toHaveBeenCalled()
    expect(deps.markUsageBackfilled).not.toHaveBeenCalled()
  })
})

describe('HybridThreadBackfillCoordinator failures', () => {
  it('skips a thread whose events scan fails and keeps it unmarked', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const deps = makeDeps({
      indexedRows: vi.fn(() => [
        { id: 'thread_1', usage_backfilled: 0 }, { id: 'thread_2', usage_backfilled: 0 }
      ]),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_2']),
      scanEvents: vi.fn(async (threadId: string) => {
        if (threadId === 'thread_1') throw failure
        return { highWater: 4, usage: [{ seq: 4 }] }
      })
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.warn).toHaveBeenCalledWith('usage backfill scan for thread_1', failure)
    expect(deps.noteExistingHighWater).not.toHaveBeenCalledWith('thread_1', expect.anything())
    expect(deps.insertUsage).not.toHaveBeenCalledWith('thread_1', expect.anything(), expect.anything())
    expect(deps.markUsageBackfilled).not.toHaveBeenCalledWith('thread_1')
    expect(deps.insertUsage).toHaveBeenCalledWith('thread_2', [{ seq: 4 }], 0)
    expect(deps.markUsageBackfilled).toHaveBeenCalledWith('thread_2')
  })

  it('leaves a failed usage write unmarked and continues with later threads', async () => {
    const failure = new Error('injected second chunk failure')
    const deps = makeDeps({
      indexedRows: vi.fn(() => [
        { id: 'thread_1', usage_backfilled: 0, usage_backfill_high_water: 200 },
        { id: 'thread_2', usage_backfilled: 0 }
      ]),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_2']),
      insertUsage: vi.fn(async (threadId: string) => {
        if (threadId === 'thread_1') throw failure
      })
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.insertUsage).toHaveBeenCalledWith('thread_1', [{ seq: 1 }], 200)
    expect(deps.warn).toHaveBeenCalledWith('usage backfill write for thread_1', failure)
    expect(deps.markUsageBackfilled).not.toHaveBeenCalledWith('thread_1')
    expect(deps.insertUsage).toHaveBeenCalledWith('thread_2', [{ seq: 1 }], 0)
    expect(deps.markUsageBackfilled).toHaveBeenCalledWith('thread_2')
  })

  it('marks a thread whose successful scan returned no usage rows', async () => {
    const deps = makeDeps({ scanEvents: vi.fn(async () => ({ highWater: 0, usage: [] })) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.noteExistingHighWater).toHaveBeenCalledWith('thread_1', 0)
    expect(deps.insertUsage).toHaveBeenCalledWith('thread_1', [], 0)
    expect(deps.markUsageBackfilled).toHaveBeenCalledWith('thread_1')
  })
})
