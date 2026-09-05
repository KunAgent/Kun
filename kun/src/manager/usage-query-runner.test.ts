import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { runUsageAggregateQuery } from './usage-query-runner.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('usage aggregate query runner', () => {
  it('returns the compact public DTO from cumulative usage rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-usage-worker-'))
    roots.push(root)
    const sqlitePath = join(root, 'index.sqlite3')
    const db = new Database(sqlitePath)
    db.exec(`
      CREATE TABLE usage_events (
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        turn_id TEXT,
        model TEXT,
        provider_id TEXT,
        usage_json TEXT NOT NULL,
        PRIMARY KEY(thread_id, seq)
      )
    `)
    const insert = db.prepare(`
      INSERT INTO usage_events
        (thread_id, seq, timestamp, turn_id, model, provider_id, usage_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run('thread-1', 1, '2026-08-01T01:00:00.000Z', 'turn-1', 'model-a', 'provider-a',
      JSON.stringify({ ...emptyUsageSnapshot(), promptTokens: 10, totalTokens: 10, turns: 1 }))
    insert.run('thread-1', 2, '2026-08-01T02:00:00.000Z', 'turn-2', 'model-a', 'provider-a',
      JSON.stringify({ ...emptyUsageSnapshot(), promptTokens: 30, totalTokens: 30, turns: 2 }))
    db.close()

    const result = runUsageAggregateQuery({
      sqlitePath,
      query: { groupBy: 'thread', threadId: 'thread-1' },
      liveRecords: [{
        threadId: 'thread-1',
        turnId: 'turn-2',
        model: 'model-a',
        providerId: 'provider-a',
        completedAt: '2026-08-01T02:00:01.000Z',
        usage: {
          ...emptyUsageSnapshot(),
          promptTokens: 35,
          totalTokens: 35,
          turns: 2
        },
        cumulative: true
      }]
    })

    expect(result).toMatchObject({
      group_by: 'thread',
      buckets: [{ thread_id: 'thread-1', input_tokens: 35, total_tokens: 35 }],
      totals: { input_tokens: 35, total_tokens: 35, turns: 2 }
    })
    expect(JSON.stringify(result)).not.toContain('usage_json')
  })

  it('aggregates 2100 indexed threads within the worker budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-usage-worker-large-'))
    roots.push(root)
    const sqlitePath = join(root, 'index.sqlite3')
    const db = new Database(sqlitePath)
    db.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE usage_events (
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        turn_id TEXT,
        model TEXT,
        provider_id TEXT,
        usage_json TEXT NOT NULL,
        PRIMARY KEY(thread_id, seq)
      );
      CREATE INDEX usage_events_timestamp_idx ON usage_events(timestamp);
      CREATE INDEX usage_events_thread_timestamp_seq_idx
        ON usage_events(thread_id, timestamp DESC, seq DESC);
    `)
    const insertThread = db.prepare('INSERT INTO threads (id, status) VALUES (?, ?)')
    const insertUsage = db.prepare(`
      INSERT INTO usage_events
        (thread_id, seq, timestamp, turn_id, model, provider_id, usage_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      for (let index = 0; index < 2_100; index += 1) {
        const threadId = `thread-${index}`
        insertThread.run(threadId, index === 0 ? 'deleted' : 'active')
        insertUsage.run(
          threadId, 1, '2026-07-31T23:00:00.000Z', `turn-${index}-1`, 'model-a', 'provider-a',
          JSON.stringify({ ...emptyUsageSnapshot(), promptTokens: 10, totalTokens: 10, turns: 1 })
        )
        insertUsage.run(
          threadId, 2, '2026-08-01T01:00:00.000Z', `turn-${index}-2`, 'model-a', 'provider-a',
          JSON.stringify({ ...emptyUsageSnapshot(), promptTokens: 30, totalTokens: 30, turns: 2 })
        )
      }
    })()
    db.close()

    const range = {
      from: '2026-08-01',
      to: '2026-08-01',
      timezone: 'UTC',
      fromInclusive: '2026-08-01T00:00:00.000Z',
      toExclusive: '2026-08-02T00:00:00.000Z'
    }
    const startedAt = performance.now()
    const daily = runUsageAggregateQuery({
      sqlitePath,
      query: { groupBy: 'day', ...range }
    })
    const model = runUsageAggregateQuery({
      sqlitePath,
      query: { groupBy: 'model', ...range }
    })
    const elapsedMs = performance.now() - startedAt

    expect(daily).toMatchObject({
      group_by: 'day',
      buckets: [{ date: '2026-08-01', input_tokens: 41_980, thread_count: 2_099 }],
      totals: { input_tokens: 41_980, turns: 2_099, thread_count: 2_099 }
    })
    expect(model).toMatchObject({
      group_by: 'model',
      buckets: [{ model: 'model-a', input_tokens: 41_980, thread_count: 2_099 }],
      totals: { input_tokens: 41_980, turns: 2_099, thread_count: 2_099 }
    })
    expect(elapsedMs).toBeLessThan(5_000)
  })
})
