import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomSchema } from '../contracts/rooms.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService } from './room-service.js'
import { RoomPeerStore } from './room-peer-state.js'
import { peerId } from './room-peer-inbox.js'
import type { RoomPeerRequestInput } from './room-peer-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kun-peer-state-'))
  const path = join(directory, 'rooms.sqlite')
  const store = new SqliteRoomStore({ path })
  cleanups.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => undefined)
  const room = (await service.create({ clientRequestId: 'room', name: 'Peer room' })).room
  const peer = new RoomPeerStore(store)
  const sent = await service.send(room.id, { clientRequestId: 'goal', body: 'Compare the two designs.' })
  const rootId = sent.requestId
  const initialize = async (id = rootId) => {
    const request = await store.get<RoomPeerRequestInput>('request', id)
    return peer.initialize(request!.value)
  }
  await initialize()
  let attempt = 0
  const begin = async (memberId = 'developer', phase: 'triage' | 'respond' = 'respond', selected?: number) => {
    const updates = await peer.readUpdates(rootId, memberId)
    const key = 'activation-' + memberId + '-' + ++attempt
    const contextId = peerId('context', key)
    await store.commit({ requestId: contextId, checks: [{ kind: 'context', id: contextId, expectedRevision: null }],
      puts: [{ kind: 'context', id: contextId, roomId: room.id, value: { id: contextId, roomId: room.id, prompt: 'Frozen prompt' } }] })
    return peer.begin(rootId, memberId, { clientRequestId: key, threadId: 'thread-' + key, contextId, attempt,
      phase, generation: updates!.topic.value.generation, basePublicationRevision: updates!.topic.value.publicationRevision,
      itemIds: updates!.items.slice(0, selected).map((item) => item.id) })
  }
  return { directory, path, store, service, room, peer, sent, rootId, begin, initialize }
}

