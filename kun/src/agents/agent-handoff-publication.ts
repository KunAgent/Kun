import type { AgentHandoff } from '../contracts/agent-handoffs.js'
import { RoomMessageSchema } from '../contracts/rooms.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomStoreCommit, RoomStoredDocument } from '../rooms/room-store.js'
import { appendPeerInbox } from '../rooms/room-peer-inbox.js'
import { attachRoomRunPublication } from '../rooms/room-run-recording.js'
import type { AgentHandoffService } from './agent-handoff-service.js'
import { agentStableId } from './agent-identity-service.js'

/** Publishing the scoped reply, source notification and durable acknowledgements is one transaction. */
export async function publishAgentHandoff(service: AgentHandoffService, row: RoomStoredDocument<AgentHandoff>, body: string) {
  const handoff = row.value
  const source = await service.source(handoff.id)
  if (!await service.current(handoff.id)) return false
  const now = new Date().toISOString()
  const message = RoomMessageSchema.parse({ id: agentStableId('handoff-reply', handoff.id, handoff.clientTurnId),
    roomId: handoff.pairRoomId, rootRequestId: handoff.id, sourceRequestId: handoff.id, handoffId: handoff.id,
    messageSeq: 1, authorKind: 'member', authorMemberId: handoff.recipientAgentId, authorAgentId: handoff.recipientAgentId,
    authorLabelSnapshot: handoff.recipientSnapshot.displayName, body: body.slice(0, 64000), bodyRevision: 0,
    mentionMemberIds: [handoff.senderAgentId], replyToMessageId: handoff.id + '-opening',
    attachmentIds: [], status: 'final', createdAt: now })
  const notice = RoomMessageSchema.parse({ id: agentStableId('handoff-result-notice', handoff.id),
    roomId: handoff.sourceRoomId, rootRequestId: handoff.sourceRootRequestId, sourceRequestId: handoff.sourceRequestId,
    handoffId: handoff.id, messageSeq: 1, authorKind: 'system', authorLabelSnapshot: 'Kun',
    body: handoff.recipientSnapshot.displayName + ' · ' + body.slice(0, 6000), bodyRevision: 0,
    mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: now })
  const value: AgentHandoff = { ...handoff, status: 'completed', result: body.slice(0, 64000),
    resultMessageId: message.id, sourceNoticeId: handoff.parentHandoffId ? undefined : notice.id,
    endedAt: now, updatedAt: now, waitingReason: undefined }
  const commit: RoomStoreCommit = { requestId: handoff.id + ':published',
    checks: [{ kind: 'agent_handoff', id: handoff.id, expectedRevision: row.revision },
      { kind: 'message', id: message.id, expectedRevision: null },
      { kind: 'request', id: source.root!.id, expectedRevision: source.root!.revision },
      ...(source.request?.id !== source.root?.id ? [{ kind: 'request' as const, id: source.request!.id, expectedRevision: source.request!.revision }] : []),
      ...(source.topic ? [{ kind: 'peer_topic' as const, id: source.topic.id, expectedRevision: source.topic.revision }] : [])],
    puts: [{ kind: 'agent_handoff', id: handoff.id, roomId: row.roomId, value },
      { kind: 'message', id: message.id, roomId: handoff.pairRoomId, value: message }],
    events: [{ roomId: handoff.pairRoomId, kind: 'message.presentation.created', payload: { id: message.id } },
      { roomId: handoff.sourceRoomId, kind: 'agent.handoff.updated', payload: { id: handoff.id } }],
    result: { handoff: value } }
  for (const ref of handoff.sources) {
    const row = await service.deps.store.get('message', ref.id)
    commit.checks!.push({ kind: 'message', id: ref.id, expectedRevision: row!.revision })
  }
  await attachRoomRunPublication(service.deps.store, commit, message, handoff.runId)
  if (!handoff.parentHandoffId) {
    commit.checks!.push({ kind: 'message', id: notice.id, expectedRevision: null })
    commit.puts!.push({ kind: 'message', id: notice.id, roomId: handoff.sourceRoomId, value: notice })
    commit.events!.push({ roomId: handoff.sourceRoomId, kind: 'message.presentation.created', payload: { id: notice.id } })
    if (source.topic) {
      const topic = { ...source.topic.value,
        publicationRevision: source.topic.value.publicationRevision + 1,
        status: source.topic.value.status === 'idle' ? 'active' as const : source.topic.value.status }
      commit.puts!.push({ kind: 'peer_topic', id: source.topic.id, roomId: handoff.sourceRoomId, value: topic })
      const receiver = topic.roomSnapshot.members.some((member) => member.id === handoff.senderMemberId) ? handoff.senderMemberId : topic.roomSnapshot.defaultMemberId
      await appendPeerInbox(service.deps.store, commit, topic, [receiver], {
        sourceKind: 'invitation', sourceId: notice.id, sourceRevision: 0,
        messageId: notice.id, causeId: handoff.id, body: notice.body
      })
    } else {
      const requestId = agentStableId('handoff-return', handoff.id)
      const original = source.request!.value
      const request: RoomRequestState = { id: requestId, roomId: handoff.sourceRoomId,
        rootRequestId: handoff.sourceRootRequestId, status: 'pending', stage: 'discuss', collaborationProtocol: 'legacy',
        sourceMessageId: notice.id, roomSnapshot: original.roomSnapshot,
        threadId: agentStableId('handoff-return-thread', handoff.id),
        message: { clientRequestId: requestId, body: notice.body, executionIntent: 'discussion',
          mentionMemberIds: [original.roomSnapshot.members.some((member) => member.id === handoff.senderMemberId) ? handoff.senderMemberId : original.roomSnapshot.defaultMemberId], attachmentIds: [] },
        discussions: [{ memberId: original.roomSnapshot.members.some((member) => member.id === handoff.senderMemberId) ? handoff.senderMemberId : original.roomSnapshot.defaultMemberId, threadId: agentStableId('handoff-return-thread', handoff.id) }],
        handoffReturnId: handoff.id }
      commit.checks!.push({ kind: 'request', id: requestId, expectedRevision: null })
      commit.puts!.push({ kind: 'request', id: requestId, roomId: handoff.sourceRoomId, value: request })
    }
  }
  await service.deps.store.commit(commit)
  return true
}
