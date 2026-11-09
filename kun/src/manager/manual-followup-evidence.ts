import { isDeepStrictEqual } from 'node:util'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import type { AgentCommitment } from '../contracts/agent-commitments.js'
import type { CommitmentExecution } from '../contracts/collaboration-effects.js'
import { CollaborationEventSchema, CommitmentEventBindingSchema } from '../contracts/collaboration-events.js'
import type { CollaborationPolicy, CommitmentControl, CommitmentLink, FollowUpUserEvidenceSchema } from '../contracts/collaboration-followup.js'
import { RoomMessageSchema, RoomSchema } from '../contracts/rooms.js'
import type { z } from 'zod'
import { manualContinueBindingId, manualContinueEventId, manualContinueRequest, manualContinueSourceId } from '../agents/followup/manual-contract.js'
import type { RoomStore } from '../rooms/room-store.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

/** Rechecks revocable user, room and agent evidence at each physical admission boundary. */
export async function assertManualFollowUpEvidence(input: {
  store: RoomStore; execution: CommitmentExecution; commitment: AgentCommitment;
  control: CommitmentControl; policy: CollaborationPolicy; owner: CommitmentLink
}): Promise<void> {
  const { store, execution, commitment, control, policy, owner } = input
  const fail = (): never => { throw new NativeFollowUpPermitError('manual native user authority changed') }
  const permit = execution.permit, eventId = permit?.native?.manualEventId
  if (!eventId || !permit || !execution.nativeRequest || execution.envelope.eventIds.length !== 1 ||
    execution.envelope.eventIds[0] !== eventId || eventId !== manualContinueEventId(commitment.id, execution.requestId)) return fail()
  const [eventRow, bindingRow, roomRow, agentRow] = await Promise.all([
    store.get('collaboration_event', eventId), store.get('commitment_event_binding', manualContinueBindingId(commitment.id, eventId)),
    store.get('room', commitment.sourceRoomId), store.get('agent_identity', commitment.participantAgentId)
  ])
  if (!eventRow || !bindingRow || !roomRow || !agentRow) return fail()
  const event = CollaborationEventSchema.parse(eventRow.value), binding = CommitmentEventBindingSchema.parse(bindingRow.value)
  const room = RoomSchema.parse(roomRow.value), agent = AgentIdentitySchema.parse(agentRow.value)
  if (event.id !== eventId || event.kind !== 'user_continue' || event.provenance.kind !== 'user_message' ||
    event.sourceId !== manualContinueSourceId(commitment.sourceRoomId) || event.nativeKey !== execution.requestId ||
    event.resourceKey !== commitment.id || event.contextOnly || event.payloadRef ||
    event.objectRevision !== String(event.provenance.evidence.messageRevision) ||
    event.userAction?.actionId !== execution.requestId || event.userAction.issuedAt > permit.issuedAt ||
    !isDeepStrictEqual(execution.envelope.evidenceRefs, [{ kind: 'event', id: event.id, revision: eventRow.revision }]) ||
    binding.eventId !== eventId || binding.effectId !== execution.effectId || binding.commitmentId !== commitment.id ||
    binding.sourceRoomId !== commitment.sourceRoomId || binding.participantAgentId !== commitment.participantAgentId ||
    binding.purpose !== 'continuation' || !['reserved', 'consumed'].includes(binding.consumption) ||
    room.id !== commitment.sourceRoomId || room.archivedAt || !room.members.some(member =>
      member.participantAgentId === commitment.participantAgentId && member.enabled && !member.removedAt) ||
    agent.id !== commitment.participantAgentId || agent.archivedAt) return fail()
  const messages = new Map<string, ReturnType<typeof RoomMessageSchema.parse>>()
  const messageFor = async (evidence: z.infer<typeof FollowUpUserEvidenceSchema>) => {
    if (evidence.sourceRoomId !== commitment.sourceRoomId) return fail()
    let message = messages.get(evidence.sourceMessageId)
    if (!message) {
      const row = await store.get('message', evidence.sourceMessageId)
      if (!row || row.roomId !== commitment.sourceRoomId) return fail()
      message = RoomMessageSchema.parse(row.value)
      messages.set(evidence.sourceMessageId, message)
    }
    if (message.id !== evidence.sourceMessageId || message.roomId !== commitment.sourceRoomId ||
      message.authorKind !== 'user' || message.status !== 'final' || message.bodyRevision !== evidence.messageRevision) return fail()
    return message
  }
  await messageFor({ kind: 'user_message', sourceRoomId: commitment.sourceRoomId,
    sourceMessageId: commitment.sourceMessageId, messageRevision: commitment.authorization.messageRevision })
  await messageFor(control.userEvidence)
  await messageFor(policy.userEvidence)
  await messageFor(owner.userEvidence)
  const message = await messageFor(event.provenance.evidence)
  if (message.attachmentIds.length || message.references?.length ||
    !isDeepStrictEqual(manualContinueRequest(execution.requestId, message.body), execution.nativeRequest.request)) return fail()
}
