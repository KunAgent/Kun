import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomRunRecordSchema } from '../contracts/room-runs.js'
import { RoomService } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { prepareRoomReplyContext, uniqueRoomReplyTrigger } from './room-replies.js'
import { initializeRoomReplyIndex, projectRoomReplyCounts, roomReplyPage } from './room-replies-sqlite.js'
import { RoomPeerStore } from './room-peer-state.js'
import { prepareRoomPeerContext } from './room-peer-context.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kun-replies-'))
  const path = join(directory, 'rooms.sqlite')
  const store = new SqliteRoomStore({ path }), wake = vi.fn()
  cleanup.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, wake)
  const room = (await service.create({ clientRequestId: 'create', name: 'Replies' })).room
  const send = (clientRequestId: string, replyToMessageId?: string, rootRequestId?: string) => service.send(room.id,
    { clientRequestId, body: clientRequestId, replyToMessageId, rootRequestId, executionIntent: 'discussion' })
  const put = async (message: RoomMessage) => store.commit({ requestId: message.id,
    checks: [{ kind: 'message', id: message.id, expectedRevision: null }],
    puts: [{ kind: 'message', id: message.id, roomId: message.roomId, value: message }] })
  return { store, service, room, send, put, wake, path }
}

describe('host-derived reply display roots', () => {
  it('flattens nested replies without replacing the original discussion topic and replays sends exactly once', async () => {
    const f = await fixture()
    const root = await f.send('root')
    const first = await f.send('first', root.message.id)
    const nested = await f.send('nested', first.message.id)
    expect(first.message.displayThreadRootId).toBe(root.message.id)
    expect(nested.message).toMatchObject({ displayThreadRootId: root.message.id,
      replyToMessageId: first.message.id, rootRequestId: root.requestId })
    expect(await f.send('nested', first.message.id)).toEqual(nested)
    expect(f.wake).toHaveBeenCalledTimes(3)
    await expect(f.service.send(f.room.id, { clientRequestId: 'forged', body: 'Forged',
      displayThreadRootId: root.message.id })).rejects.toThrow()
  })

  it('keeps an explicit new display branch distinct even when the user continues the same topic', async () => {
    const f = await fixture(), root = await f.send('root')
    const branch = await f.send('new-branch', undefined, root.requestId)
    expect(branch.message.rootRequestId).toBe(root.requestId)
    expect(branch.message.displayThreadRootId).toBeUndefined()
    const reply = await f.send('branch-reply', branch.message.id)
    expect(reply.message.displayThreadRootId).toBe(branch.message.id)
    expect((await uniqueRoomReplyTrigger(f.store, f.room.id, [root.message.id, branch.message.id])).displayThreadRootId).toBeUndefined()
    expect(await uniqueRoomReplyTrigger(f.store, f.room.id, [branch.message.id, reply.message.id])).toMatchObject({ displayThreadRootId: branch.message.id })
  })

  it('rejects missing, cyclic and cross-room chains rather than guessing a topic-based root', async () => {
    const f = await fixture(), root = await f.send('root')
    await f.put({ ...root.message, id: 'broken', replyToMessageId: 'missing', displayThreadRootId: undefined })
    await f.put({ ...root.message, id: 'cycle-a', replyToMessageId: 'cycle-b', displayThreadRootId: undefined })
    await f.put({ ...root.message, id: 'cycle-b', replyToMessageId: 'cycle-a', displayThreadRootId: undefined })
    await f.put({ ...root.message, id: 'foreign', roomId: 'other-room' })
    await expect(prepareRoomReplyContext(f.store, f.room.id, 'broken')).rejects.toThrow('unavailable')
    await expect(prepareRoomReplyContext(f.store, f.room.id, 'cycle-a')).rejects.toThrow('cycle')
    await expect(prepareRoomReplyContext(f.store, f.room.id, 'foreign')).rejects.toThrow('unavailable')
    await expect(f.send('invalid-reply', 'broken')).rejects.toThrow('unavailable')
  })

  it('inherits a saved actual run trigger for Agent output while task notices remain outside reply threads', async () => {
    const f = await fixture(), root = await f.send('root')
    const explicit = await f.send('follow-up', root.message.id)
    const now = new Date().toISOString()
    const run = RoomRunRecordSchema.parse({ id: 'recorded-run', roomId: f.room.id, memberId: 'developer', memberLabel: 'Developer',
      phase: 'discussion', attempt: 1, clientRequestId: 'turn-key', threadId: 'thread', turnId: 'turn',
      rootRequestId: root.requestId, requestId: explicit.requestId, triggerMessageId: explicit.message.id,
      input: 'Follow up', status: 'completed', createdAt: now, updatedAt: now })
    await f.store.commit({ requestId: run.id, checks: [{ kind: 'room_run', id: run.id, expectedRevision: null }],
      puts: [{ kind: 'room_run', id: run.id, roomId: f.room.id, value: run }] })
    await f.service.append(f.room.id, 'agent-response', 'A useful answer', 'developer', undefined, run.id)
    await f.service.append(f.room.id, 'task-notice', 'Queued', 'developer', 'task')
    expect((await f.store.get<RoomMessage>('message', 'agent-response'))!.value).toMatchObject({
      replyToMessageId: explicit.message.id, displayThreadRootId: root.message.id, originRunId: run.id })
    expect((await f.store.get<RoomMessage>('message', 'task-notice'))!.value.displayThreadRootId).toBeUndefined()
  })
  it('freezes a default peer reply only for one proven trigger branch, excluding ambiguous or task-driven batches', async () => {
    const f = await fixture(), root = await f.send('root')
    const request = (await f.store.get<RoomRequestState>('request', root.requestId))!
    const peer = new RoomPeerStore(f.store)
    await peer.initialize(request.value)
    const updates = (await peer.readUpdates(root.requestId, 'developer'))!
    const contextId = 'context-' + root.requestId
    await f.store.commit({ requestId: contextId, checks: [{ kind: 'context', id: contextId, expectedRevision: null }],
      puts: [{ kind: 'context', id: contextId, roomId: f.room.id, value: { id: contextId, roomId: f.room.id,
        coveredSeq: 0, summary: '', messages: [], rules: [], truncated: false } }] })
    await f.put({ ...root.message, id: 'nested-trigger', replyToMessageId: root.message.id, displayThreadRootId: root.message.id })
    await f.put({ ...root.message, id: 'other-branch', replyToMessageId: undefined, displayThreadRootId: undefined })
    const deps = { store: f.store, model: () => ({ model: 'fake' }), profiles: () => ({}) } as unknown as RoomRuntimeDeps
    const member = f.room.members.find((value) => value.id === 'developer')!
    const source = (id: string) => ({ ...updates.items[0], id: 'inbox-' + id,
      value: { ...updates.items[0].value, sourceId: id, messageId: id } })
    const same = await prepareRoomPeerContext(deps, { ...updates, items: [source(root.message.id), source('nested-trigger')] }, member)
    expect(same).toMatchObject({ rootRequestId: root.requestId, displayThreadRootId: root.message.id, replyToMessageId: 'nested-trigger' })
    const multiple = await prepareRoomPeerContext(deps, { ...updates, items: [source(root.message.id), source('other-branch')] }, member)
    expect(multiple.replyToMessageId).toBeUndefined()
    expect(multiple.displayThreadRootId).toBeUndefined()
    const task = source('task')
    task.value.sourceKind = 'task'
    const mixed = await prepareRoomPeerContext(deps, { ...updates, items: [source(root.message.id), task] }, member)
    expect(mixed.replyToMessageId).toBeUndefined()
    expect((await peer.topic(root.requestId))!.value.responseCount).toBe(0)
  })
})

