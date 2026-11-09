import { isDeepStrictEqual } from 'node:util'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { CollaborationEventSchema, CommitmentEventBindingSchema } from '../contracts/collaboration-events.js'
import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { CollaborationPolicySchema, CommitmentControlSchema, CommitmentLinkSchema,
  type FollowUpUserEvidenceSchema } from '../contracts/collaboration-followup.js'
import { RoomMessageSchema, RoomSchema } from '../contracts/rooms.js'
import type { z } from 'zod'
import { manualContinueBindingId, manualContinueEventId, manualContinueFingerprint,
  manualContinueRequest, manualContinueSourceId } from '../agents/followup/manual-contract.js'
import { followUpCheck, followUpPolicyCurrent } from '../agents/followup/state.js'
import { nativeFollowUpTargetFingerprint } from '../domain/native-followup-target.js'
import { fingerprintStartTurnRequest } from '../domain/turn-request-fingerprint.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore, RoomStoredDocument } from '../rooms/room-store.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'
import type { ServiceManagerState } from './service-manager-state.js'

/** All returned revisions must be checked by the issuer's physical RoomStore transaction. */
export async function verifyManualNativeAdmission(input: {
  store: RoomStore; threads: ThreadStore; state: ServiceManagerState; attemptId: string;
  claimToken: number; ownerId: string; now: string; allowPausedIssued?: boolean
}) {
  const { store, now } = input
  const fail = (reason: string): never => { throw new NativeFollowUpPermitError(reason) }
  const executionRow = await store.get('commitment_execution', input.attemptId)
  if (!executionRow) return fail('native execution is unavailable')
  const execution = CommitmentExecutionSchema.parse(executionRow.value)
  const effectRow = await store.get('commitment_effect', execution.effectId)
  if (!effectRow) return fail('native effect is unavailable')
  const effect = CommitmentEffectSchema.parse(effectRow.value), envelope = execution.envelope
  const checks: Array<ReturnType<typeof followUpCheck>> = [followUpCheck(executionRow), followUpCheck(effectRow)]
  const permit = execution.permit
  const replay = execution.phase === 'admitted' && Boolean(permit?.native)
  if ((!replay && (execution.phase !== 'reserved' || permit)) || execution.stopRequestedAt || execution.receipt ||
    effect.kind !== 'continue' || effect.status !== 'dispatching' || !effect.claim || effect.receipt ||
    effect.claim.ownerId !== input.ownerId || effect.claim.token !== input.claimToken || effect.claim.expiresAt <= now ||
    !isDeepStrictEqual(effect.envelope, envelope) || effect.fingerprint !== execution.fingerprint ||
    effect.requestId !== execution.requestId || !execution.nativeRequest || envelope.source || envelope.expectedArtifact ||
    envelope.eventIds.length !== 1) return fail('manual native attempt or claim is not eligible')

  const controlRow = await store.get('commitment_control', envelope.commitmentId)
  const commitmentRow = await store.get('agent_commitment', envelope.commitmentId)
  if (!controlRow || !commitmentRow) return fail('native commitment is unavailable')
  const control = CommitmentControlSchema.parse(controlRow.value), commitment = AgentCommitmentSchema.parse(commitmentRow.value)
  const policyRow = await store.get('collaboration_policy', control.policyRef)
  if (!policyRow) return fail('native policy is unavailable')
  const policy = CollaborationPolicySchema.parse(policyRow.value)
  const resumeIssued = replay && input.allowPausedIssued === true
  if (control.stoppedAt || ['completed', 'cancelled'].includes(commitment.status) ||
    control.generation < envelope.generation || control.authorizationEpoch !== envelope.authorizationEpoch ||
    !resumeIssued && (!control.trackingEnabled || control.paused || control.generation !== envelope.generation) ||
    policyRow.revision !== envelope.policyVersion || !policy.allowedActions.includes('continue') ||
    !followUpPolicyCurrent(commitment, control, policy, now) ||
    commitment.sourceRoomId !== envelope.sourceRoomId || commitment.participantAgentId !== execution.participantAgentId ||
    control.sourceRoomId !== commitment.sourceRoomId || control.participantAgentId !== commitment.participantAgentId ||
    effect.participantAgentId !== commitment.participantAgentId) {
    return fail('manual native authorization was revoked or changed')
  }
  const agentRow = await store.get('agent_identity', commitment.participantAgentId)
  if (!agentRow) return fail('manual native agent is unavailable')
  const agent = AgentIdentitySchema.parse(agentRow.value)
  if (agent.id !== commitment.participantAgentId || agent.archivedAt) return fail('manual native agent is unavailable')
  checks.push(followUpCheck(controlRow), followUpCheck(commitmentRow), followUpCheck(policyRow), followUpCheck(agentRow))
  const scope = { commitmentId: commitment.id, participantAgentId: commitment.participantAgentId,
    sourceRoomId: commitment.sourceRoomId }
  const [activeExecutions, activeEffects] = await Promise.all([
    store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'executions', limit: 2 }),
    store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'effects', limit: 2 })
  ])
  if (activeExecutions.length !== 1 || activeExecutions[0].id !== execution.id ||
    activeEffects.length !== 1 || activeEffects[0].id !== effect.id) {
    return fail('manual native attempt overlaps another unsettled execution or effect')
  }

  const threadId = execution.nativeRequest.threadId
  const owners = await store.collaborationQuery({ kind: 'owned_thread', threadId })
  if (owners.length !== 1) return fail('manual native target does not have exactly one owner')
  const ownerRow = owners[0], owner = CommitmentLinkSchema.parse(ownerRow.value)
  if (!owner.active || owner.ownership !== 'owned' || owner.stopRequestedAt ||
    owner.commitmentId !== commitment.id || owner.sourceRoomId !== commitment.sourceRoomId ||
    owner.participantAgentId !== commitment.participantAgentId || !isDeepStrictEqual(owner.target, envelope.target) ||
    !owner.nativeTarget || owner.nativeTarget.threadId !== threadId) return fail('manual native target ownership changed')
  checks.push(followUpCheck(ownerRow))
  const thread = input.threads.getMetadata ? await input.threads.getMetadata(threadId) : await input.threads.get(threadId)
  if (!thread || nativeFollowUpTargetFingerprint(thread) !== owner.nativeTarget.fingerprint ||
    !replay && thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) {
    return fail('manual native target is unavailable, changed, or busy')
  }
  if (!replay) {
    input.state.lease(threadId)
    if (input.state.requiresTurnMutationFence(threadId)) return fail('manual native target still has an execution owner')
  }

  const eventId = manualContinueEventId(commitment.id, effect.requestId)
  if (envelope.eventIds[0] !== eventId) return fail('manual native event identity mismatch')
  const eventRow = await store.get('collaboration_event', eventId)
  const bindingRow = await store.get('commitment_event_binding', manualContinueBindingId(commitment.id, eventId))
  if (!eventRow || !bindingRow) return fail('manual native action evidence is unavailable')
  const event = CollaborationEventSchema.parse(eventRow.value), binding = CommitmentEventBindingSchema.parse(bindingRow.value)
  if (event.kind !== 'user_continue' || event.contextOnly || event.provenance.kind !== 'user_message' ||
    event.sourceId !== manualContinueSourceId(commitment.sourceRoomId) || event.nativeKey !== effect.requestId ||
    event.resourceKey !== commitment.id || event.objectRevision !== String(event.provenance.evidence.messageRevision) ||
    event.payloadRef || !event.userAction || event.userAction.actionId !== effect.requestId || event.userAction.issuedAt > now ||
    binding.eventId !== event.id || binding.commitmentId !== commitment.id || binding.sourceRoomId !== commitment.sourceRoomId ||
    binding.participantAgentId !== commitment.participantAgentId || binding.purpose !== 'continuation' ||
    binding.disposition !== 'ready' || binding.consumption !== 'reserved' || binding.effectId !== effect.id ||
    binding.inputVersions.controlRevision !== (resumeIssued ? permit?.controlRevision : controlRow.revision) ||
    binding.inputVersions.policyRevision !== policyRow.revision ||
    !isDeepStrictEqual(envelope.evidenceRefs, [{ kind: 'event', id: event.id, revision: eventRow.revision }]) ||
    !isDeepStrictEqual(binding.evidenceRefs, envelope.evidenceRefs)) {
    return fail('manual native action evidence does not match its reservation')
  }
  checks.push(followUpCheck(eventRow), followUpCheck(bindingRow))
  const roomRow = await store.get('room', commitment.sourceRoomId)
  if (!roomRow) return fail('manual native source room is unavailable')
  const room = RoomSchema.parse(roomRow.value)
  if (room.id !== commitment.sourceRoomId || room.archivedAt || !room.members.some((member) => member.participantAgentId === commitment.participantAgentId &&
    member.enabled && !member.removedAt)) return fail('manual native source room membership changed')
  checks.push(followUpCheck(roomRow))
  const messages = new Map<string, RoomStoredDocument<ReturnType<typeof RoomMessageSchema.parse>>>()
  const messageFor = async (evidence: z.infer<typeof FollowUpUserEvidenceSchema>) => {
    if (evidence.sourceRoomId !== commitment.sourceRoomId) return fail('manual native user evidence belongs to another room')
    let row = messages.get(evidence.sourceMessageId)
    if (!row) {
      const raw = await store.get('message', evidence.sourceMessageId)
      if (!raw) return fail('manual native user evidence is unavailable')
      row = { ...raw, value: RoomMessageSchema.parse(raw.value) }
      messages.set(evidence.sourceMessageId, row)
      checks.push(followUpCheck(row))
    }
    if (row.roomId !== commitment.sourceRoomId || row.value.roomId !== commitment.sourceRoomId ||
      row.value.id !== evidence.sourceMessageId || row.value.authorKind !== 'user' || row.value.status !== 'final' ||
      row.value.bodyRevision !== evidence.messageRevision) {
      return fail('manual native user evidence changed')
    }
    return row.value
  }
  await messageFor({ kind: 'user_message', sourceRoomId: commitment.sourceRoomId,
    sourceMessageId: commitment.sourceMessageId, messageRevision: commitment.authorization.messageRevision })
  await messageFor(control.userEvidence)
  await messageFor(policy.userEvidence)
  await messageFor(owner.userEvidence)
  const message = await messageFor(event.provenance.evidence)
  if (!message.body.trim() || message.attachmentIds.length || message.references?.length ||
    Buffer.byteLength(message.body, 'utf8') > 256 * 1024) {
    return fail('manual native user message cannot be admitted')
  }
  const request = manualContinueRequest(effect.requestId, message.body)
  if (!isDeepStrictEqual(execution.nativeRequest.request, request) ||
    manualContinueFingerprint(envelope, request) !== execution.fingerprint) {
    return fail('manual native input is not the authorized user message')
  }
  const requestFingerprint = fingerprintStartTurnRequest(request)
  if (!requestFingerprint) return fail('manual native request identity is unavailable')
  if (replay && (!permit?.native || permit.revokedAt || permit.admissionKey !== effect.admissionKey ||
    (resumeIssued ? permit.controlRevision > controlRow.revision : permit.controlRevision !== controlRow.revision) ||
    permit.claimToken > input.claimToken ||
    permit.native.threadId !== threadId || permit.native.requestFingerprint !== requestFingerprint ||
    permit.native.targetFingerprint !== owner.nativeTarget.fingerprint)) {
    return fail('existing manual native permit does not match the reservation')
  }
  return { executionRow, execution, effect, controlRow, policy, owner, threadId, requestFingerprint, checks, replay }
}
