import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insertUsageEventsChunked, markUsageBackfilled } from './hybrid-usage-backfill-sqlite.js'
import type { UsageRuntimeEvent } from './hybrid-thread-support.js'

function usageEvent(seq: number): UsageRuntimeEvent {
  return {
    kind: 'usage', threadId: 'thread_1', seq,
    timestamp: `2026-08-25T00:00:${String(seq).padStart(2, '0')}.000Z`,
    turnId: `turn_${seq}`, model: 'test-model',
    usage: {
      promptTokens: seq * 10, completionTokens: seq, totalTokens: seq * 11,
      cacheHitRate: null, turns: seq
    }
  }
}

describe('SQLite usage backfill chunks', () => {
  it('keeps completion unset after a second-chunk failure and resumes after restart', async () => {
    let Database: (new (path: string) => import('better-sqlite3').Database) | null = null
    try { Database = (await import('better-sqlite3')).default } catch { return }
    const root = await mkdtemp(join(tmpdir(), 'kun-usage-backfill-'))
    const path = join(root, 'index.sqlite3')
    const events = Array.from({ length: 401 }, (_value, index) => usageEvent(index + 1))
    let db: import('better-sqlite3').Database | null = null
    try {
      try { db = new Database(path) } catch { return }
      db.exec(`
        CREATE TABLE threads (
          id TEXT PRIMARY KEY, usage_backfilled INTEGER NOT NULL DEFAULT 0,
          usage_backfill_high_water INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE usage_events (
          thread_id TEXT NOT NULL, seq INTEGER NOT NULL, timestamp TEXT NOT NULL,
          turn_id TEXT, model TEXT, provider_id TEXT, usage_json TEXT NOT NULL,
          PRIMARY KEY(thread_id, seq)
        );
        INSERT INTO threads (id) VALUES ('thread_1');
        CREATE TRIGGER fail_second_usage_chunk BEFORE INSERT ON usage_events
        WHEN NEW.seq = 201 BEGIN SELECT RAISE(ABORT, 'injected second chunk failure'); END;
      `)

      await expect(insertUsageEventsChunked(db, 'thread_1', events, 0, async () => undefined))
        .rejects.toThrow('injected second chunk failure')
      expect(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get()).toEqual({ count: 200 })
      expect(db.prepare(`
        SELECT usage_backfilled, usage_backfill_high_water FROM threads WHERE id = 'thread_1'
      `).get()).toEqual({ usage_backfilled: 0, usage_backfill_high_water: 200 })

      db.exec('DROP TRIGGER fail_second_usage_chunk')
      db.close()
      db = new Database(path)
      await insertUsageEventsChunked(db, 'thread_1', events, 200, async () => undefined)
      markUsageBackfilled(db, 'thread_1')

      expect(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get()).toEqual({ count: 401 })
      expect(db.prepare(`
        SELECT usage_backfilled, usage_backfill_high_water FROM threads WHERE id = 'thread_1'
      `).get()).toEqual({ usage_backfilled: 1, usage_backfill_high_water: 401 })
      expect(db.prepare(`
        SELECT seq FROM usage_events WHERE thread_id = 'thread_1' ORDER BY seq DESC LIMIT 1
      `).get()).toEqual({ seq: 401 })
    } finally {
      db?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
