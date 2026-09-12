import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomStoreConflictError, type RoomStoreCommit } from './room-store.js'

const roots: string[] = []
const stores: SqliteRoomStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function database(): Promise<{ store: SqliteRoomStore; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-store-'))
  roots.push(root)
  const path = join(root, 'rooms.sqlite')
  const store = new SqliteRoomStore({ path })
  stores.push(store)
  return { store, path }
}
function insertion(id: string, kind: 'room' | 'message' | 'task' | 'delivery' = 'room', value: unknown = { id }): RoomStoreCommit {
  return {
    requestId: `create-${kind}-${id}`,
    checks: [{ kind, id, expectedRevision: null }],
    puts: [{ kind, id, roomId: 'room-a', value }],
    events: [{ roomId: 'room-a', kind: `${kind}_created`, payload: { id } }],
    result: { id }
  }
}

describe('canonical SQLite room store', () => {
  it('durably replays an ambiguous request response without reapplying writes or events', async () => {
    const { store, path } = await database()
    const input = insertion('room-a')
    const first = await store.commit(input)
    await store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = new SqliteRoomStore({ path })
    stores.push(reopened)
    expect(await reopened.commit(input)).toEqual({ ...first, duplicate: true })
    expect(await reopened.get('room', 'room-a')).toMatchObject({ revision: 0, seq: 1 })
    expect(await reopened.events('room-a')).toHaveLength(1)
    expect(await reopened.getRequest(input.requestId)).toMatchObject({ result: { id: 'room-a' } })
    await expect(reopened.commit({ ...input, result: { id: 'different' } }))
      .rejects.toBeInstanceOf(RoomStoreConflictError)
  })

  it('rolls back all messages, task claims and events if any revision check conflicts', async () => {
    const { store } = await database()
    await store.commit(insertion('task-a', 'task', { status: 'queued' }))
    await expect(store.commit({
      requestId: 'conflicting-claim',
      checks: [{ kind: 'message', id: 'm-a', expectedRevision: null },
        { kind: 'task', id: 'task-a', expectedRevision: 9 }],
      puts: [{ kind: 'message', id: 'm-a', roomId: 'room-a', value: { body: 'claimed' } }],
      events: [{ roomId: 'room-a', kind: 'task_claimed', payload: {} }]
    })).rejects.toMatchObject({ currentRevision: 0 })
    expect(await store.get('message', 'm-a')).toBeNull()
    expect(await store.getRequest('conflicting-claim')).toBeNull()
    expect(await store.events('room-a')).toHaveLength(1)
  })

  it('allows only one concurrent claimant and keeps pagination sequence stable on updates', async () => {
    const { store } = await database()
    await store.commit(insertion('task-a', 'task', { status: 'queued' }))
    const claim = (member: string): RoomStoreCommit => ({
      requestId: `claim-${member}`,
      checks: [{ kind: 'task', id: 'task-a', expectedRevision: 0 }],
      puts: [{ kind: 'task', id: 'task-a', roomId: 'room-a', value: { status: 'running', owner: member } }]
    })
    const attempts = await Promise.allSettled([store.commit(claim('first')), store.commit(claim('second'))])
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await store.get('task', 'task-a')).toMatchObject({ revision: 1, seq: 1 })
    expect(await store.list('task', { status: 'queued' })).toEqual([])
    expect(await store.list('task', { status: ['running', 'failed'] })).toHaveLength(1)
  })

  it('pages bounded messages and event replay independently by room without skips', async () => {
    const { store } = await database()
    for (let index = 0; index < 7; index += 1) await store.commit(insertion(`m-${index}`, 'message', { body: `${index}` }))
    await store.commit({ requestId: 'other-room',
      checks: [{ kind: 'message', id: 'other', expectedRevision: null }],
      puts: [{ kind: 'message', id: 'other', roomId: 'room-b', value: { body: 'other' } }],
      events: [{ roomId: 'room-b', kind: 'message_created', payload: {} }] })
    const first = await store.list('message', { roomId: 'room-a', limit: 3 })
    const second = await store.list('message', { roomId: 'room-a', limit: 3, beforeSeq: first.at(-1)!.seq })
    expect([...first, ...second].map((entry) => entry.id)).toEqual(['m-6', 'm-5', 'm-4', 'm-3', 'm-2', 'm-1'])
    const replay = await store.events('room-a', 0, 3)
    expect(replay.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect((await store.events('room-a', replay.at(-1)!.seq, 3)).map((entry) => entry.seq)).toEqual([4, 5, 6])
  })

  it('does not allow delivery rewriting, ownership changes, unchecked writes or stale executor commits', async () => {
    const { store } = await database()
    await store.commit(insertion('delivery-a', 'delivery', { versionHash: 'a'.repeat(40) }))
    await expect(store.commit({ requestId: 'rewrite',
      checks: [{ kind: 'message', id: 'must-rollback', expectedRevision: null },
        { kind: 'delivery', id: 'delivery-a', expectedRevision: 0 }],
      puts: [{ kind: 'message', id: 'must-rollback', roomId: 'room-a', value: { body: 'partial write' } },
        { kind: 'delivery', id: 'delivery-a', roomId: 'room-a', value: { versionHash: 'b'.repeat(40) } }]
    })).rejects.toThrow('immutable')
    expect(await store.get('message', 'must-rollback')).toBeNull()
    await expect(store.commit({ requestId: 'unchecked', puts: [{ kind: 'room', id: 'x', value: {} }] }))
      .rejects.toThrow('requires a revision check')
    await expect(store.commit(insertion('stale'), () => { throw new Error('lease lost') }))
      .rejects.toThrow('lease lost')
    expect(await store.get('room', 'stale')).toBeNull()
    await store.commit(insertion('m-a', 'message'))
    await expect(store.commit({ requestId: 'move-message',
      checks: [{ kind: 'message', id: 'm-a', expectedRevision: 0 }],
      puts: [{ kind: 'message', id: 'm-a', roomId: 'room-b', value: {} }]
    })).rejects.toThrow('ownership cannot change')
  })

  it('filters archived rooms at the indexed query and never deletes their history', async () => {
    const { store } = await database()
    await store.commit(insertion('active'))
    await store.commit(insertion('archived', 'room', { archivedAt: new Date().toISOString() }))
    expect((await store.list('room')).map((row) => row.id)).toEqual(['active'])
    expect(await store.list('room', { includeArchived: true })).toHaveLength(2)
  })

  it('indexes nested runtime task records for recovery without loading all historical executions', async () => {
    const { store } = await database()
    await store.commit(insertion('task-a', 'task', { task: { status: 'running' }, prompt: 'Build' }))
    expect(await store.list('task', { status: 'running' })).toHaveLength(1)
    expect(await store.list('task', { status: 'completed' })).toEqual([])
  })

  it('snapshots the accepted document before asynchronous database initialization', async () => {
    const { store } = await database()
    const value = { body: 'accepted message' }
    const pending = store.commit(insertion('message-snapshot', 'message', value))
    value.body = 'subsequent caller edit'
    await pending
    expect(await store.get('message', 'message-snapshot')).toMatchObject({ value: { body: 'accepted message' } })
  })

  it('globally pages pinned rooms and recent message activity with stable cursors during streaming updates', async () => {
    const { store } = await database()
    for (const id of ['pinned-old', 'active-old', 'newer', 'newest', 'archived']) {
      await store.commit({ requestId: `room-${id}`, checks: [{ kind: 'room', id, expectedRevision: null }],
        puts: [{ kind: 'room', id, roomId: id, value: { id, pinned: id === 'pinned-old',
          ...(id === 'archived' ? { archivedAt: new Date().toISOString() } : {}) } }] })
    }
    await store.commit({ requestId: 'activity', checks: [{ kind: 'message', id: 'streaming', expectedRevision: null }],
      puts: [{ kind: 'message', id: 'streaming', roomId: 'active-old', value: { body: 'part one' } }] })
    const first = await store.listRooms({ limit: 2 })
    expect(first.rooms.map((row) => row.id)).toEqual(['pinned-old', 'active-old'])
    expect(first.rooms[1].latestMessageSeq).toBeGreaterThan(0)
    const second = await store.listRooms({ limit: 2, cursor: first.nextCursor })
    expect(second.rooms.map((row) => row.id)).toEqual(['newest', 'newer'])
    expect(second.nextCursor).toBeUndefined()
    await store.commit({ requestId: 'stream-update', checks: [{ kind: 'message', id: 'streaming', expectedRevision: 0 }],
      puts: [{ kind: 'message', id: 'streaming', roomId: 'active-old', value: { body: 'part one and two' } }] })
    expect(await store.listRooms({ limit: 2 })).toEqual(first)
    expect((await store.listRooms({ archivedOnly: true, limit: 1 })).rooms.map((row) => row.id)).toEqual(['archived'])
    await expect(store.listRooms({ cursor: '-1' })).rejects.toThrow('invalid room page cursor')
  })
})
