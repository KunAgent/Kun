import type { Database as BetterSqliteDatabase } from 'better-sqlite3'

export const MEMORY_INDEX_SCHEMA_VERSION = 1

export function migrateMemoryIndex(db: BetterSqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  const currentVersion = memoryIndexSchemaVersion(db)
  if (currentVersion > MEMORY_INDEX_SCHEMA_VERSION) {
    throw new Error(
      `memory index schema ${currentVersion} is newer than supported schema ${MEMORY_INDEX_SCHEMA_VERSION}`
    )
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
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
    CREATE INDEX IF NOT EXISTS memory_records_scope_idx
      ON memory_records(scope, workspace, project, lifecycle);
    CREATE INDEX IF NOT EXISTS memory_records_updated_idx
      ON memory_records(updated_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS memory_records_type_idx
      ON memory_records(type, scope, lifecycle);
    CREATE TABLE IF NOT EXISTS memory_sources (
      memory_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      locator TEXT,
      trust TEXT NOT NULL,
      PRIMARY KEY(memory_id, source_id),
      FOREIGN KEY(memory_id) REFERENCES memory_records(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS memory_reconciliation (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      search_tokens,
      tokenize='unicode61'
    );
  `)
  db.prepare(`
    INSERT INTO memory_index_meta(key, value) VALUES('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(String(MEMORY_INDEX_SCHEMA_VERSION))
}

export function memoryIndexSchemaVersion(db: BetterSqliteDatabase): number {
  const row = db.prepare("SELECT value FROM memory_index_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  const version = Number(row?.value ?? 0)
  return Number.isSafeInteger(version) && version >= 0 ? version : 0
}
