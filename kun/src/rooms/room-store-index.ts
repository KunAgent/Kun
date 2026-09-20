import type { DatabaseSync } from 'node:sqlite'

export function initializeRoomIndex(db: DatabaseSync, migrateRules = false): void {
  db.exec("CREATE INDEX IF NOT EXISTS room_task_request ON room_documents(json_extract(document,'$.task.requestId'),seq) WHERE kind='task';")
  db.exec("CREATE TABLE IF NOT EXISTS room_index_state (id INTEGER PRIMARY KEY, cursor INTEGER NOT NULL, complete INTEGER NOT NULL);")
  db.exec("INSERT OR IGNORE INTO room_index_state VALUES (1, 0, 0);")
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS room_message_fts USING fts5(room_id UNINDEXED, body, tokenize='trigram');")
  if (migrateRules) db.exec(`INSERT OR IGNORE INTO room_documents (kind,id,room_id,revision,document)
    SELECT 'rule_version', id || '-v' || COALESCE(json_extract(document,'$.version'),1), room_id, 0,
      json_set(document, '$.version', COALESCE(json_extract(document,'$.version'),1),
        '$.active', json(CASE WHEN json_extract(document,'$.active')=0 THEN 'false' ELSE 'true' END))
    FROM room_documents WHERE kind='rule';`)
}
export function roomIndexReady(db: DatabaseSync): boolean {
  return db.prepare('SELECT complete FROM room_index_state WHERE id=1').get()?.complete === 1
}
export function refreshRoomMessageIndex(db: DatabaseSync, id: string): void {
  const row = db.prepare("SELECT seq,room_id,document FROM room_documents WHERE kind='message' AND id=?").get(id)
  if (!row) return
  db.prepare('INSERT OR REPLACE INTO room_message_fts(rowid,room_id,body) VALUES (?,?,?)')
    .run(row.seq, row.room_id, JSON.parse(String(row.document)).body ?? '')
}
export function backfillRoomIndex(db: DatabaseSync): boolean {
  if (roomIndexReady(db)) return true
  const cursor = Number(db.prepare('SELECT cursor FROM room_index_state WHERE id=1').get()?.cursor ?? 0)
  const rows = db.prepare("SELECT id,seq FROM room_documents WHERE kind='message' AND seq>? ORDER BY seq LIMIT 128").all(cursor)
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) refreshRoomMessageIndex(db, String(row.id))
    db.prepare('UPDATE room_index_state SET cursor=?,complete=? WHERE id=1')
      .run(rows.at(-1)?.seq ?? cursor, rows.length < 128 ? 1 : 0)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return rows.length < 128
}
