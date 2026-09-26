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
  const root = await mkdtemp(join(tmpdir(), 'kun-peer-message-revision-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {}), peer = new RoomPeerStore(store)
  const room = (await service.create({ clientRequestId: 'room', name: 'Revised messages' })).room
  const sent = await service.send(room.id, { clientRequestId: 'source', body: 'Compare these approaches.', executionIntent: 'discussion' })
  await peer.initialize((await store.get<RoomRequestState>('request', sent.requestId))!.value)
  let attempt = 0
  const begin = async (memberId: string) => {
    const updates = (await peer.readUpdates(sent.requestId, memberId))!
    const id = 'activation-' + ++attempt
    const row = await peer.begin(sent.requestId, memberId, { threadId: 'thread-' + id, clientRequestId: id,
      contextId: 'context-' + id, phase: 'respond', attempt, generation: updates.topic.value.generation,
      basePublicationRevision: updates.topic.value.publicationRevision, itemIds: updates.items.map((item) => item.id) })
    return row!.value.activation!
  }
  const coordinator = await begin('coordinator')
  const first = await peer.publish({ rootRequestId: sent.requestId, memberId: 'coordinator',
    clientRequestId: coordinator.clientRequestId, activationClientRequestId: coordinator.clientRequestId, body: 'Original finding.' })
  const revise = async (patch: Partial<RoomMessage>) => {
    const row = (await store.get<RoomMessage>('message', first.message!.id))!
    await putRoomDocument(store, 'message', row.id, room.id, { ...row.value, ...patch }, row)
  }
  return { store, service, peer, room, sent, first: first.message!, begin, revise }
}

describe('final peer message revisions', () => {
  it('rejects a stale response before event processing and later handles the newest supplied source version', async () => {
    const f = await fixture(), old = await f.begin('developer')
    await f.revise({ body: 'Corrected finding.', bodyRevision: 1 })
    expect((await f.peer.topic(f.sent.requestId))!.value.publicationRevision).toBe(1)
    expect(await f.peer.publish({ rootRequestId: f.sent.requestId, memberId: 'developer', clientRequestId: 'old-answer',
      activationClientRequestId: old.clientRequestId, body: 'Answer based on the original finding.' })).toEqual({ status: 'stale' })
    expect((await f.peer.member(f.sent.requestId, 'developer'))!.value.handledInboxSeq).toBe(0)
    await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    expect((await f.peer.topic(f.sent.requestId))!.value.publicationRevision).toBe(2)
    await f.peer.skip(f.sent.requestId, 'developer', old.clientRequestId)
    const next = await f.begin('developer')
    expect(next.seenItems.filter((item) => item.sourceId === f.first.id).map((item) => item.sourceRevision)).toEqual([1])
    expect(await f.peer.publish({ rootRequestId: f.sent.requestId, memberId: 'developer', clientRequestId: 'fresh-answer',
      activationClientRequestId: next.clientRequestId, body: 'Answer based on the corrected finding.' })).toMatchObject({ status: 'published' })
  })

  it('does not deliver streaming, failed, foreign-room or previous-generation messages', async () => {
    const f = await fixture()
    const before = await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId })
    for (const status of ['streaming', 'failed'] as const) {
      await f.revise({ status, bodyRevision: 1, body: 'Unfinished partial text.' })
      await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    }
    await f.revise({ status: 'final', sourceRequestId: 'previous-generation', bodyRevision: 2 })
    await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    await f.revise({ sourceRequestId: f.sent.requestId })
    await deliverPeerMessageUpdate(f.peer, 'different-room', f.first.id)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId })).toEqual(before)
    expect((await f.peer.topic(f.sent.requestId))!.value.publicationRevision).toBe(1)
  })

  it('checks source revisions in the publication transaction when an edit races the final write', async () => {
    const f = await fixture(), active = await f.begin('developer')
    const commit = f.store.commit.bind(f.store)
    let edited = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!edited && input.puts?.some((put) => put.kind === 'peer_publication')) {
        edited = true
        await f.revise({ bodyRevision: 1, body: 'Changed during publication.' })
      }
      return commit(input)
    })
    expect(await f.peer.publish({ rootRequestId: f.sent.requestId, memberId: 'developer', clientRequestId: 'racing-answer',
      activationClientRequestId: active.clientRequestId, body: 'Outdated answer' })).toEqual({ status: 'stale' })
    expect((await f.peer.member(f.sent.requestId, 'developer'))!.value.handledInboxSeq).toBe(0)
    expect((await f.peer.topic(f.sent.requestId))!.value.publicationRevision).toBe(1)
  })

  it('deduplicates replayed final updates by message revision and leaves initial publication deliveries alone', async () => {
    const f = await fixture()
    const initial = (await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId })).length
    await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId })).toHaveLength(initial)
    await f.revise({ body: 'Updated final finding.', bodyRevision: 1 })
    await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    await deliverPeerMessageUpdate(f.peer, f.room.id, f.first.id)
    expect(await f.store.list('peer_inbox', { rootRequestId: f.sent.requestId })).toHaveLength(initial + 2)
    expect((await f.peer.topic(f.sent.requestId))!.value.publicationRevision).toBe(2)
  })
})
