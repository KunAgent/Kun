import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomPeerStore } from './room-peer-state.js'
import { deliverPeerMessageUpdate } from './room-peer-message-updates.js'
import type { RoomRequestState } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-peer-inbox-prefix-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {}), peer = new RoomPeerStore(store)
  const room = (await service.create({ clientRequestId: 'room', name: 'Inbox prefix' })).room
  const sent = await service.send(room.id, { clientRequestId: 'source', body: 'Discuss this topic.', executionIntent: 'discussion' })
  const initialize = async (id: string) => peer.initialize((await store.get<RoomRequestState>('request', id))!.value)
  await initialize(sent.requestId)
  let attempt = 0
  const begin = async (memberId: string, count?: number) => {
    const updates = (await peer.readUpdates(sent.requestId, memberId))!
    const id = 'activation-' + ++attempt
    return (await peer.begin(sent.requestId, memberId, { threadId: 'thread-' + id, clientRequestId: id, contextId: 'context-' + id,
      phase: 'respond', attempt, generation: updates.topic.value.generation, basePublicationRevision: updates.topic.value.publicationRevision,
      itemIds: updates.items.slice(0, count).map((item) => item.id) }))!.value.activation!
  }
  const publish = async (memberId: string, body: string) => {
    const active = await begin(memberId)
    return peer.publish({ rootRequestId: sent.requestId, memberId, body,
      clientRequestId: active.clientRequestId, activationClientRequestId: active.clientRequestId })
  }
  return { store, service, peer, room, sent, initialize, begin, publish }
}

describe('generation-scoped coalesced peer inbox prefixes', () => {
  it('finds a new generation beyond more than a thousand unhandled old deliveries without loading old history', async () => {
    const f = await fixture()
    for (let offset = 0; offset < 1005; offset += 500) {
      const puts = Array.from({ length: Math.min(500, 1005 - offset) }, (_, index) => ({ kind: 'peer_inbox' as const,
        id: 'old-' + (offset + index), roomId: f.room.id, value: { roomId: f.room.id,
          rootRequestId: f.sent.requestId, memberId: 'developer', generation: 1, sourceKind: 'task',
          sourceId: 'old-task-' + (offset + index), sourceRevision: 1, causeId: 'old', body: 'Obsolete generation',
          createdAt: new Date().toISOString() } }))
      await f.store.commit({ requestId: 'seed-old-' + offset, puts,
        checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
    }
    const next = await f.service.send(f.room.id, { clientRequestId: 'continue', rootRequestId: f.sent.requestId,
      body: 'Current generation input.', executionIntent: 'discussion' })
    await f.initialize(next.requestId)
    const list = vi.spyOn(f.store, 'list')
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    expect(updates.items.map((item) => item.value.body)).toEqual(['Current generation input.'])
    expect(updates.topic.value.generation).toBe(2)
    expect(list.mock.calls.filter(([kind]) => kind === 'peer_inbox').every(([, options]) =>
      options?.peerGeneration === 2 && options.limit! <= 200)).toBe(true)
    const active = await f.begin('developer')
    await f.peer.skip(f.sent.requestId, 'developer', active.clientRequestId)
    expect((await f.peer.readUpdates(f.sent.requestId, 'developer'))!.items).toHaveLength(0)
  })

  it('coalesces twenty revisions, preserves an intervening message, and acknowledges only the selected semantic prefix', async () => {
    const f = await fixture()
    const source = (await f.publish('coordinator', 'Initial finding.')).message!
    let sideId = ''
    for (let revision = 1; revision <= 20; revision++) {
      const row = (await f.store.get<RoomMessage>('message', source.id))!
      await putRoomDocument(f.store, 'message', row.id, f.room.id,
        { ...row.value, body: 'Finding revision ' + revision, bodyRevision: revision }, row)
      await deliverPeerMessageUpdate(f.peer, f.room.id, source.id)
      if (revision === 10) sideId = (await f.publish('reviewer', 'Independent intervening evidence.')).message!.id
    }
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    expect(updates.items.map((item) => item.value.sourceId)).toEqual([f.sent.message.id, sideId, source.id])
    expect(updates.items.at(-1)!.value.sourceRevision).toBe(20)
    const prefix = await f.begin('developer', 2)
    expect(prefix.seenItems.map((item) => item.sourceId)).toEqual([f.sent.message.id, sideId])
    await f.peer.skip(f.sent.requestId, 'developer', prefix.clientRequestId)
    const remaining = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!.items
    expect(remaining).toHaveLength(1)
    expect(remaining[0].value).toMatchObject({ sourceId: source.id, sourceRevision: 20 })
    expect(await f.publish('developer', 'Responding to the latest finding.')).toMatchObject({ status: 'published' })
  })

  it('retains independent task gate causes even when task identity and revision are identical', async () => {
    const f = await fixture()
    await f.peer.deliverTask(f.sent.requestId, { id: 'task', revision: 1, eventId: 'gate-one', body: 'Approval one' })
    await f.peer.deliverTask(f.sent.requestId, { id: 'task', revision: 1, eventId: 'gate-two', body: 'Approval two' })
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    expect(updates.items.filter((item) => item.value.sourceKind === 'task').map((item) => item.value.causeId))
      .toEqual(['gate-one', 'gate-two'])
  })
})
