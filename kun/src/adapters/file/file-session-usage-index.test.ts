import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import type { UsageEvent } from '../../contracts/events.js'
import type { SessionLatestUsageSnapshot, SessionUsageRecord } from '../../ports/session-store.js'
import { FileSessionStore } from './file-session-store.js'
import {
  loadLatestUsageSnapshotsFromIndex,
  loadUsageRecordsFromIndex
} from './file-session-usage-read.js'

/** Records the start offset of every stream opened on usage-index.jsonl. */
const indexReads = vi.hoisted(() => {
  const state = { starts: [] as number[] }
  return {
    starts: () => state.starts,
    reset: () => { state.starts = [] }
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: (path: unknown, options: unknown) => {
      const start = typeof options === 'object' && options !== null ? (options as { start?: number }).start : undefined
      if (typeof path === 'string' && path.endsWith('usage-index.jsonl') && typeof start === 'number') {
        indexReads.starts().push(start)
      }
      return actual.createReadStream(path as never, options as never)
    }
  }
})

function cumulative(promptTokens: number, completionTokens: number): UsageSnapshot {
  return {
    ...emptyUsageSnapshot(),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    turns: 1
  }
}

function usageEvent(
  threadId: string,
  seq: number,
  timestamp: string,
  promptTokens: number,
  completionTokens: number,
  extra: Partial<UsageEvent> = {}
): UsageEvent {
  return {
    kind: 'usage',
    threadId,
    seq,
    timestamp,
    usage: cumulative(promptTokens, completionTokens),
    ...extra
  }
}

