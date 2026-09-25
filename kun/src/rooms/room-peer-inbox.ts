import { createHash } from 'node:crypto'
import type { Room } from '../contracts/rooms.js'
import type { RoomStore, RoomStoreCommit, RoomStoredDocument } from './room-store.js'
import type { RoomPeerInboxItem, RoomPeerMemberState, RoomPeerTopic } from './room-peer-types.js'

export const peerId = (...parts: unknown[]): string =>
  'peer-' + createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 48)
export const peerMemberId = (rootId: string, memberId: string): string => peerId('member', rootId, memberId)

export function emptyPeerMember(topic: RoomPeerTopic, memberId: string): RoomPeerMemberState {
  return { roomId: topic.roomId, rootRequestId: topic.rootRequestId, memberId, generation: topic.generation,
    state: 'pending', seenInboxSeq: 0, handledInboxSeq: 0, updatedAt: new Date().toISOString() }
}

export async function peerInboxRows(store: RoomStore, rootRequestId: string, memberId: string,
  afterSeq = 0, generation?: number): Promise<RoomStoredDocument<RoomPeerInboxItem>[]> {
  const rows: RoomStoredDocument<RoomPeerInboxItem>[] = []
  while (rows.length < 1000) {
    const page = await store.list<RoomPeerInboxItem>('peer_inbox', { rootRequestId, memberId,
      afterSeq: rows.at(-1)?.seq ?? afterSeq, peerGeneration: generation, coalescePeerMessages: true,
      order: 'asc', limit: Math.min(200, 1000 - rows.length) })
    rows.push(...page)
    if (page.length < 200) break
  }
  return rows
}

/**
 * Ordinary 'message' fan-out skips members whose attention mode is 'mentions'.
 * Explicit @-mentions and structured invitations already arrive through the
 * unfiltered 'invitation' deliveries, while directly designated recipients —
 * the default member on a mention-less request or a task owner — always stay.
 * Members without the setting (legacy data) behave as 'all'.
 */
export function peerMessageRecipients(room: Pick<Room, 'members'>, candidateIds: Iterable<string>,
  opts?: { designated?: Iterable<string> }): string[] {
  const designated = new Set(opts?.designated ?? [])
  const quiet = new Set(room.members.filter((member) => member.attention === 'mentions')
    .map((member) => member.id))
  return [...new Set(candidateIds)].filter((id) => designated.has(id) || !quiet.has(id))
}

/** Inbox identity binds the immutable source revision, never the SSE transport cursor. */
export async function appendPeerInbox(store: RoomStore, commit: RoomStoreCommit,
  topic: RoomPeerTopic, recipients: string[], source: Omit<RoomPeerInboxItem,
    'roomId' | 'rootRequestId' | 'memberId' | 'generation' | 'createdAt'>): Promise<void> {
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  for (const memberId of [...new Set(recipients)]) {
    const id = peerId('inbox', topic.rootRequestId, topic.generation, memberId,
      source.sourceKind, source.sourceId, source.sourceRevision, source.causeId)
    if (await store.get('peer_inbox', id)) continue
    const item: RoomPeerInboxItem = { ...source, roomId: topic.roomId, rootRequestId: topic.rootRequestId,
      memberId, generation: topic.generation, createdAt: new Date().toISOString() }
    commit.checks.push({ kind: 'peer_inbox', id, expectedRevision: null })
    commit.puts.push({ kind: 'peer_inbox', id, roomId: topic.roomId, value: item })
    const stateId = peerMemberId(topic.rootRequestId, memberId)
    const old = await store.get<RoomPeerMemberState>('peer_member', stateId)
    if (!commit.puts.some((put) => put.kind === 'peer_member' && put.id === stateId)) {
      const state = old?.value ?? emptyPeerMember(topic, memberId)
      commit.checks.push({ kind: 'peer_member', id: stateId, expectedRevision: old?.revision ?? null })
      commit.puts.push({ kind: 'peer_member', id: stateId, roomId: topic.roomId, value: {
        ...state, state: state.activation ? state.state : 'pending',
        ...(source.sourceKind === 'invitation' ? { invitedByMemberId: source.authorMemberId } : {}),
        updatedAt: new Date().toISOString()
      } })
    }
    commit.events.push({ roomId: topic.roomId, kind: 'peer.inbox.updated', payload: { rootRequestId: topic.rootRequestId, memberId } })
  }
}
