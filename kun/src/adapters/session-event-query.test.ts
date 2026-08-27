import { appendFile, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySessionStore } from './in-memory-session-store.js'
import {
  collectSessionEventsOfKind,
  findLatestUsageEvent,
  findSessionEvent,
  sessionEventExists
} from './session-event-query.js'
import { compactUsageEventsJsonlFile } from './file/file-session-jsonl.js'
import type { SessionStore } from '../ports/session-store.js'
import type { UsageSnapshot } from '../contracts/usage.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('session event query helpers', () => {
  it('finds and checks events without requiring callers to materialize the log', async () => {
    const store = new InMemorySessionStore()
    await store.appendEvent('thread_1', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      threadId: 'thread_1'
    })
    await store.appendEvent('thread_1', {
      kind: 'user_input_resolved',
      seq: 2,
      timestamp: '2026-01-01T00:00:01.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      inputId: 'input_1',
      status: 'submitted',
      prompt: 'q',
      questions: [],
      answers: []
    })

    await expect(sessionEventExists(
      store,
      'thread_1',
      (event) => event.kind === 'user_input_resolved' && event.inputId === 'input_1'
    )).resolves.toBe(true)
    await expect(findSessionEvent(
      store,
      'thread_1',
      (event) => event.kind === 'error'
    )).resolves.toBeNull()
  })

  it('collects usage events and latest usage without loading non-usage rows into the result', async () => {
    const store = new InMemorySessionStore()
    const usage = (tokens: number): UsageSnapshot => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: 1
    })
    await store.appendEvent('thread_usage', {
      kind: 'heartbeat',
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      threadId: 'thread_usage'
    })
    await store.appendEvent('thread_usage', {
      kind: 'usage',
      seq: 2,
      timestamp: '2026-01-01T00:00:01.000Z',
      threadId: 'thread_usage',
      model: 'deepseek-chat',
      usage: usage(10)
    })
    await store.appendEvent('thread_usage', {
      kind: 'usage',
      seq: 3,
      timestamp: '2026-01-01T00:00:02.000Z',
      threadId: 'thread_usage',
      model: 'deepseek-chat',
      usage: usage(20)
    })

    const usageEvents = await collectSessionEventsOfKind(store, 'thread_usage', 'usage')
    expect(usageEvents.map((event) => event.seq)).toEqual([2, 3])
    await expect(findLatestUsageEvent(store, 'thread_usage')).resolves.toMatchObject({
      seq: 3,
      usage: usage(20)
    })
  })
})

describe('compactUsageEventsJsonlFile', () => {
  it('rewrites usage rows without depending on atomicWriteFile string materialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-usage-compact-stream-'))
    roots.push(root)
    const path = join(root, 'events.jsonl')
    const usage = (tokens: number): UsageSnapshot => ({
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      cacheHitRate: null,
      turns: tokens
    })
    const lines = [
      {
        kind: 'heartbeat',
        seq: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        threadId: 'thr'
      },
      {
        kind: 'usage',
        seq: 2,
        timestamp: '2024-01-01T00:00:00.000Z',
        threadId: 'thr',
        model: 'deepseek-chat',
        usage: usage(1)
      },
      {
        kind: 'usage',
        seq: 3,
        timestamp: '2024-01-02T00:00:00.000Z',
        threadId: 'thr',
        model: 'deepseek-chat',
        usage: usage(2)
      },
      {
        kind: 'usage',
        seq: 4,
        timestamp: '2026-06-01T00:00:00.000Z',
        threadId: 'thr',
        model: 'deepseek-chat',
        usage: usage(3)
      }
    ]
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')

    await expect(compactUsageEventsJsonlFile(path, {
      nowIso: '2026-06-03T00:00:00.000Z',
      retentionDays: 30,
      maxRecordBytes: 1024 * 1024,
      commitReplacement: async (replace) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(true)
        await replace()
        return true
      }
    })).resolves.toBe(true)

    const rewritten = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    // Keep the heartbeat, the latest pre-cutoff usage anchor, and the latest usage.
    expect(rewritten.map((event) => event.seq)).toEqual([1, 3, 4])
  })

  it('discards its temporary rewrite when a concurrent append invalidates the snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-usage-compact-conflict-'))
    roots.push(root)
    const path = join(root, 'events.jsonl')
    const usage = (seq: number) => ({
      promptTokens: seq,
      completionTokens: 0,
      totalTokens: seq,
      cacheHitRate: null,
      turns: seq
    })
    const lines = [
      { kind: 'usage', seq: 1, timestamp: '2024-01-01T00:00:00.000Z', threadId: 'thr', usage: usage(1) },
      { kind: 'usage', seq: 2, timestamp: '2024-01-02T00:00:00.000Z', threadId: 'thr', usage: usage(2) },
      { kind: 'heartbeat', seq: 3, timestamp: '2026-01-01T00:00:00.000Z', threadId: 'thr' }
    ]
    await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')

    await expect(compactUsageEventsJsonlFile(path, {
      nowIso: '2026-06-03T00:00:00.000Z',
      retentionDays: 30,
      maxRecordBytes: 1024 * 1024,
      commitReplacement: async () => {
        await appendFile(path, `${JSON.stringify({
          kind: 'heartbeat',
          seq: 4,
          timestamp: '2026-01-01T00:00:01.000Z',
          threadId: 'thr'
        })}\n`)
        return false
      }
    })).resolves.toBe(false)

    const preserved = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(preserved.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('sessionEventExists early-exit', () => {
  it('stops iterating after the first match when iterateEventsSince is available', async () => {
    const seen: number[] = []
    const store = {
      async loadEventsSince() {
        throw new Error('loadEventsSince should not be used')
      },
      async *iterateEventsSince() {
        for (const seq of [1, 2, 3, 4, 5]) {
          seen.push(seq)
          yield {
            kind: seq === 2 ? 'user_input_resolved' : 'heartbeat',
            seq,
            timestamp: '2026-01-01T00:00:00.000Z',
            threadId: 'thread_early',
            ...(seq === 2
              ? {
                  turnId: 'turn_1',
                  itemId: 'item_1',
                  inputId: 'input_1',
                  status: 'submitted' as const,
                  prompt: 'q',
                  questions: [],
                  answers: []
                }
              : {})
          }
        }
      },
      async appendEvent() {},
      async appendItem() {},
      async rewriteItems() {},
      async loadItemSnapshot() { return { revision: 0, items: [] } },
      async rewriteItemsIfRevision() { return { applied: true as const, revision: 1 } },
      async updateItem() { return null },
      async loadItems() { return [] },
      async loadSession() { return null },
      async upsertSession() {},
      async highestSeq() { return 0 },
      async resetMemory() {},
      clearThreadMemory() {}
    }

    await expect(sessionEventExists(
      store as unknown as SessionStore,
      'thread_early',
      (event) => event.kind === 'user_input_resolved' && 'inputId' in event && event.inputId === 'input_1'
    )).resolves.toBe(true)
    expect(seen).toEqual([1, 2])
  })
})