describe('SQLite reply page projection', () => {
  function database() {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE room_documents (seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,id TEXT,room_id TEXT,document TEXT)')
    initializeRoomReplyIndex(db)
    cleanup.push(() => db.close())
    const put = (id: string, replyToMessageId?: string, displayThreadRootId?: string, roomId = 'room', body = id) => {
      const message = { id, roomId, replyToMessageId, displayThreadRootId, authorKind: 'member', body,
        messageSeq: 1,
        authorLabelSnapshot: 'Member', attachmentIds: [], mentionMemberIds: [], bodyRevision: 0,
        rootRequestId: 'same-topic', createdAt: '2026-09-15T00:00:00Z' } as RoomMessage
      db.prepare("INSERT INTO room_documents(kind,id,room_id,document) VALUES('message',?,?,?)").run(id, roomId, JSON.stringify(message))
      return message
    }
    return { db, put }
  }

  it('counts every nested reply before pagination and excludes unrelated messages in the same topic', () => {
    const f = database(), root = f.put('root')
    f.put('old-first', 'root'); f.put('old-nested', 'old-first')
    f.put('new-reply', 'old-nested', 'root'); f.put('unrelated'); f.put('foreign', 'root', undefined, 'other-room')
    const newest = roomReplyPage(f.db, { roomId: 'room', messageId: 'old-nested', limit: 2 })
    expect(newest.root?.id).toBe('root')
    expect(newest.total).toBe(3)
    expect(newest.messages.map((message) => message.id)).toEqual(['old-nested', 'new-reply'])
    expect(newest.messages.every((message) => message.displayThreadRootId === 'root')).toBe(true)
    const older = roomReplyPage(f.db, { roomId: 'room', messageId: 'root', limit: 2, beforeSeq: Number(newest.nextCursor) })
    expect(older.messages.map((message) => message.id)).toEqual(['old-first'])
    expect(older.nextCursor).toBeUndefined()
    expect(projectRoomReplyCounts(f.db, [root])[0].replyCount).toBe(3)
    expect(projectRoomReplyCounts(f.db, [f.put('empty')])[0].replyCount).toBeUndefined()
  })

  it('reports unavailable ancestry and bounded historical traversal explicitly', () => {
    const f = database()
    f.put('root'); f.put('broken', 'missing'); f.put('cycle-a', 'cycle-b'); f.put('cycle-b', 'cycle-a')
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'broken' })).toMatchObject({ root: null, unavailableReason: 'missing_parent' })
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'cycle-a' })).toMatchObject({ root: null, unavailableReason: 'cycle' })
    for (let index = 1; index <= 66; index += 1) f.put('deep-' + index, index === 1 ? 'root' : 'deep-' + (index - 1))
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'deep-64' }).root?.id).toBe('root')
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'deep-66' })).toMatchObject({ root: null, unavailableReason: 'depth_limit' })
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'root' })).toMatchObject({ unavailableReason: 'depth_limit' })
    f.put('host-proven-deep', 'deep-66', 'root')
    expect(roomReplyPage(f.db, { roomId: 'room', messageId: 'host-proven-deep' }).root?.id).toBe('root')
  })
  it('counts a large thread while fetching only the limited reply payload page', () => {
    const f = database(), root = f.put('root')
    for (let index = 0; index < 1000; index += 1) f.put('large-' + index, 'root', 'root', 'room', 'x'.repeat(8192))
    expect(projectRoomReplyCounts(f.db, [root])[0].replyCount).toBe(1000)
    const result = roomReplyPage(f.db, { roomId: 'room', messageId: 'root', limit: 3 })
    expect(result.total).toBe(1000)
    expect(result.messages.map((message) => message.id)).toEqual(['large-997', 'large-998', 'large-999'])
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(30_000)
  })

  it('does not mutate messages, requests or topic budgets when a display thread is viewed', async () => {
    const f = await fixture(), root = await f.send('root')
    await f.send('reply', root.message.id)
    f.wake.mockClear()
    const before = await f.store.list('request', { roomId: f.room.id })
    const events = await f.store.events(f.room.id)
    const db = new DatabaseSync(f.path, { readOnly: true })
    try {
      expect(roomReplyPage(db, { roomId: f.room.id, messageId: root.message.id }).total).toBe(1)
      expect(projectRoomReplyCounts(db, [root.message])[0].replyCount).toBe(1)
    } finally { db.close() }
    expect(await f.store.list('request', { roomId: f.room.id })).toEqual(before)
    expect(await f.store.events(f.room.id)).toEqual(events)
    expect(f.wake).not.toHaveBeenCalled()
  })
})
