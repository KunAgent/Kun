import { describe, expect, it, vi } from 'vitest'
import {
  HybridThreadBackfillCoordinator,
  type HybridThreadBackfillDeps
} from './hybrid-thread-backfill.js'
import type { ThreadIndexRecord } from './hybrid-thread-index-mapping.js'

type Usage = { seq: number }

function makeRecord(id: string): ThreadIndexRecord {
  return {
    thread: { id } as ThreadIndexRecord['thread'],
    messageCount: 0,
    eventSeqHighWater: 0,
    preview: ''
  }
}

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
    readMissingThreads: vi.fn(async (ids: string[]) => ids.map((id) => makeRecord(id))),
    scanEvents: vi.fn(async () => ({ highWater: 1, usage: [{ seq: 1 }] })),
    upsertMissingRecords: vi.fn(async () => undefined),
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
    const deps = makeDeps({
      indexedRows: vi.fn()
        .mockReturnValueOnce([])
        .mockReturnValue([{ id: 'thread_1', usage_backfilled: 0 }]),
      scanEvents: vi.fn(() => scan.promise)
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(deps.readMissingThreads).toHaveBeenCalledWith(['thread_1'])
    expect(deps.upsertMissingRecords).toHaveBeenCalledWith([makeRecord('thread_1')], 0)
    expect(deps.scanEvents).toHaveBeenCalledTimes(1)
    expect(deps.markUsageBackfilled).not.toHaveBeenCalled()

    scan.resolve({ highWater: 3, usage: [{ seq: 3 }] })
    await coordinator.wait()
    expect(coordinator.isUsageReady()).toBe(true)
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
    expect(coordinator.isUsageReady()).toBe(false)
    expect(coordinator.isIndexReady()).toBe(false)

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
  it('keeps usage unavailable when index discovery fails', async () => {
    const failure = new Error('cannot enumerate threads')
    const deps = makeDeps({ filesystemThreadIds: vi.fn(async () => { throw failure }) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.warn).toHaveBeenCalledWith('background index backfill', failure)
    expect(coordinator.isUsageReady()).toBe(false)
    expect(deps.scanEvents).not.toHaveBeenCalled()
  })

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
    expect(coordinator.isUsageReady()).toBe(false)
    expect(deps.insertUsage).toHaveBeenCalledWith('thread_2', [{ seq: 4 }], 0)
    expect(deps.markUsageBackfilled).toHaveBeenCalledWith('thread_2')
    expect(coordinator.isUsageReady(['thread_1'])).toBe(false)
    expect(coordinator.isUsageReady(['thread_2'])).toBe(true)
  })

  it('retries a transient usage backfill failure on the next start', async () => {
    const scanEvents = vi.fn()
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValue({ highWater: 2, usage: [{ seq: 2 }] })
    const deps = makeDeps({ scanEvents })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()
    expect(coordinator.isUsageReady()).toBe(false)

    coordinator.start()
    await coordinator.wait()
    expect(coordinator.isUsageReady()).toBe(true)
    expect(scanEvents).toHaveBeenCalledTimes(2)
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

describe('HybridThreadBackfillCoordinator batching and progress', () => {
  function statefulIndex(): {
    indexedRows: () => Array<{ id: string; usage_backfilled?: number }>
    upsertMissingRecords: (records: ThreadIndexRecord[]) => Promise<void>
  } {
    const rows: Array<{ id: string; usage_backfilled?: number }> = []
    return {
      indexedRows: () => rows.map((row) => ({ ...row })),
      upsertMissingRecords: async (records) => {
        for (const record of records) rows.push({ id: record.thread.id, usage_backfilled: 0 })
      }
    }
  }

  it('skips an unreadable thread and warns while continuing the batch', async () => {
    const index = statefulIndex()
    const deps = makeDeps({
      indexedRows: vi.fn(index.indexedRows),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_2']),
      readMissingThreads: vi.fn(async () => [null, makeRecord('thread_2')]),
      upsertMissingRecords: vi.fn(index.upsertMissingRecords)
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(deps.warn).toHaveBeenCalledWith('index missing thread', 'thread_1')
    expect(deps.upsertMissingRecords).toHaveBeenCalledWith([makeRecord('thread_2')], 0)
    expect(coordinator.isIndexReady()).toBe(true)
  })

  it('writes missing threads in bounded batches', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const index = statefulIndex()
    const deps = makeDeps({
      indexedRows: vi.fn(index.indexedRows),
      filesystemThreadIds: vi.fn(async () => ids),
      upsertMissingRecords: vi.fn(index.upsertMissingRecords)
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps, { batchSize: 2 })

    coordinator.start()
    await coordinator.waitForIndex()

    expect(deps.upsertMissingRecords).toHaveBeenCalledTimes(3)
    expect(deps.upsertMissingRecords).toHaveBeenNthCalledWith(1, [makeRecord('a'), makeRecord('b')], 0)
    expect(deps.upsertMissingRecords).toHaveBeenNthCalledWith(2, [makeRecord('c'), makeRecord('d')], 0)
    expect(deps.upsertMissingRecords).toHaveBeenNthCalledWith(3, [makeRecord('e')], 0)
    expect(coordinator.isIndexReady()).toBe(true)
  })

  it('reports indexed/total progress once ready', async () => {
    const index = statefulIndex()
    const deps = makeDeps({
      indexedRows: vi.fn(index.indexedRows),
      filesystemThreadIds: vi.fn(async () => ['a', 'b', 'c']),
      upsertMissingRecords: vi.fn(index.upsertMissingRecords)
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(coordinator.progress()).toEqual({ status: 'ready', indexed: 3, total: 3 })
  })
})

describe('HybridThreadBackfillCoordinator index status', () => {
  it('is ready after a successful startup index', async () => {
    const deps = makeDeps()
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(coordinator.isIndexReady()).toBe(true)
  })

  it('resolves waitForIndex but stays not ready when discovery fails', async () => {
    const failure = new Error('cannot enumerate threads')
    const deps = makeDeps({ filesystemThreadIds: vi.fn(async () => { throw failure }) })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(coordinator.isIndexReady()).toBe(false)
    expect(coordinator.isUsageReady()).toBe(false)
    expect(deps.warn).toHaveBeenCalledWith('background index backfill', failure)
  })

  it('becomes ready again after a failed index backfill is retried', async () => {
    const filesystemThreadIds = vi.fn()
      .mockRejectedValueOnce(new Error('temporary enumeration failure'))
      .mockResolvedValue(['thread_1'])
    const deps = makeDeps({ filesystemThreadIds })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()
    expect(coordinator.isIndexReady()).toBe(false)

    coordinator.start()
    await coordinator.wait()
    expect(coordinator.isIndexReady()).toBe(true)
    expect(filesystemThreadIds).toHaveBeenCalledTimes(2)
  })
})

describe('HybridThreadBackfillCoordinator index write failures', () => {
  it('keeps processing other threads and stays not ready when an upsert batch fails', async () => {
    const failure = new Error('SQLITE_BUSY: database is locked')
    const deps = makeDeps({
      indexedRows: vi.fn(() => [{ id: 'thread_1', usage_backfilled: 0 }]),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_2']),
      upsertMissingRecords: vi.fn(async () => { throw failure })
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.upsertMissingRecords).toHaveBeenCalledWith([makeRecord('thread_2')], 0)
    expect(deps.warn).toHaveBeenCalledWith('index backfill upsert batch', failure)
    expect(coordinator.isIndexReady()).toBe(false)
    expect(coordinator.isUsageReady()).toBe(false)
  })

  it('stays not ready when a re-query shows the index missing a thread', async () => {
    const deps = makeDeps({
      indexedRows: vi.fn(() => [{ id: 'thread_1', usage_backfilled: 0 }]),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_2'])
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.wait()

    expect(deps.upsertMissingRecords).toHaveBeenCalledWith([makeRecord('thread_2')], 0)
    expect(coordinator.isIndexReady()).toBe(false)
  })

  it('allows ready when the only missing thread is unreadable', async () => {
    const deps = makeDeps({
      indexedRows: vi.fn(() => [{ id: 'thread_1', usage_backfilled: 0 }]),
      filesystemThreadIds: vi.fn(async () => ['thread_1', 'thread_unreadable']),
      readMissingThreads: vi.fn(async (ids: string[]) =>
        ids.map((id) => (id === 'thread_unreadable' ? null : makeRecord(id)))
      )
    })
    const coordinator = new HybridThreadBackfillCoordinator(deps)

    coordinator.start()
    await coordinator.waitForIndex()

    expect(coordinator.isIndexReady()).toBe(true)
  })
})
