import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomStoredDocument } from './room-store.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomPeerStore } from './room-peer-state.js'
import { peerMessageRecipients } from './room-peer-inbox.js'
import { deliverPeerMessageUpdate } from './room-peer-message-updates.js'
import type { RoomPeerInboxItem, RoomPeerRequestInput } from './room-peer-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

/** Rooms default to peer collaboration; members without the field behave as 'all'. */
async function fixture(attention: Record<string, 'mentions'> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kun-peer-attention-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => undefined)
  let room = (await service.create({ clientRequestId: 'room', name: 'Peer room' })).room
  if (Object.keys(attention).length) {
    room = (await service.update(room.id, { clientRequestId: 'attention', expectedRevision: room.revision,
      members: room.members.map((member) =>
        member.id in attention ? { ...member, attention: attention[member.id] } : member) })).room
  }
  const peer = new RoomPeerStore(store)
  const send = async (clientRequestId: string, mentionMemberIds: string[] = []) => {
    const sent = await service.send(room.id, { clientRequestId, body: 'Compare the two designs.', mentionMemberIds })
    const request = (await store.get<RoomPeerRequestInput>('request', sent.requestId))!.value
    await peer.initialize(request)
    return sent.requestId
  }
  const inbox = (rootId: string) =>
    store.list<RoomPeerInboxItem>('peer_inbox', { rootRequestId: rootId, order: 'asc', limit: 1000 })
  let attempt = 0
  const publish = async (rootId: string, memberId: string,
    input: { mentionMemberIds?: string[]; inviteMemberIds?: string[] } = {}) => {
    const updates = (await peer.readUpdates(rootId, memberId))!
    const id = 'activation-' + memberId + '-' + ++attempt
    const active = await peer.begin(rootId, memberId, { clientRequestId: id, threadId: 'thread-' + id,
      contextId: 'context-' + id, attempt, phase: 'respond', generation: updates.topic.value.generation,
      basePublicationRevision: updates.topic.value.publicationRevision,
      itemIds: updates.items.map((item) => item.id) })
    return peer.publish({ rootRequestId: rootId, memberId, clientRequestId: 'publish-' + id,
      activationClientRequestId: active!.value.activation!.clientRequestId, body: 'Member finding.', ...input })
  }
  return { store, service, room, peer, send, inbox, publish }
}

const kinds = (rows: RoomStoredDocument<RoomPeerInboxItem>[], memberId: string) =>
  rows.filter((row) => row.value.memberId === memberId).map((row) => row.value.sourceKind)

