import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRequestState } from './room-runtime-types.js'
import { RoomRunRecordSchema, type RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomStore, RoomStoreCommit } from './room-store.js'
import type { RoomPeerActivation, RoomPeerMemberState, RoomPeerTopic, RoomPeerInboxItem } from './room-peer-types.js'
import { roomRunId } from './room-run-recording.js'

/** Inbox snapshot and run identity are saved with budget admission; real thread identity comes later. */
export async function appendPeerActivationRun(store: RoomStore, commit: RoomStoreCommit,
  topic: RoomPeerTopic, member: RoomPeerMemberState, active: RoomPeerActivation): Promise<void> {
  const triage = active.phase === 'triage'
  // Pre-upgrade activations may have no persisted prompt. Never fabricate a run snapshot for them.
  if (!triage && !await store.get('context', active.contextId)) return
  const phase = triage ? 'triage' : 'discussion'
  const id = roomRunId(topic.roomId, active.clientRequestId, triage)
  if (await store.get('room_run', id)) return
  const previous = (await store.list<RoomRunRecord>('room_run', { roomId: topic.roomId,
    rootRequestId: topic.rootRequestId, memberId: member.memberId, phase, limit: 1 }))[0]
  const request = await store.get<RoomRequestState>('request', topic.requestId)
  const source = active.seenItems.at(-1)
  const inbox = source ? await store.get<RoomPeerInboxItem>('peer_inbox', source.id) : null
  const trigger = await store.get<RoomMessage>('message', inbox?.value.messageId ?? topic.sourceMessageId)
  const now = new Date().toISOString()
  const run = RoomRunRecordSchema.parse({ id, roomId: topic.roomId, rootRequestId: topic.rootRequestId,
    requestId: topic.requestId, memberId: member.memberId,
    memberLabel: topic.roomSnapshot.members.find((value) => value.id === member.memberId)?.displayName ?? member.memberId,
    phase, clientRequestId: active.clientRequestId, attempt: active.attempt, previousRunId: previous?.id,
    triggerMessageId: inbox?.value.sourceKind === 'task' ? undefined : trigger?.id ?? topic.sourceMessageId,
    triggerMessageRevision: inbox?.value.sourceKind === 'task' ? undefined : trigger?.value.bodyRevision,
    triggerSource: inbox ? { kind: inbox.value.sourceKind, id: inbox.value.sourceId, version: inbox.value.sourceRevision } : undefined,
    contextId: active.contextId, input: (inbox?.value.body ?? trigger?.value.body ?? request?.value.message.body ?? topic.title).slice(0, 64000),
    generation: active.generation, status: 'queued', createdAt: now, updatedAt: now })
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  commit.checks.push({ kind: 'room_run', id, expectedRevision: null })
  commit.puts.push({ kind: 'room_run', id, roomId: topic.roomId, value: run })
  commit.events.push({ roomId: topic.roomId, kind: 'room_run.updated', payload: { id, rootRequestId: topic.rootRequestId, memberId: member.memberId } })
}

/** Preserve history in the same transaction that discards the transient activation. */
export async function appendPeerRunOutcome(store: RoomStore, commit: RoomStoreCommit,
  member: RoomPeerMemberState, patch: Partial<RoomRunRecord>): Promise<void> {
  const active = member.activation
  if (!active) return
  const id = roomRunId(member.roomId, active.clientRequestId, active.phase === 'triage')
  const row = await store.get<RoomRunRecord>('room_run', id)
  if (!row || row.value.outcome === 'published') return
  const now = new Date().toISOString()
  const value = RoomRunRecordSchema.parse({ ...row.value, ...patch, updatedAt: now,
    endedAt: patch.status === 'recovery_required' ? row.value.endedAt : row.value.endedAt ?? now })
  commit.checks ??= []; commit.puts ??= []; commit.events ??= []
  commit.checks.push({ kind: 'room_run', id, expectedRevision: row.revision })
  commit.puts.push({ kind: 'room_run', id, roomId: row.roomId, taskId: row.taskId, value })
  commit.events.push({ roomId: member.roomId, kind: 'room_run.updated', payload: { id, rootRequestId: member.rootRequestId, memberId: member.memberId } })
}
