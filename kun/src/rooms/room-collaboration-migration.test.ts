import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { control, link } from './room-collaboration-test-fixtures.js'

const roots: string[] = [], stores: SqliteRoomStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})
async function v4() {
  const root = await mkdtemp(join(tmpdir(), 'kun-collaboration-v4-')); roots.push(root)
  const path = join(root, 'rooms.sqlite'), db = new DatabaseSync(path)
  // Construct the actual v4 storage format; never manufacture a v4 fixture by downgrading a v5 marker.
  db.exec(`CREATE TABLE room_documents (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,room_id TEXT,task_id TEXT,
    revision INTEGER NOT NULL,status TEXT,archived INTEGER NOT NULL DEFAULT 0,document TEXT NOT NULL,UNIQUE(kind,id));
    CREATE TABLE room_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,kind TEXT NOT NULL,
      payload TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE room_requests (id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL,events TEXT NOT NULL);
    CREATE TABLE room_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO room_metadata VALUES('event_scope','original-scope');
    PRAGMA user_version=4;`)
  const prior = { schemaVersion: 1, id: 'old', participantAgentId: 'agent', objective: 'Keep old data',
    sourceRoomId: 'room', sourceMessageId: 'message', acceptance: 'Tests pass', status: 'open',
    authorization: { kind: 'user_message', messageRevision: 0, text: 'Keep old data', capturedAt: '2026-10-01T00:00:00.000Z' },
    links: [], acceptanceEvidence: [], results: [], nextCheckAt: null, waitingOn: null, deadline: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
  db.prepare('INSERT INTO room_documents(seq,kind,id,room_id,revision,status,document) VALUES(44,?,?,?,?,?,?)')
    .run('agent_commitment', 'old', 'room', 7, 'open', JSON.stringify(prior))
  db.prepare('INSERT INTO room_requests VALUES(?,?,?,?)').run('old-request', 'a'.repeat(64), '{"id":"old"}', '[]')
  db.close()
  return { path, prior }
}
function open(path: string) { const store = new SqliteRoomStore({ path }); stores.push(store); return store }
function insert(db: DatabaseSync, kind: string, value: { id: string }) {
  db.prepare('INSERT INTO room_documents(kind,id,room_id,revision,document) VALUES(?,?,?,0,?)')
    .run(kind, value.id, 'room', JSON.stringify(value))
}

describe('collaboration v4 to v5 migration', () => {
  it('preserves v1 commitments, revisions, insertion cursors, receipts and event scope on repeated startup', async () => {
    const { path, prior } = await v4(), store = open(path)
    expect(await store.get('agent_commitment', 'old')).toMatchObject({ seq: 44, revision: 7, value: prior })
    expect(await store.getRequest('old-request')).toMatchObject({ result: { id: 'old' } })
    expect(await store.eventScope()).toBe('original-scope')
    await store.close()
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5)
      expect(db.prepare("SELECT document FROM room_documents WHERE id='old'").get()?.document).toBe(JSON.stringify(prior))
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='collaboration_owned_target'").get()).toBeTruthy()
    } finally { db.close() }
    expect(await open(path).get('agent_commitment', 'old')).toMatchObject({ seq: 44, revision: 7, value: prior })
  })

  it('rolls back all new indexes and the version marker if an index cannot be installed', async () => {
    const { path, prior } = await v4(), db = new DatabaseSync(path)
    db.exec('CREATE TABLE collaboration_execution_request (bad TEXT);'); db.close()
    await expect(open(path).get('agent_commitment', 'old')).rejects.toThrow()
    const after = new DatabaseSync(path)
    try {
      expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
      expect(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'collaboration_%'").get()?.n).toBe(0)
      expect(after.prepare("SELECT document FROM room_documents WHERE id='old'").get()?.document).toBe(JSON.stringify(prior))
      after.exec('DROP TABLE collaboration_execution_request;')
    } finally { after.close() }
    expect(await open(path).get('agent_commitment', 'old')).toMatchObject({ revision: 7, value: prior })
  })

  it('fails closed on ambiguous active owners, without deleting either owner or old commitments', async () => {
    const { path } = await v4(), db = new DatabaseSync(path)
    insert(db, 'commitment_link', link('one'))
    insert(db, 'commitment_link', link('two', { kind: 'workbench_link', linkId: 'link', threadId: 'thread' }))
    db.close()
    await expect(open(path).get('agent_commitment', 'old')).rejects.toThrow('active owner')
    const after = new DatabaseSync(path, { readOnly: true })
    try {
      expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
      expect(after.prepare('SELECT count(*) AS n FROM room_documents').get()?.n).toBe(3)
    } finally { after.close() }
  })

  it('refuses malformed sidecars instead of blessing them with the new version', async () => {
    const { path } = await v4(), db = new DatabaseSync(path)
    insert(db, 'commitment_control', { ...control(), stage: 'running' } as ReturnType<typeof control>)
    db.close()
    await expect(open(path).get('agent_commitment', 'old')).rejects.toThrow()
    const after = new DatabaseSync(path, { readOnly: true })
    try {
      expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
      expect(after.prepare('SELECT count(*) AS n FROM room_documents').get()?.n).toBe(2)
    } finally { after.close() }
  })
})
