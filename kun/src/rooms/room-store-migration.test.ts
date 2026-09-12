import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import type { RoomRule } from '../contracts/rooms-product.js'

const roots: string[] = []
const stores: SqliteRoomStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function legacy() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-schema1-'))
  roots.push(root)
  const path = join(root, 'rooms.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE room_documents (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, id TEXT NOT NULL,
    room_id TEXT, task_id TEXT, revision INTEGER NOT NULL, status TEXT, archived INTEGER NOT NULL DEFAULT 0,
    document TEXT NOT NULL, UNIQUE(kind,id));
    CREATE TABLE room_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE room_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, events TEXT NOT NULL);
    PRAGMA user_version=1;`)
  const insert = db.prepare('INSERT INTO room_documents(kind,id,room_id,task_id,revision,status,document) VALUES(?,?,?,?,?,?,?)')
  insert.run('room', 'room', 'room', null, 4, null, JSON.stringify({ id: 'room', name: 'Migration Room' }))
  for (let i = 0; i < 140; i++) insert.run('message', 'message_' + i, 'room', null, i % 3, null,
    JSON.stringify({ id: 'message_' + i, body: i % 2 ? '中文搜索 历史消息 ' + i : 'Mixed Case Search history ' + i }))
  insert.run('rule', 'rule_one', 'room', null, 0, null,
    JSON.stringify({ id: 'rule_one', messageId: 'message_1', body: 'Keep existing tests.', version: 1 }))
  insert.run('rule', 'rule_three', 'room', null, 2, null,
    JSON.stringify({ id: 'rule_three', messageId: 'message_3', body: 'Known third version.', version: 3, active: false }))
  insert.run('task', 'task', 'room', 'task', 9, 'completed', JSON.stringify({
    task: { id: 'task', requestId: 'request', status: 'completed', executionThreadId: 'old-thread', latestDeliveryId: 'delivery' } }))
  insert.run('delivery', 'delivery', 'room', 'task', 0, null, JSON.stringify({
    id: 'delivery', versionHash: 'a'.repeat(40), pinRef: 'refs/kun/rooms/task/delivery' }))
  db.prepare('INSERT INTO room_events(seq,room_id,kind,payload,created_at) VALUES(?,?,?,?,?)')
    .run(70, 'room', 'message.created', JSON.stringify({ id: 'message_1' }), '2026-09-01T00:00:00.000Z')
  db.prepare('INSERT INTO room_requests(id,fingerprint,result,events) VALUES(?,?,?,?)')
    .run('old-receipt', 'f'.repeat(64), JSON.stringify({ requestId: 'request' }), '[]')
  db.close()
  return path
}
function open(path: string) { const store = new SqliteRoomStore({ path }); stores.push(store); return store }

describe('room SQLite schema 1 to 2 migration', () => {
  it('preserves row cursors, revisions, execution IDs, delivery pins and receipts while backfilling searchable history', async () => {
    const path = await legacy()
    const store = open(path)
    expect(await store.get('room', 'room')).toMatchObject({ seq: 1, revision: 4 })
    expect(await store.get('message', 'message_139')).toMatchObject({ seq: 141, revision: 1 })
    expect((await store.get<{ task: { executionThreadId: string } }>('task', 'task'))?.value.task.executionThreadId).toBe('old-thread')
    expect(await store.get('delivery', 'delivery')).toMatchObject({ value: { pinRef: 'refs/kun/rooms/task/delivery', versionHash: 'a'.repeat(40) } })
    expect((await store.getRequest('old-receipt'))?.result).toEqual({ requestId: 'request' })
    expect(await store.events('room', 69)).toMatchObject([{ seq: 70, payload: { id: 'message_1' } }])
    expect(await store.list('task', { requestId: 'request' })).toHaveLength(1)
    // Search remains correct before the asynchronous FTS backfill completes.
    expect(await store.list('message', { roomId: 'room', search: '中文搜索', limit: 1000 })).toHaveLength(70)
    await vi.waitFor(() => {
      const db = new DatabaseSync(path, { readOnly: true })
      try { expect(db.prepare('SELECT complete FROM room_index_state WHERE id=1').get()?.complete).toBe(1) }
      finally { db.close() }
    })
    expect(await store.list('message', { roomId: 'room', search: 'case search', limit: 1000 })).toHaveLength(70)
    expect(await store.list('message', { roomId: 'room', search: '中文搜索', limit: 1000 })).toHaveLength(70)
    expect(await store.list('message', { roomId: 'room', search: '搜索', limit: 1000 })).toHaveLength(70)
    const db = new DatabaseSync(path, { readOnly: true })
    try { expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2) } finally { db.close() }
  })

  it('migrates only known rule versions and never fabricates v1 from later content on repeated startup', async () => {
    const path = await legacy()
    const store = open(path)
    expect((await store.get<RoomRule>('rule_version', 'rule_one-v1'))?.value).toMatchObject({ version: 1, active: true, body: 'Keep existing tests.' })
    expect((await store.get<RoomRule>('rule_version', 'rule_three-v3'))?.value).toMatchObject({ version: 3, active: false })
    expect(await store.get('rule_version', 'rule_three-v1')).toBeNull()
    await store.close()
    const reopened = open(path)
    expect(await reopened.list('rule_version', { roomId: 'room' })).toHaveLength(2)
    expect(await reopened.get('rule_version', 'rule_three-v1')).toBeNull()
    await expect(reopened.commit({ requestId: 'rewrite-history', checks: [{ kind: 'rule_version', id: 'rule_one-v1', expectedRevision: 0 }],
      puts: [{ kind: 'rule_version', id: 'rule_one-v1', roomId: 'room', value: { body: 'changed history' } }] })).rejects.toThrow('immutable')
  })

  it('rolls back the upgrade marker and derived indexes when initialization fails, then resumes without losing history', async () => {
    const path = await legacy()
    const bad = new DatabaseSync(path)
    bad.exec('CREATE TABLE room_index_state (only_bad_column TEXT);')
    bad.close()
    await expect(open(path).get('room', 'room')).rejects.toThrow()
    const db = new DatabaseSync(path)
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
      expect(db.prepare("SELECT count(*) AS n FROM room_documents WHERE kind='rule_version'").get()?.n).toBe(0)
      expect(db.prepare("SELECT count(*) AS n FROM room_documents WHERE kind='message'").get()?.n).toBe(140)
      db.exec('DROP TABLE room_index_state;')
    } finally { db.close() }
    expect(await open(path).get('message', 'message_139')).toMatchObject({ seq: 141, revision: 1 })
  })

  it('refuses future schema versions instead of rewriting them', async () => {
    const path = await legacy()
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version=3;')
    db.close()
    await expect(open(path).get('room', 'room')).rejects.toThrow('newer Kun version')
    const after = new DatabaseSync(path, { readOnly: true })
    try { expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(3) } finally { after.close() }
  })
})