describe('durable peer topics and member inboxes', () => {
  it('defaults new rooms to peer while legacy schema and admitted roots retain their protocol', async () => {
    const f = await fixture()
    expect(f.room.collaborationMode).toBe('peer')
    const { collaborationMode: _mode, ...legacy } = f.room
    expect(RoomSchema.parse(legacy).collaborationMode).toBe('autonomous')
    const oldRoom = (await f.service.create({ clientRequestId: 'legacy-room', name: 'Old', collaborationMode: 'directed' })).room
    const old = await f.service.send(oldRoom.id, { clientRequestId: 'legacy-goal', body: 'Discuss.' })
    await f.service.update(oldRoom.id, { clientRequestId: 'enable-peer', expectedRevision: oldRoom.revision, collaborationMode: 'peer' })
    const continued = await f.service.send(oldRoom.id, { clientRequestId: 'legacy-continue', body: 'Continue.', rootRequestId: old.requestId })
    const request = await f.store.get<RoomPeerRequestInput>('request', continued.requestId)
    expect(request?.value).toMatchObject({ collaborationProtocol: 'legacy', rootRequestId: old.requestId,
      roomSnapshot: { collaborationMode: 'directed' } })
    expect(await f.peer.initialize(request!.value)).toBeNull()
  })

  it('initializes once, preserves immutable deliveries, and never consumes input merely by seeing it', async () => {
    const f = await fixture()
    await f.initialize()
    expect(await f.store.list('peer_inbox', { rootRequestId: f.rootId })).toHaveLength(3)
    const active = await f.begin()
    expect(active?.value.seenInboxSeq).toBeGreaterThan(0)
    expect(active?.value.handledInboxSeq).toBe(0)
    const topic = (await f.peer.topic(f.rootId))!.value
    expect(topic).toMatchObject({ responseCount: 1, triageCount: 0, publicationRevision: 0 })
    await f.peer.skip(f.rootId, 'developer', active!.value.activation!.clientRequestId)
    expect((await f.peer.member(f.rootId, 'developer'))!.value).toMatchObject({ state: 'idle', handledInboxSeq: active!.value.seenInboxSeq })
    const inbox = (await f.store.list('peer_inbox', { rootRequestId: f.rootId }))[0]
    await expect(f.store.commit({ requestId: 'rewrite-inbox',
      checks: [{ kind: 'peer_inbox', id: inbox.id, expectedRevision: inbox.revision }],
      puts: [{ kind: 'peer_inbox', id: inbox.id, roomId: inbox.roomId, value: {} }] })).rejects.toThrow('immutable')
  })

  it('atomically publishes, handles only its selected input, and replays after reopening without duplicate events', async () => {
    const f = await fixture()
    const active = await f.begin()
    const input = { rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'publish-1',
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Use the existing renderer.', mentionMemberIds: ['reviewer'] }
    const first = await f.peer.publish(input)
    expect(first).toMatchObject({ status: 'published', message: { status: 'final', rootRequestId: f.rootId } })
    expect((await f.peer.topic(f.rootId))!.value.publicationRevision).toBe(1)
    const items = await f.peer.readUpdates(f.rootId, 'reviewer')
    expect(items!.items.at(-1)!.value).toMatchObject({ sourceKind: 'invitation', authorMemberId: 'developer' })
    const before = await f.store.events(f.room.id)
    await f.store.close()
    const reopened = new SqliteRoomStore({ path: f.path })
    try {
      expect(await new RoomPeerStore(reopened).publish(input)).toMatchObject({ status: 'duplicate', message: { id: first.message!.id } })
      expect(await reopened.events(f.room.id)).toEqual(before)
      expect((await reopened.list('message', { rootRequestId: f.rootId })).length).toBe(2)
    } finally { await reopened.close() }
  })

  it('rejects a draft after new user input even before the topic generation is initialized', async () => {
    const f = await fixture()
    const active = await f.begin()
    const next = await f.service.send(f.room.id, { clientRequestId: 'new-input', rootRequestId: f.rootId, body: 'Actually choose the other design.' })
    expect((await f.peer.topic(f.rootId))!.value.generation).toBe(1)
    expect(await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'outdated',
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Old recommendation' })).toEqual({ status: 'stale' })
    expect((await f.peer.member(f.rootId, 'developer'))!.value.handledInboxSeq).toBe(0)
    await f.initialize(next.requestId)
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ generation: 2, responseCount: 0, memberResponses: {}, triageCount: 0 })
    await f.peer.skip(f.rootId, 'developer', active!.value.activation!.clientRequestId)
    expect((await f.peer.member(f.rootId, 'developer'))!.value).toMatchObject({ state: 'pending', handledInboxSeq: 0 })
  })

  it('rechecks the user-input guard inside the publication transaction when a send races the final CAS', async () => {
    const f = await fixture(), active = await f.begin()
    const commit = f.store.commit.bind(f.store)
    let injected = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!injected && input.puts?.some((put) => put.kind === 'peer_publication')) {
        injected = true
        await f.service.send(f.room.id, { clientRequestId: 'racing-user-input', rootRequestId: f.rootId, body: 'Wait for the revised requirement.' })
      }
      return commit(input)
    })
    expect(await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'racing-publish',
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Outdated output' })).toEqual({ status: 'stale' })
    expect(await f.store.list('peer_publication', { rootRequestId: f.rootId })).toHaveLength(0)
    expect((await f.peer.member(f.rootId, 'developer'))!.value.handledInboxSeq).toBe(0)
  })

  it('handles only the exact ordered inbox prefix included in the persisted activation context', async () => {
    const f = await fixture(), developer = await f.begin('developer')
    await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'prefix-source',
      activationClientRequestId: developer!.value.activation!.clientRequestId, body: 'Additional information' })
    const before = (await f.peer.readUpdates(f.rootId, 'reviewer'))!
    expect(before.items).toHaveLength(2)
    const selected = await f.begin('reviewer', 'triage', 1)
    expect(selected!.value.activation!.seenItems.map((item) => item.id)).toEqual([before.items[0].id])
    await f.peer.skip(f.rootId, 'reviewer', selected!.value.activation!.clientRequestId)
    expect((await f.peer.readUpdates(f.rootId, 'reviewer'))!.items.map((item) => item.id)).toEqual([before.items[1].id])
  })

  it('keeps other topics independent and rejects an outdated publication after a peer final response', async () => {
    const f = await fixture()
    const developer = await f.begin('developer')
    const reviewer = await f.begin('reviewer')
    const other = await f.service.send(f.room.id, { clientRequestId: 'other-topic', body: 'Another independent question.' })
    await f.initialize(other.requestId)
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ generation: 1, status: 'active' })
    expect((await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'first-reply',
      activationClientRequestId: developer!.value.activation!.clientRequestId, body: 'Developer answer' })).status).toBe('published')
    expect(await f.peer.publish({ rootRequestId: f.rootId, memberId: 'reviewer', clientRequestId: 'stale-review',
      activationClientRequestId: reviewer!.value.activation!.clientRequestId, body: 'Different answer on old context' })).toEqual({ status: 'stale' })
  })

  it('suppresses identical responses from different members on the same context and reply target', async () => {
    const f = await fixture()
    const developer = await f.begin('developer'), reviewer = await f.begin('reviewer')
    const response = { rootRequestId: f.rootId, body: 'Same answer', replyToMessageId: f.sent.message.id }
    const first = await f.peer.publish({ ...response, memberId: 'developer', clientRequestId: 'same-1', activationClientRequestId: developer!.value.activation!.clientRequestId })
    const second = await f.peer.publish({ ...response, memberId: 'reviewer', clientRequestId: 'same-2', activationClientRequestId: reviewer!.value.activation!.clientRequestId })
    expect(second).toMatchObject({ status: 'duplicate', message: { id: first.message!.id } })
    expect(await f.store.list('peer_publication', { rootRequestId: f.rootId })).toHaveLength(1)
  })

  it('counts response activations independently from publication and limits only an exhausted member', async () => {
    const f = await fixture()
    const topic = (await f.peer.topic(f.rootId))!
    await f.store.commit({ requestId: 'seed-member-budget', checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: { ...topic.value, responseCount: 8, memberResponses: { developer: 8 } } }] })
    expect(await f.begin('developer')).toBeNull()
    expect(await f.begin('developer')).toBeNull()
    expect((await f.peer.topic(f.rootId))!.value.status).toBe('active')
    expect((await f.peer.member(f.rootId, 'developer'))!.value).toMatchObject({ waitingReason: 'member_budget_exhausted', handledInboxSeq: 0 })
    expect(await f.begin('reviewer')).not.toBeNull()
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ responseCount: 9, publicationRevision: 0 })
  })

  it.each([
    { phase: 'respond' as const, responseCount: 32, triageCount: 0 },
    { phase: 'triage' as const, responseCount: 0, triageCount: 128 }
  ])('pauses a topic after its $phase activation budget without consuming pending input', async ({ phase, responseCount, triageCount }) => {
    const f = await fixture(), topic = (await f.peer.topic(f.rootId))!
    await f.store.commit({ requestId: 'exhaust-topic', checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: { ...topic.value, responseCount, triageCount } }] })
    expect(await f.begin('developer', phase)).toBeNull()
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ status: 'paused', pauseReason: 'budget_exhausted', responseCount, triageCount })
    expect((await f.peer.member(f.rootId, 'developer'))!.value.handledInboxSeq).toBe(0)
    expect((await f.peer.readUpdates(f.rootId, 'developer'))!.items).toHaveLength(1)
  })

  it('allows the last admitted response to publish after later admission exhausts the topic budget', async () => {
    const f = await fixture(), topic = (await f.peer.topic(f.rootId))!
    await f.store.commit({ requestId: 'last-response-slot', checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: { ...topic.value, responseCount: 31 } }] })
    const active = await f.begin('developer')
    expect(await f.begin('reviewer')).toBeNull()
    expect((await f.peer.topic(f.rootId))!.value.status).toBe('paused')
    expect(await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'last-admitted-publish',
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Last response already admitted.' })).toMatchObject({ status: 'published' })
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ status: 'paused', responseCount: 32 })
  })

  it('does not reopen an exhausted topic when a previously admitted triage finishes', async () => {
    const f = await fixture(), topic = (await f.peer.topic(f.rootId))!
    await f.store.commit({ requestId: 'last-triage-slot', checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
      puts: [{ kind: 'peer_topic', id: topic.id, roomId: topic.roomId, value: { ...topic.value, triageCount: 127 } }] })
    const active = await f.begin('developer', 'triage')
    expect(await f.begin('reviewer', 'triage')).toBeNull()
    await f.peer.updateActivation(f.rootId, 'developer', active!.value.activation!.clientRequestId, { phase: 'respond' })
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ status: 'paused', triageCount: 128 })
  })

  it('persists stop generation and blocks late output without advancing handled input', async () => {
    const f = await fixture(), active = await f.begin()
    await f.peer.stop(f.rootId)
    expect((await f.peer.topic(f.rootId))!.value).toMatchObject({ generation: 2, status: 'stopping' })
    expect(await f.peer.publish({ rootRequestId: f.rootId, memberId: 'developer', clientRequestId: 'late-reply',
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Late output' })).toEqual({ status: 'stopped' })
    expect((await f.peer.member(f.rootId, 'developer'))!.value.handledInboxSeq).toBe(0)
  })
})