describe('member attention mode in peer fan-out', () => {
  it('keeps members without the setting as all and retains designated recipients', () => {
    const room = { members: [{ id: 'quiet', attention: 'mentions' }, { id: 'plain' }] } as unknown as Room
    expect(peerMessageRecipients(room, ['quiet', 'plain', 'stranger'])).toEqual(['plain', 'stranger'])
    expect(peerMessageRecipients(room, ['quiet'], { designated: ['quiet'] })).toEqual(['quiet'])
    expect(peerMessageRecipients(room, [])).toEqual([])
  })

  it('persists the optional attention flag through the room update path', async () => {
    const f = await fixture({ reviewer: 'mentions' })
    const room = await f.service.get(f.room.id)
    expect(room.members.find((member) => member.id === 'reviewer')?.attention).toBe('mentions')
    expect(room.members.find((member) => member.id === 'developer')?.attention).toBeUndefined()
    await expect(f.service.update(room.id, { clientRequestId: 'bad-attention', expectedRevision: room.revision,
      members: [{ ...room.members[0], attention: 'sometimes' }] })).rejects.toThrow()
  })

  it('skips mentions-only members in the opening fan-out while a direct mention still arrives', async () => {
    const f = await fixture({ reviewer: 'mentions' })
    const rows = await f.inbox(await f.send('topic'))
    expect(kinds(rows, 'reviewer')).toEqual([])
    expect(kinds(rows, 'developer')).toEqual(['message'])
    expect(kinds(rows, 'coordinator')).toEqual(['message'])
    const mentioned = await f.inbox(await f.send('topic-mention', ['reviewer']))
    expect(kinds(mentioned, 'reviewer')).toEqual(['invitation'])
    expect(kinds(mentioned, 'developer')).toEqual(['message'])
  })

  it('keeps the default member in a mention-less initialize even in mentions mode', async () => {
    const f = await fixture({ coordinator: 'mentions', reviewer: 'mentions' })
    const rows = await f.inbox(await f.send('topic'))
    expect(kinds(rows, 'coordinator')).toEqual(['message'])
    expect(kinds(rows, 'developer')).toEqual(['message'])
    expect(kinds(rows, 'reviewer')).toEqual([])
    const mentioned = await f.inbox(await f.send('topic-mention', ['developer']))
    expect(kinds(mentioned, 'coordinator')).toEqual([])
    expect(kinds(mentioned, 'developer')).toEqual(['invitation'])
  })

  it('excludes mentions-only members from published message fan-out but still delivers invitations', async () => {
    const f = await fixture({ reviewer: 'mentions' })
    const rootId = await f.send('topic')
    expect(await f.publish(rootId, 'developer')).toMatchObject({ status: 'published' })
    let rows = await f.inbox(rootId)
    expect(kinds(rows, 'reviewer')).toEqual([])
    expect(kinds(rows, 'coordinator')).toEqual(['message', 'message'])
    expect(await f.publish(rootId, 'coordinator', { mentionMemberIds: ['reviewer'] }))
      .toMatchObject({ status: 'published' })
    rows = await f.inbox(rootId)
    expect(kinds(rows, 'reviewer')).toEqual(['invitation'])
    expect(kinds(rows, 'developer')).toEqual(['message', 'message'])
  })

  it('skips mentions-only members on revised-message fan-out while mentions still arrive', async () => {
    const f = await fixture({ reviewer: 'mentions' })
    const rootId = await f.send('topic')
    const published = await f.publish(rootId, 'developer')
    const revise = async (patch: Partial<RoomMessage>) => {
      const row = (await f.store.get<RoomMessage>('message', published.message!.id))!
      await putRoomDocument(f.store, 'message', row.id, f.room.id, { ...row.value, ...patch }, row)
    }
    await revise({ body: 'Revised finding.', bodyRevision: 1 })
    await deliverPeerMessageUpdate(f.peer, f.room.id, published.message!.id)
    let rows = await f.inbox(rootId)
    expect(kinds(rows, 'reviewer')).toEqual([])
    expect(kinds(rows, 'coordinator')).toEqual(['message', 'message', 'message'])
    await revise({ bodyRevision: 2, mentionMemberIds: ['reviewer'] })
    await deliverPeerMessageUpdate(f.peer, f.room.id, published.message!.id)
    rows = await f.inbox(rootId)
    const reviewer = rows.filter((row) => row.value.memberId === 'reviewer')
    expect(reviewer.map((row) => row.value)).toEqual([
      expect.objectContaining({ sourceKind: 'invitation', sourceRevision: 2 })])
  })

  it('delivers task notices only to all-attention members and the task owner', async () => {
    const f = await fixture({ reviewer: 'mentions' })
    const rootId = await f.send('topic')
    await f.peer.deliverTask(rootId, { id: 'task-1', revision: 1, body: 'Gate update', memberId: 'developer' })
    let rows = await f.inbox(rootId)
    expect(rows.filter((row) => row.value.sourceKind === 'task').map((row) => row.value.memberId).sort())
      .toEqual(['coordinator', 'developer'])
    // The owner keeps receiving its own task notices even in mentions mode.
    await f.peer.deliverTask(rootId, { id: 'task-2', revision: 1, body: 'Owner gate', memberId: 'reviewer' })
    rows = await f.inbox(rootId)
    const owned = rows.filter((row) => row.value.sourceId === 'task-2')
    expect(owned.map((row) => row.value.memberId).sort()).toEqual(['coordinator', 'developer', 'reviewer'])
    expect(owned.find((row) => row.value.memberId === 'reviewer')?.value.sourceKind).toBe('task')
  })
})
