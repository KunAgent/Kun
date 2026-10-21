import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { QueuedTurnDispatcher } from '../server/queued-turn-dispatcher.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { scanThreadMetadata, scannedThreadMetadata } from './thread-metadata-scan.js'

function record(id: string, statuses: string[], extra: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    relation: 'primary',
    turns: statuses.map((status, index) => ({ id: `${id}_${index}`, status })),
    ...extra
  } as unknown as ThreadRecord
}

function fakeStore(records: Map<string, ThreadRecord>, delayMs = 0) {
  let inflight = 0
  let maxInflight = 0
  const getMetadata = vi.fn(async (threadId: string) => {
    inflight += 1
    maxInflight = Math.max(maxInflight, inflight)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    inflight -= 1
    if (threadId === 'broken') throw new Error('unreadable')
    return records.get(threadId) ?? null
  })
  const list = vi.fn(async () => [...records.keys(), 'broken'].map((id) => ({ id }) as ThreadSummary))
  const store = { list, get: vi.fn(async () => null), getMetadata } as unknown as ThreadStore
  return { store, list, getMetadata, maxInflight: () => maxInflight }
}

describe('scanThreadMetadata', () => {
  it('lists side threads once and reads metadata with bounded concurrency', async () => {
    const records = new Map(Array.from({ length: 40 }, (_, index) => [`t${index}`, record(`t${index}`, ['completed'])]))
    const fake = fakeStore(records, 2)

    const scan = await scanThreadMetadata(fake.store, { concurrency: 4 })

    expect(fake.list).toHaveBeenCalledTimes(1)
    expect(fake.list).toHaveBeenCalledWith({ includeSide: true })
    expect(fake.getMetadata).toHaveBeenCalledTimes(41)
    expect(fake.maxInflight()).toBe(4)
    expect(scan.metadata.get('t7')?.id).toBe('t7')
    // An unreadable thread is recorded as null instead of failing the sweep.
    expect(scan.metadata.get('broken')).toBeNull()
    await expect(scannedThreadMetadata(fake.store, scan, 'broken')).resolves.toBeNull()
    expect(fake.getMetadata).toHaveBeenCalledTimes(41)
  })
})

describe('QueuedTurnDispatcher.drainAllQueued with a shared scan', () => {
  it('re-reads queued and rechecked threads only, honoring a pause set after the scan', async () => {
    const records = new Map([
      ['paused_later', record('paused_later', ['failed', 'queued'])],
      ['queued_later', record('queued_later', ['failed'])],
      ['idle', record('idle', ['completed'])],
      ['still_queued', record('still_queued', ['completed', 'queued'])]
    ])
    const fake = fakeStore(records)
    const scan = await scanThreadMetadata(fake.store)
    // Restart sweeps change two records after the scan was taken.
    records.set('paused_later', record('paused_later', ['failed', 'queued'], {
      queueControl: { reason: 'restart_recovery', sourceTurnId: 'paused_later_0', pausedAt: '2026-10-18T00:00:00.000Z' }
    }))
    records.set('queued_later', record('queued_later', ['failed', 'queued']))
    fake.getMetadata.mockClear()
    const started: string[] = []
    const dispatcher = new QueuedTurnDispatcher({
      threadStore: fake.store,
      runTurn: () => {},
      turns: { startNextQueuedTurn: async (threadId: string) => { started.push(threadId); return null } }
    } as unknown as ConstructorParameters<typeof QueuedTurnDispatcher>[0])
    try {
      const queued = await dispatcher.drainAllQueued({ scan, recheck: ['queued_later'] })

      expect(queued).toBe(2)
      // `idle` is answered from the scan; the dispatcher pass may re-read
      // started threads, so only the set of threads read is asserted.
      expect([...new Set(fake.getMetadata.mock.calls.map(([id]) => id))].sort())
        .toEqual(['paused_later', 'queued_later', 'still_queued'])
      await vi.waitFor(() => expect(started.sort()).toEqual(['queued_later', 'still_queued']))
    } finally {
      await dispatcher.dispose()
    }
  })
})
