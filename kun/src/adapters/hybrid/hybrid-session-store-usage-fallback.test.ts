import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyUsageSnapshot, type UsageSnapshot } from '../../contracts/usage.js'
import type { UsageEvent } from '../../contracts/events.js'
import { HybridSessionStore } from './hybrid-session-store.js'
import type { HybridThreadStore } from './hybrid-thread-store.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
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

function usageEvent(threadId: string, seq: number, timestamp: string, p: number, c: number): UsageEvent {
  return { kind: 'usage', threadId, seq, timestamp, usage: cumulative(p, c) }
}

function failingIndex(): HybridThreadStore {
  return {
    noteEvent: vi.fn(async () => undefined),
    loadUsageRecords: vi.fn(async () => {
      throw new Error('better-sqlite3 native binding failed')
    }),
    loadLatestUsageSnapshots: vi.fn(async () => {
      throw new Error('better-sqlite3 native binding failed')
    })
  } as unknown as HybridThreadStore
}

describe('HybridSessionStore usage fallback', () => {
  it('serves ranged usage queries from the file index when SQLite fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-fallback-'))
    roots.push(root)
    const store = new HybridSessionStore({ dataDir: root, index: failingIndex() })

    await store.appendEvent('thread-x', usageEvent('thread-x', 1, '2026-08-01T00:00:00.000Z', 1_000, 100))
    await store.appendEvent('thread-x', usageEvent('thread-x', 2, '2026-08-20T00:00:00.000Z', 1_200, 140))

    const records = await store.loadUsageRecords({
      fromInclusive: '2026-08-19T00:00:00.000Z',
      toExclusive: '2026-08-21T00:00:00.000Z'
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      threadId: 'thread-x',
      completedAt: '2026-08-20T00:00:00.000Z',
      usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
    })
  })

  it('serves latest usage snapshots from the file index when SQLite fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-fallback-'))
    roots.push(root)
    const store = new HybridSessionStore({ dataDir: root, index: failingIndex() })

    await store.appendEvent('thread-x', usageEvent('thread-x', 1, '2026-08-20T00:00:00.000Z', 300, 30))

    const snapshots = await store.loadLatestUsageSnapshots({ threadIds: ['thread-x'] })

    expect(snapshots).toEqual([
      { threadId: 'thread-x', seq: 1, usage: cumulative(300, 30) }
    ])
  })
})
