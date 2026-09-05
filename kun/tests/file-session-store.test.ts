import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageSnapshot } from '../src/contracts/usage.js'
import type { TurnItem } from '../src/contracts/items.js'

const atomicWriteFileMock = vi.hoisted(() => vi.fn())
const compactUsageEventsJsonlFileMock = vi.hoisted(() => vi.fn())

vi.mock('../src/adapters/file/atomic-write.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/file/atomic-write.js')>(),
  atomicWriteFile: atomicWriteFileMock
}))

vi.mock('../src/adapters/file/file-session-jsonl.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/adapters/file/file-session-jsonl.js')>()
  compactUsageEventsJsonlFileMock.mockImplementation(actual.compactUsageEventsJsonlFile)
  return {
    ...actual,
    compactUsageEventsJsonlFile: (...args: Parameters<typeof actual.compactUsageEventsJsonlFile>) =>
      compactUsageEventsJsonlFileMock(...args)
  }
})

const { FileSessionStore } = await import('../src/adapters/file/file-session-store.js')
const jsonl = await import('../src/adapters/file/file-session-jsonl.js')

describe('FileSessionStore', () => {
  let dataDir = ''
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-session-'))
    atomicWriteFileMock.mockReset()
    atomicWriteFileMock.mockResolvedValue(undefined)
    compactUsageEventsJsonlFileMock.mockReset()
    compactUsageEventsJsonlFileMock.mockImplementation(jsonl.compactUsageEventsJsonlFile)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('keeps appended usage events when best-effort compaction fails', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      compactionDelayMs: 0,
      usageEventCompaction: {
        maxBytes: 1,
        retentionDays: 365,
        nowIso: () => '2026-06-03T00:00:00.000Z'
      }
    })
    const usage = (tokens: number): UsageSnapshot => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: tokens
    })

    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(1)
    })
    await sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 2,
      timestamp: '2025-06-04T00:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(2)
    })

    const error = new Error('operation not permitted') as Error & { code: string }
    error.code = 'EPERM'
    compactUsageEventsJsonlFileMock.mockRejectedValueOnce(error)

    await expect(sessionStore.appendEvent('thr_usage_compact', {
      kind: 'usage',
      seq: 3,
      timestamp: '2025-06-04T01:00:00.000Z',
      threadId: 'thr_usage_compact',
      model: 'deepseek-chat',
      usage: usage(3)
    })).resolves.toBeUndefined()
    await sessionStore.flushScheduledCompaction('thr_usage_compact')

    const events = await sessionStore.loadEventsSince('thr_usage_compact', 0)
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(compactUsageEventsJsonlFileMock).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('usage event compaction failed'))
  })

  it('schedules item compaction without blocking cold loadItems', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      compactionDelayMs: 60_000,
      itemHistoryCompactionMinBytes: 1
    })
    const threadId = 'thr_schedule_items'
    for (let index = 0; index < 5; index += 1) {
      await sessionStore.appendItem(threadId, {
        id: 'item_1',
        kind: 'assistant_text',
        turnId: 'turn_1',
        threadId,
        role: 'assistant',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        text: `v${index}-${'x'.repeat(256)}`
      })
    }
    sessionStore.clearThreadMemory(threadId)
    const items = await sessionStore.loadItems(threadId)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: expect.stringContaining('v4-') })
    // Debounced rewrite has not run yet; source still has multiple append lines.
    const raw = await (await import('node:fs/promises')).readFile(
      join(dataDir, 'threads', threadId, 'messages.jsonl'),
      'utf8'
    )
    expect(raw.trim().split('\n').length).toBeGreaterThan(1)
  })

  it('loadEventsSince streams a high sinceSeq without requiring a full-array filter', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    const threadId = 'thr_stream_load'
    for (let seq = 1; seq <= 40; seq += 1) {
      await sessionStore.appendEvent(threadId, {
        kind: 'heartbeat',
        seq,
        timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
        threadId
      })
    }
    const events = await sessionStore.loadEventsSince(threadId, 35)
    expect(events.map((event) => event.seq)).toEqual([36, 37, 38, 39, 40])
  })

  it('pages event history with a forward byte cursor and bounded results', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    const threadId = 'thr_event_pages'
    for (let seq = 1; seq <= 5; seq += 1) {
      await sessionStore.appendEvent(threadId, {
        kind: 'heartbeat', seq, timestamp: `2026-01-01T00:00:0${seq}.000Z`, threadId
      })
    }

    const first = await sessionStore.loadEventPage(threadId, { sinceSeq: 0, maxEvents: 2 })
    expect(first.events.map((event) => event.seq)).toEqual([1, 2])
    expect(first).toMatchObject({ hasMore: true, nextCursor: expect.any(String) })
    await sessionStore.appendEvent(threadId, {
      kind: 'heartbeat', seq: 6, timestamp: '2026-01-01T00:00:06.000Z', threadId
    })
    const second = await sessionStore.loadEventPage(threadId, {
      sinceSeq: 2, cursor: first.nextCursor, maxEvents: 2
    })
    const third = await sessionStore.loadEventPage(threadId, {
      sinceSeq: 4, cursor: second.nextCursor, maxEvents: 2
    })
    expect(second.events.map((event) => event.seq)).toEqual([3, 4])
    expect(third.events.map((event) => event.seq)).toEqual([5, 6])
    expect(third.hasMore).toBe(false)
  })

  it('bounds event history while preserving the durable high-water mark', async () => {
    const sessionStore = new FileSessionStore({
      dataDir,
      compactionDelayMs: 0,
      eventHistoryCompaction: { maxBytes: 700, retainBytes: 350 }
    })
    const threadId = 'thr_event_retention'
    for (let seq = 1; seq <= 12; seq += 1) {
      await sessionStore.appendEvent(threadId, {
        kind: 'error', seq, timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
        threadId, message: 'x'.repeat(80)
      })
    }
    await sessionStore.flushScheduledCompaction(threadId)

    const retained = await sessionStore.loadEventsSince(threadId, 0)
    expect(warnSpy.mock.calls).toEqual([])
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThan(12)
    expect(retained.at(-1)?.seq).toBe(12)
    expect(await sessionStore.eventReplayFloorSeq(threadId)).toBe(retained[0]?.seq)
    expect(await sessionStore.highestSeq(threadId)).toBe(12)
  })

  it('caches the event high-water mark until the event file changes', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await sessionStore.appendEvent('thr_high_water', {
      kind: 'heartbeat', seq: 42, timestamp: '2026-01-01T00:00:00.000Z', threadId: 'thr_high_water'
    })

    expect(await sessionStore.highestSeq('thr_high_water')).toBe(42)
    await appendFile(join(dataDir, 'threads', 'thr_high_water', 'events.jsonl'), `${JSON.stringify({
      kind: 'heartbeat', seq: 43, timestamp: '2026-01-01T00:00:01.000Z', threadId: 'thr_high_water'
    })}\n`)
    expect(await sessionStore.highestSeq('thr_high_water')).toBe(43)

    await writeFile(join(dataDir, 'threads', 'thr_high_water', 'events.jsonl'), `${JSON.stringify({
      kind: 'heartbeat', seq: 7, timestamp: '2026-01-01T00:00:02.000Z', threadId: 'thr_high_water'
    })}\n`)
    expect(await sessionStore.highestSeq('thr_high_water')).toBe(7)
  })

  it('ignores an uncommitted event tail and refreshes the cached high-water mark', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    const threadId = 'thr_partial_high_water'
    await sessionStore.appendEvent(threadId, {
      kind: 'heartbeat', seq: 1, timestamp: '2026-01-01T00:00:00.000Z', threadId
    })
    const eventsPath = join(dataDir, 'threads', threadId, 'events.jsonl')
    const eventTwo = JSON.stringify({
      kind: 'heartbeat', seq: 2, timestamp: '2026-01-01T00:00:01.000Z', threadId
    })

    await appendFile(eventsPath, eventTwo.slice(0, Math.ceil(eventTwo.length / 2)))
    expect(await sessionStore.highestSeq(threadId)).toBe(1)
    await expect((async () => {
      const seen: number[] = []
      for await (const event of sessionStore.iterateEventsSince(threadId, 0)) seen.push(event.seq)
      return seen
    })()).resolves.toEqual([1])

    await appendFile(eventsPath, `${eventTwo.slice(Math.ceil(eventTwo.length / 2))}\n`)
    expect(await sessionStore.highestSeq(threadId)).toBe(2)
  })

  it('repairs and records a crash-torn event tail before the next append', async () => {
    const threadId = 'thr_torn_tail'
    const writer = new FileSessionStore({ dataDir })
    await writer.appendEvent(threadId, {
      kind: 'heartbeat', seq: 1, timestamp: '2026-01-01T00:00:00.000Z', threadId
    })
    const threadDir = join(dataDir, 'threads', threadId)
    const eventsPath = join(threadDir, 'events.jsonl')
    await appendFile(eventsPath, '{"kind":"heartbeat","seq":2')

    // A restarted store must discard the bytes that were never committed by
    // a newline before it accepts another durable record.
    const restarted = new FileSessionStore({ dataDir })
    await restarted.appendEvent(threadId, {
      kind: 'heartbeat', seq: 3, timestamp: '2026-01-01T00:00:02.000Z', threadId
    })

    expect((await restarted.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([1, 3])
    const evidence = JSON.parse(await readFile(join(threadDir, 'events.torn-tail.json'), 'utf8')) as {
      truncatedBytes: number
      sampleBase64: string
    }
    expect(evidence.truncatedBytes).toBeGreaterThan(0)
    expect(Buffer.from(evidence.sampleBase64, 'base64').toString('utf8')).toContain('"seq":2')
    expect(await readFile(eventsPath, 'utf8')).toMatch(/"seq":1[^\n]*\n.*"seq":3[^\n]*\n$/s)
  })

  it('uses the replay record limit when reading a large first event as the floor', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    const threadId = 'thr_large_floor'
    await sessionStore.appendEvent(threadId, {
      kind: 'error',
      seq: 91,
      timestamp: '2026-01-01T00:00:00.000Z',
      threadId,
      message: 'x'.repeat(1024 * 1024 + 32)
    })

    await expect(sessionStore.eventReplayFloorSeq(threadId)).resolves.toBe(91)
  })

  it('streams replay records in order and rejects an oversized unterminated record', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    for (const seq of [1, 2, 3]) {
      await sessionStore.appendEvent('thr_streamed_replay', {
        kind: 'heartbeat', seq, timestamp: `2026-01-01T00:00:0${seq}.000Z`, threadId: 'thr_streamed_replay'
      })
    }
    const replayed: number[] = []
    for await (const event of sessionStore.iterateEventsSince('thr_streamed_replay', 1)) {
      replayed.push(event.seq)
    }
    expect(replayed).toEqual([2, 3])

    await appendFile(
      join(dataDir, 'threads', 'thr_streamed_replay', 'events.jsonl'),
      JSON.stringify({ kind: 'heartbeat', seq: 4, timestamp: '2026-01-01T00:00:04.000Z', threadId: 'thr_streamed_replay', payload: 'x'.repeat(512) })
    )
    const oversized = async () => {
      for await (const _event of sessionStore.iterateEventsSince('thr_streamed_replay', 3, { maxRecordBytes: 128 })) {
        // Consume until the record-size guard rejects.
      }
    }
    await expect(oversized()).rejects.toThrow('event replay record exceeds 128 bytes')
  })

  it('loadItems reads from disk and keeps the latest value in its original timeline slot', async () => {
    const item = (id: string, text: string): TurnItem => ({
      id,
      kind: 'assistant_text',
      turnId: 't1',
      threadId: 'thr_x',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      text
    })
    const writer = new FileSessionStore({ dataDir })
    await writer.appendItem('thr_x', item('a', 'A'))
    await writer.appendItem('thr_x', item('b', 'B'))
    await writer.appendItem('thr_x', item('c', 'C'))
    await writer.appendItem('thr_x', item('b', 'B-updated')) // same id, newer write

    // A fresh store has a cold cache, so loadItems hits the on-disk dedup path.
    // Rewriting an item updates its value without moving it behind later tool
    // calls or messages in the reconstructed conversation timeline.
    const reader = new FileSessionStore({ dataDir })
    const items = await reader.loadItems('thr_x')
    expect(items.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(items.find((entry) => entry.id === 'b')).toMatchObject({ text: 'B-updated' })
  })

  it('forgets cached items for a deleted thread', async () => {
    const sessionStore = new FileSessionStore({ dataDir })
    await sessionStore.appendItem('thr_deleted', {
      id: 'item_1',
      kind: 'assistant_text',
      turnId: 'turn_1',
      threadId: 'thr_deleted',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      text: 'cached'
    })
    expect(await sessionStore.loadItems('thr_deleted')).toHaveLength(1)
    await rm(join(dataDir, 'threads', 'thr_deleted'), { recursive: true, force: true })

    sessionStore.clearThreadMemory('thr_deleted')

    expect(await sessionStore.loadItems('thr_deleted')).toEqual([])
  })
})
