import { peerBudgetMember } from '../agents/agent-discussion-scope.js'
import { roomRunId } from './room-run-recording.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { RoomTaskActionSchema } from '../contracts/rooms-api.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomRuntimeDeps, RoomRequestState } from './room-runtime-types.js'
import type { RoomPeerTopicSummary } from './room-peer-types.js'
import { RoomPeerStore } from './room-peer-state.js'
import { RoomStoreConflictError, type RoomStoreCommit } from './room-store.js'
import { peerId } from './room-peer-inbox.js'
import { roomFingerprint } from './room-service.js'
export { deliverRoomPeerTaskProgress } from './room-peer-progress.js'

export async function roomPeerTopicPage(peer: RoomPeerStore, roomId: string, limit = 50, cursor?: number) {
  const room = await peer.store.get<Room>('room', roomId)
  const enabled = new Set(room?.value.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id) ?? [])
  const rows = await peer.store.list<RoomPeerTopicSummary>('peer_topic', { roomId, limit, beforeSeq: cursor })
  const topics: RoomPeerTopicSummary[] = []
  for (const row of rows) {
    const members: RoomPeerTopicSummary['members'] = []
    for (const member of await peer.members(row.id)) {
      const updates = await peer.readUpdates(row.id, member.value.memberId)
      const pendingCount = updates?.items.length ?? 0
      const blockedReason = !member.value.activation && !enabled.has(member.value.memberId) ? 'member_unavailable' :
        !member.value.activation && (row.value.memberResponses[peerBudgetMember(row.value, member.value.memberId)] ?? 0) >= 8 ? 'member_budget_exhausted' : undefined
      const activation = member.value.activation
      const activeRun = activation ? await peer.store.get<RoomRunRecord>('room_run',
        roomRunId(roomId, activation.clientRequestId, activation.phase === 'triage')) : null
      const currentRunId = activeRun?.roomId === roomId && activeRun.value.rootRequestId === row.id &&
        activeRun.value.memberId === member.value.memberId ? activeRun.id : undefined
      members.push({ memberId: member.value.memberId, currentRunId, state: member.value.state, pendingCount,
        seenInboxSeq: member.value.seenInboxSeq, handledInboxSeq: member.value.handledInboxSeq,
        responseCount: row.value.memberResponses[peerBudgetMember(row.value, member.value.memberId)] ?? 0,
        error: member.value.lastError, waitingReason: blockedReason ??
          (member.value.retryAt && Date.parse(member.value.retryAt) > Date.now() ? 'retry_backoff' : member.value.waitingReason) ??
          (pendingCount && !member.value.activation ? 'waiting_capacity' : undefined),
        invitedByMemberId: member.value.invitedByMemberId })
    }
    const request = await peer.store.get<RoomRequestState>('request', row.value.requestId)
    topics.push({ ...row.value, revision: row.revision, requestStatus: request?.value.status, members,
      pendingCount: members.reduce((count, member) => count + member.pendingCount, 0) })
  }
  return { topics, nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
}

export async function roomPeerMetricPage(peer: RoomPeerStore, roomId: string, rootRequestId: string,
  limit = 50, cursor?: number) {
  const topic = await peer.topic(rootRequestId)
  if (!topic || topic.roomId !== roomId) throw new Error('topic not found')
  const rows = await peer.store.list<Record<string, unknown>>('peer_metric', {
    roomId, rootRequestId, limit, beforeSeq: cursor
  })
  return { metrics: rows.map(({ id, value }) => ({ id, rootRequestId,
    memberId: value.memberId, phase: value.phase, outcome: value.outcome, model: value.model,
    generation: value.generation, elapsedMs: value.elapsedMs, usage: value.usage,
    firstResponseMs: value.firstResponseMs, usageStatus: value.usageStatus, holds: value.holds,
    createdAt: value.createdAt
  })), firstResponseAggregation: 'minimum_published_response_per_generation',
    nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
}

/** The user stop and cancellation generation become durable before any executor is signalled. */
export async function stopRoomPeerTopic(deps: RoomRuntimeDeps, peer: RoomPeerStore,
  roomId: string, rootRequestId: string, input: unknown) {
  const body = RoomTaskActionSchema.parse(input)
  const id = peerId('user-stop', roomId, rootRequestId, body.clientRequestId)
  const fingerprint = roomFingerprint({ roomId, rootRequestId, body })
  const receipt = await deps.store.getRequest(id)
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new RoomStoreConflictError('stop request identity conflict')
    return receipt.result
  }
  await deps.assertOwnership()
  const topic = await peer.topic(rootRequestId)
  if (!topic || topic.roomId !== roomId) throw new Error('topic not found')
  if (topic.revision !== body.expectedRevision) throw new RoomStoreConflictError('topic changed', topic.revision)
  const request = await deps.store.get<RoomRequestState>('request', topic.value.requestId)
  const next = { ...topic.value, status: 'stopping' as const, pauseReason: 'user_stopped',
    generation: topic.value.generation + 1, updatedAt: new Date().toISOString() }
  const result = { rootRequestId, status: next.status }
  const commit: RoomStoreCommit = { requestId: id, fingerprint,
    checks: [{ kind: 'peer_topic', id: topic.id, expectedRevision: topic.revision }],
    puts: [{ kind: 'peer_topic', id: topic.id, roomId, value: next }],
    events: [{ roomId, kind: 'peer.topic.updated', payload: { rootRequestId } }], result }
  if (request && !['completed', 'cancelled'].includes(request.value.status)) {
    commit.checks!.push({ kind: 'request', id: request.id, expectedRevision: request.revision })
    commit.puts!.push({ kind: 'request', id: request.id, roomId,
      value: { ...request.value, status: 'stopping', cancellationRequested: true } })
    commit.events!.push({ roomId, kind: 'request.updated', payload: { id: request.id } })
  }
  await deps.store.commit(commit)
  return result
}