describe('FileSessionStore usage index', () => {
  let root: string
  let store: FileSessionStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-usage-index-'))
    store = new FileSessionStore({ dataDir: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('answers a ranged query from the index without replaying the full event log', async () => {
    const threadId = 'thread-range'
    // A year of daily history, then the events inside the queried window.
    for (let day = 0; day < 30; day += 1) {
      const timestamp = new Date(Date.parse('2026-07-01T00:00:00.000Z') + day * 86_400_000)
        .toISOString()
      await store.appendEvent(threadId, usageEvent(threadId, day + 1, timestamp, (day + 1) * 100, (day + 1) * 10))
    }
    await store.appendEvent(threadId, usageEvent(threadId, 101, '2026-08-20T10:00:00.000Z', 4_000, 400))
    await store.appendEvent(threadId, usageEvent(threadId, 102, '2026-08-21T10:00:00.000Z', 4_500, 450, { turnId: 'turn-b' }))

    // If this query replayed events.jsonl from seq 0 it would have to parse
    // all 32 events; with the index it reads usage-index.jsonl only.
    const records = await store.loadUsageRecords({
      threadId,
      fromInclusive: '2026-08-20T00:00:00.000Z',
      toExclusive: '2026-08-22T00:00:00.000Z'
    })

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      threadId,
      completedAt: '2026-08-20T10:00:00.000Z',
      usage: { promptTokens: 1_000, completionTokens: 100, totalTokens: 1_100 }
    })
    expect(records[1]).toMatchObject({
      threadId,
      turnId: 'turn-b',
      completedAt: '2026-08-21T10:00:00.000Z',
      usage: { promptTokens: 500, completionTokens: 50, totalTokens: 550 }
    })
  })

  it('writes an atomic sidecar with sparse day offsets and the indexed byte boundary', async () => {
    const threadId = 'thread-sidecar'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 200, 20))

    const threadDir = join(root, 'threads', threadId)
    const indexPath = join(threadDir, 'usage-index.jsonl')
    const sidecar = JSON.parse(await readFile(join(threadDir, 'usage-index.state.json'), 'utf-8')) as {
      version: number
      indexedBytes: number
      days: Record<string, number>
      statSignature: string
      segments: string[]
      tailDigest: string
    }

    expect(sidecar.version).toBe(2)
    expect(sidecar.indexedBytes).toBe((await stat(indexPath)).size)
    expect(sidecar.days['2026-08-20']).toBe(0)
    expect(sidecar.days['2026-08-21']).toBeGreaterThan(sidecar.days['2026-08-20'])
    expect(sidecar.statSignature).toMatch(/^\d+:/)
    expect(sidecar.segments.length).toBeGreaterThan(0)
    expect(sidecar.tailDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('migrates a valid v1 sidecar to v2 without trusting its hash format', async () => {
    const threadId = 'thread-v1-migration'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    const threadDir = join(root, 'threads', threadId)
    const sidecarPath = join(threadDir, 'usage-index.state.json')
    const indexPath = join(threadDir, 'usage-index.jsonl')
    const current = JSON.parse(await readFile(sidecarPath, 'utf-8')) as Record<string, unknown>
    await writeFile(sidecarPath, JSON.stringify({ ...current, version: 1, sha256: 'legacy' }), 'utf-8')

    const migratedStore = new FileSessionStore({ dataDir: root })
    await migratedStore.loadLatestUsageSnapshots({ threadIds: [threadId] })

    const migrated = JSON.parse(await readFile(sidecarPath, 'utf-8')) as { version: number; segments: string[] }
    expect(migrated.version).toBe(2)
    expect(migrated.segments.length).toBeGreaterThan(0)
    expect((await stat(indexPath)).size).toBeGreaterThan(0)
  })

  it('atomically rebuilds after the index is truncated behind its sidecar', async () => {
    const threadId = 'thread-truncated'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 250, 25))
    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    const complete = await readFile(indexPath, 'utf-8')
    await writeFile(indexPath, complete.slice(0, complete.indexOf('\n') + 1), 'utf-8')

    const records = await store.loadUsageRecords({ threadId })

    expect(records.map((record) => record.usage.promptTokens)).toEqual([100, 150])
    expect((await readFile(indexPath, 'utf-8')).trimEnd().split('\n')).toHaveLength(3)
    expect((await stat(indexPath)).size).toBe(
      JSON.parse(await readFile(join(root, 'threads', threadId, 'usage-index.state.json'), 'utf-8')).indexedBytes
    )
  })
  it('returns the latest cumulative snapshot per thread from the index tail', async () => {
    await store.appendEvent('thread-a', usageEvent('thread-a', 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent('thread-a', usageEvent('thread-a', 2, '2026-08-21T00:00:00.000Z', 300, 30))
    await store.appendEvent('thread-b', usageEvent('thread-b', 1, '2026-08-21T00:00:00.000Z', 55, 5))

    const snapshots = await store.loadLatestUsageSnapshots({})

    expect(snapshots).toEqual([
      { threadId: 'thread-a', seq: 2, usage: cumulative(300, 30) },
      { threadId: 'thread-b', seq: 1, usage: cumulative(55, 5) }
    ])
  })

  it('backfills the index from events.jsonl when only part of the log was indexed', async () => {
    const threadId = 'thread-partial'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 200, 20))

    // Simulate a crash between the events.jsonl append and the index write.
    await rm(join(root, 'threads', threadId, 'usage-index.jsonl'))

    const records = await store.loadUsageRecords({ threadId })

    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({
      completedAt: '2026-08-21T00:00:00.000Z',
      usage: { promptTokens: 100, completionTokens: 10 }
    })
    // The rebuild must be durable: the next query needs no further backfill.
    const again = await store.loadUsageRecords({ threadId })
    expect(again).toEqual(records)
  })

  it('rebuilds a corrupted index from the canonical event log', async () => {
    const threadId = 'thread-corrupt'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 250, 25))

    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    const original = await readFile(indexPath, 'utf-8')
    await (await import('node:fs/promises')).writeFile(
      indexPath,
      `{"type":"delta","seq":1,"timestamp":"2026-08-20T00:00:00.000Z","usage":null}\nnot-json\n`,
      'utf-8'
    )

    const records = await store.loadUsageRecords({
      threadId,
      fromInclusive: '2026-08-21T00:00:00.000Z',
      toExclusive: '2026-08-22T00:00:00.000Z'
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      completedAt: '2026-08-21T00:00:00.000Z',
      usage: { promptTokens: 150, completionTokens: 15 }
    })
    void original
  })

  it('keeps query results identical between index and full replay semantics', async () => {
    const threadId = 'thread-parity'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 1_000, 100, { turnId: 'turn-1' }))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-23T00:00:02.000Z', 1_200, 140, { turnId: 'turn-2' }))

    const records = await store.loadUsageRecords({
      threadId,
      fromInclusive: '2026-08-23T00:00:02.000Z',
      toExclusive: '2026-08-23T00:00:03.000Z'
    })

    // Matches the JSONL fallback expectation in usage-history.test.ts: the
    // in-range record carries the diff against the pre-range cumulative base.
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      turnId: 'turn-2',
      usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
    })
  })

  it('ignores an unterminated index tail and repairs it atomically', async () => {
    const threadId = 'thread-tail'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    await appendFile(indexPath, '{"type":"delta"', 'utf-8')

    expect(await store.loadUsageRecords({ threadId })).toHaveLength(1)
    const repaired = await readFile(indexPath, 'utf-8')
    expect(repaired).toMatch(/\n$/)
    expect(repaired).not.toContain('{"type":"delta"\n{"type":"delta"')
  })

  it('bounds cross-thread reads at six and restores stable input order', async () => {
    let active = 0
    let maximum = 0
    const reader = {
      async loadUsageRecords(threadId: string): Promise<SessionUsageRecord[]> {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, threadId === 'thread-a' ? 20 : 1))
        active -= 1
        return [{ threadId, completedAt: '2026-08-20T00:00:00.000Z', usage: cumulative(1, 1) }]
      },
      async loadLatestUsageSnapshot(): Promise<SessionLatestUsageSnapshot | null> { return null }
    }
    const ids = Array.from({ length: 13 }, (_, index) => `thread-${String.fromCharCode(97 + index)}`)
    const records = await loadUsageRecordsFromIndex(reader, async () => ids)

    expect(maximum).toBe(6)
    expect(records.map((record) => record.threadId)).toEqual(ids)
  })
  it('isolates cross-thread usage failures and retains diagnostics', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const reader = {
      async loadUsageRecords(threadId: string): Promise<SessionUsageRecord[]> {
        if (threadId === 'thread-b') throw failure
        return [{ threadId, completedAt: '2026-08-20T00:00:00.000Z', usage: cumulative(1, 1) }]
      },
      async loadLatestUsageSnapshot(threadId: string): Promise<SessionLatestUsageSnapshot | null> {
        if (threadId === 'thread-b') throw failure
        return { threadId, seq: 1, usage: cumulative(1, 1) }
      }
    }
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const records = await loadUsageRecordsFromIndex(reader, async () => ['thread-a', 'thread-b', 'thread-c'])
      const snapshots = await loadLatestUsageSnapshotsFromIndex(reader, async () => ['thread-a', 'thread-b', 'thread-c'])
      expect(records.map((record) => record.threadId)).toEqual(['thread-a', 'thread-c'])
      expect(snapshots.map((snapshot) => snapshot.threadId)).toEqual(['thread-a', 'thread-c'])
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('thread-b (EACCES): permission denied'))
      await expect(loadUsageRecordsFromIndex(reader, async () => [], { threadId: 'thread-b' }))
        .rejects.toThrow('permission denied')
    } finally {
      warning.mockRestore()
    }
  })

  it('keeps an absent threads directory distinct from a listing failure', async () => {
    expect(await (await import('./file-session-usage-read.js')).listThreadDirs(join(root, 'missing'))).toEqual([])
    await expect(loadUsageRecordsFromIndex({
      loadUsageRecords: async () => [],
      loadLatestUsageSnapshot: async () => null
    }, async () => { throw Object.assign(new Error('I/O error'), { code: 'EIO' }) })).rejects.toThrow('I/O error')
  })

  it('rebuilds a corrupt middle row rather than trusting a later high seq', async () => {
    const threadId = 'thread-middle-corrupt'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 200, 20))
    await store.appendEvent(threadId, usageEvent(threadId, 3, '2026-08-22T00:00:00.000Z', 350, 35))
    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    const lines = (await readFile(indexPath, 'utf-8')).trimEnd().split('\n')
    const deltaIndexes = lines.map((line, index) => line.includes('"type":"delta"') ? index : -1).filter((index) => index >= 0)
    lines[deltaIndexes[1]] = 'not-json'
    await writeFile(indexPath, `${lines.join('\n')}\n`, 'utf-8')

    const records = await store.loadUsageRecords({ threadId })
    expect(records.map((record) => record.usage.promptTokens)).toEqual([100, 100, 150])
    expect(await store.loadLatestUsageSnapshots({ threadIds: [threadId] })).toEqual([
      { threadId, seq: 3, usage: cumulative(350, 35) }
    ])
    const rebuilt = await readFile(indexPath, 'utf-8')
    expect(rebuilt).not.toContain('not-json')
    expect((await readdir(join(root, 'threads', threadId))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('ignores out-of-order usage without regressing the next delta', async () => {
    const threadId = 'thread-out-of-order'
    await store.appendEvent(threadId, usageEvent(threadId, 10, '2026-08-21T00:00:00.000Z', 100, 0))
    await store.appendEvent(threadId, usageEvent(threadId, 5, '2026-08-20T00:00:00.000Z', 50, 0))
    await store.appendEvent(threadId, usageEvent(threadId, 11, '2026-08-21T00:01:00.000Z', 110, 0))

    expect((await store.loadUsageRecords({ threadId })).map((record) => record.usage.promptTokens))
      .toEqual([100, 10])
  })

  it('rebuilds on conflicting duplicate usage without regressing the next delta', async () => {
    const threadId = 'thread-conflict'
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await store.appendEvent(threadId, usageEvent(threadId, 10, '2026-08-21T00:00:00.000Z', 100, 0))
      await store.appendEvent(threadId, usageEvent(threadId, 10, '2026-08-21T00:01:00.000Z', 50, 0))
      await store.appendEvent(threadId, usageEvent(threadId, 11, '2026-08-21T00:02:00.000Z', 110, 0))

      expect(error).toHaveBeenCalledWith(expect.stringContaining('thread-conflict at seq 10'))
      expect((await store.loadUsageRecords({ threadId })).map((record) => record.usage.promptTokens))
        .toEqual([100, 10])
    } finally {
      error.mockRestore()
    }
  })

  it('ignores usage index state cleared with thread memory', async () => {
    const threadId = 'thread-clear'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    store.clearThreadMemory(threadId)
    const records = await store.loadUsageRecords({ threadId })
    expect(records).toHaveLength(1)
  })

  it('keeps append-time index reads bounded to the tail segments', async () => {
    const threadId = 'thread-append-bounded'
    // Warm the in-memory snapshot with the first event.
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    const sizeBefore = (await stat(indexPath)).size

    indexReads.reset()
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 250, 25))

    const starts = indexReads.starts()
    // The old full-file SHA256 rescan opened the index at offset 0 on every
    // append; segment hashing must only touch the region around the old end.
    expect(starts.length).toBeGreaterThan(0)
    expect(starts.every((start) => start >= sizeBefore - 64 * 1024)).toBe(true)
  })

  it('detects an externally edited index and rebuilds it from events', async () => {
    const threadId = 'thread-edited'
    await store.appendEvent(threadId, usageEvent(threadId, 1, '2026-08-20T00:00:00.000Z', 100, 10))
    await store.appendEvent(threadId, usageEvent(threadId, 2, '2026-08-21T00:00:00.000Z', 250, 25))
    const indexPath = join(root, 'threads', threadId, 'usage-index.jsonl')
    // Same-length, schema-valid edit that only hashing can notice.
    const edited = (await readFile(indexPath, 'utf-8')).replace('"seq":2', '"seq":7')
    expect(edited).toContain('"seq":7')
    await writeFile(indexPath, edited, 'utf-8')

    const records = await store.loadUsageRecords({ threadId })

    expect(records.map((record) => record.usage.promptTokens)).toEqual([100, 150])
    expect(await readFile(indexPath, 'utf-8')).not.toContain('"seq":7')
  })
})
