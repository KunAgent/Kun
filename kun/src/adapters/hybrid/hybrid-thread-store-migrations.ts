import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { addColumnIfMissing } from './hybrid-thread-support.js'

export function migrateHybridThreadStore(db: BetterSqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT NOT NULL,
      model TEXT NOT NULL,
      agent_surface TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      sandbox_mode TEXT NOT NULL,
      approval_reviewer TEXT NOT NULL DEFAULT 'user',
      model_request_capture_enabled INTEGER NOT NULL DEFAULT 0,
      cost_budget_usd REAL,
      cost_budget_warning_sent INTEGER,
      relation TEXT NOT NULL,
      parent_thread_id TEXT,
      forked_from_thread_id TEXT,
      forked_from_title TEXT,
      forked_at TEXT,
      forked_from_message_count INTEGER,
      forked_from_turn_count INTEGER,
      goal_json TEXT,
      todos_json TEXT,
      extension_metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      preview TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      event_seq_high_water INTEGER NOT NULL DEFAULT 0,
      usage_backfilled INTEGER NOT NULL DEFAULT 0,
      usage_backfill_high_water INTEGER NOT NULL DEFAULT 0,
      metadata_path TEXT NOT NULL,
      messages_path TEXT NOT NULL,
      events_path TEXT NOT NULL,
      search_text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS threads_updated_idx
      ON threads(updated_at_ms DESC, id DESC);
    CREATE INDEX IF NOT EXISTS threads_workspace_updated_idx
      ON threads(workspace, updated_at_ms DESC, id DESC);
    CREATE INDEX IF NOT EXISTS threads_status_updated_idx
      ON threads(status, updated_at_ms DESC, id DESC);
    CREATE INDEX IF NOT EXISTS threads_relation_updated_idx
      ON threads(relation, updated_at_ms DESC, id DESC);
    CREATE TABLE IF NOT EXISTS usage_events (
      thread_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      turn_id TEXT, model TEXT, provider_id TEXT,
      usage_json TEXT NOT NULL,
      PRIMARY KEY(thread_id, seq)
    );
    CREATE INDEX IF NOT EXISTS usage_events_thread_seq_idx
      ON usage_events(thread_id, seq);
    CREATE INDEX IF NOT EXISTS usage_events_timestamp_idx
      ON usage_events(timestamp);
  `)
  addColumnIfMissing(db, 'threads', 'todos_json TEXT')
  addColumnIfMissing(db, 'threads', 'extension_metadata_json TEXT')
  addColumnIfMissing(db, 'threads', 'model_request_capture_enabled INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'threads', "approval_reviewer TEXT NOT NULL DEFAULT 'user'")
  migrateHybridUsageBackfillState(db)
  migrateHybridUsageIndexes(db)
  addColumnIfMissing(db, 'threads', 'agent_surface TEXT')
  addColumnIfMissing(db, 'usage_events', 'provider_id TEXT')
}

export function migrateHybridUsageIndexes(db: BetterSqliteDatabase): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS usage_events_thread_timestamp_seq_idx
      ON usage_events(thread_id, timestamp DESC, seq DESC)
  `)
}

export function migrateHybridUsageBackfillState(db: BetterSqliteDatabase): void {
  const columns = db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  const missingCompletion = !names.has('usage_backfilled')
  const missingHighWater = !names.has('usage_backfill_high_water')
  if (!missingCompletion && !missingHighWater) return
  db.transaction(() => {
    if (missingCompletion) {
      db.exec('ALTER TABLE threads ADD COLUMN usage_backfilled INTEGER NOT NULL DEFAULT 0')
    }
    if (missingHighWater) {
      db.exec('ALTER TABLE threads ADD COLUMN usage_backfill_high_water INTEGER NOT NULL DEFAULT 0')
      // Earlier versions could mark partially written usage as complete.
      // Reopen all rows exactly once when this recovery state is introduced.
      db.exec('UPDATE threads SET usage_backfilled = 0, usage_backfill_high_water = 0')
    }
  })()
}
