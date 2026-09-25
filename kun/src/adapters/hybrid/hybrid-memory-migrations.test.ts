import { describe, expect, it } from 'vitest'
import {
  MEMORY_INDEX_SCHEMA_VERSION,
  memoryIndexSchemaVersion,
  migrateMemoryIndex
} from './hybrid-memory-migrations.js'

type SqliteDatabase = import('better-sqlite3').Database

async function openMemoryDatabase(): Promise<SqliteDatabase | null> {
  try {
    const Database = (await import('better-sqlite3')).default
    return new Database(':memory:')
  } catch {
    return null
  }
}

/** The V1 memory_records layout shipped before the authority column existed. */
function createV1MemoryIndex(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE memory_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO memory_index_meta(key, value) VALUES('schema_version', '1');
    CREATE TABLE memory_records (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      workspace TEXT,
      project TEXT,
      lifecycle TEXT NOT NULL,
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      observed_at TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL,
      canonical_hash TEXT NOT NULL,
      search_tokens TEXT NOT NULL,
      source_summaries_json TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    INSERT INTO memory_records VALUES (
      'mem_v1', 'user', NULL, NULL, 'active', 'fact', 1, 0.5,
      '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z',
      'hash', 'alpha', '[]', '{}'
    );
  `)
}

describe('migrateMemoryIndex', () => {
  it('upgrades a V1 index by adding authority before indexing it', async () => {
    const db = await openMemoryDatabase()
    if (!db) return
    try {
      createV1MemoryIndex(db)
      expect(() => migrateMemoryIndex(db)).not.toThrow()
      expect(memoryIndexSchemaVersion(db)).toBe(MEMORY_INDEX_SCHEMA_VERSION)
      const row = db.prepare("SELECT authority FROM memory_records WHERE id = 'mem_v1'").get() as
        | { authority: string }
        | undefined
      expect(row?.authority).toBe('reference')
      const indexes = db.prepare('PRAGMA index_list(memory_records)').all() as Array<{ name: string }>
      expect(indexes.map((index) => index.name)).toContain('memory_records_authority_idx')
      // Re-running on an already migrated database stays idempotent.
      expect(() => migrateMemoryIndex(db)).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('creates the authority column and index on a fresh database', async () => {
    const db = await openMemoryDatabase()
    if (!db) return
    try {
      migrateMemoryIndex(db)
      const columns = db.prepare('PRAGMA table_info(memory_records)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toContain('authority')
    } finally {
      db.close()
    }
  })
})
