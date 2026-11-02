import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { ContinueCommitment, ContinueCommitmentResult } from '../contracts/collaboration-followup-api.js'
import { CollaborationEventSchema, CommitmentEventBindingSchema } from '../contracts/collaboration-events.js'
import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { CollaborationPolicySchema, CommitmentControlSchema, CommitmentLinkSchema,
  FollowUpEnvelopeSchema, type FollowUpUserEvidenceSchema } from '../contracts/collaboration-followup.js'
import type { z } from 'zod'
import { RoomMessageSchema, RoomSchema } from '../contracts/rooms.js'
import { followUpCheck, followUpPolicyCurrent } from '../agents/followup/state.js'
import { assertBudget } from '../agents/followup/budget.js'
import { manualContinueCommandFingerprint, manualContinueFingerprint, manualContinueIds,
  manualContinueRequest, manualContinueSourceId } from '../agents/followup/manual-contract.js'
import { nativeFollowUpTargetFingerprint } from '../domain/native-followup-target.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RoomStoreCommit } from '../rooms/room-store.js'
import type { FollowUpArbitrationFence, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { assertManualFollowUpFence } from './manual-followup-fence.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'

/** Records only a genuine explicit user command; this does not start or admit a turn. */
export function stageManualFollowUp(input: {
  state: ServiceManagerState; store: SqliteRoomStore; threads: ThreadStore; writes: ManagerFollowUpWriteArbitration;
  fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence; enabled: () => boolean;
  participantAgentId: string; commitmentId: string; command: unknown; now?: () => string
}) {
  return input.writes.run(async () => {
    const now = input.now ?? (() => new Date().toISOString())
    const command = ContinueCommitment.parse(input.command)
    const fail = (reason: string): never => { throw new NativeFollowUpPermitError(reason) }
    const assertCurrent = () => assertManualFollowUpFence(input)
    assertCurrent()
    const ids = manualContinueIds(command.sourceRoomId, input.commitmentId, command.clientRequestId)
    const fingerprint = manualContinueCommandFingerprint({ participantAgentId: input.participantAgentId,
      commitmentId: input.commitmentId, command })
    const prior = await input.store.getRequest(ids.action)
    if (prior && prior.fingerprint !== fingerprint) return fail('manual action request identity was reused')

    const [commitmentRow, controlRow, linkRow, roomRow, agentRow] = await Promise.all([
      input.store.get('agent_commitment', input.commitmentId), input.store.get('commitment_control', input.commitmentId),
      input.store.get('commitment_link', command.linkId), input.store.get('room', command.sourceRoomId),
      input.store.get('agent_identity', input.participantAgentId)
    ])
    if (!commitmentRow || !controlRow || !linkRow || !roomRow || !agentRow) return fail('manual action scope is unavailable')
    const agent = AgentIdentitySchema.parse(agentRow.value)
    if (agent.id !== input.participantAgentId || agent.archivedAt) return fail('manual action agent is unavailable')
    const commitment = AgentCommitmentSchema.parse(commitmentRow.value)
    const control = CommitmentControlSchema.parse(controlRow.value), link = CommitmentLinkSchema.parse(linkRow.value)
    const room = RoomSchema.parse(roomRow.value), policyRow = await input.store.get('collaboration_policy', control.policyRef)
    if (!policyRow) return fail('manual action policy is unavailable')
    const policy = CollaborationPolicySchema.parse(policyRow.value)
    const clock = now()
    if (commitment.id !== input.commitmentId || commitment.participantAgentId !== input.participantAgentId ||
      commitment.sourceRoomId !== command.sourceRoomId || control.sourceRoomId !== command.sourceRoomId ||
      control.participantAgentId !== input.participantAgentId || controlRow.revision !== command.expectedControlRevision ||
      policyRow.revision !== command.expectedPolicyRevision || linkRow.revision !== command.expectedLinkRevision ||
      !control.trackingEnabled || control.paused || control.stoppedAt ||
      ['completed', 'cancelled'].includes(commitment.status) || !policy.allowedActions.includes('continue') ||
      !followUpPolicyCurrent(commitment, control, policy, clock)) return fail('manual action authorization changed')
    if (room.id !== command.sourceRoomId || room.archivedAt || !room.members.some(member =>
      member.participantAgentId === input.participantAgentId && member.enabled && !member.removedAt)) {
      return fail('manual action room membership changed')
    }
    if (!link.active || link.ownership !== 'owned' || link.stopRequestedAt || link.commitmentId !== commitment.id ||
      link.sourceRoomId !== commitment.sourceRoomId || link.participantAgentId !== commitment.participantAgentId ||
      !link.nativeTarget) return fail('manual action target is not an active owned native target')
    const owners = await input.store.collaborationQuery({ kind: 'owned_thread', threadId: link.nativeTarget.threadId })
    if (owners.length !== 1 || owners[0].id !== link.id) return fail('manual action target ownership is ambiguous')
    const thread = input.threads.getMetadata ? await input.threads.getMetadata(link.nativeTarget.threadId)
      : await input.threads.get(link.nativeTarget.threadId)
    if (!thread || nativeFollowUpTargetFingerprint(thread) !== link.nativeTarget.fingerprint) {
      return fail('manual action native target changed')
    }
    const checks: NonNullable<RoomStoreCommit['checks']> = [followUpCheck(commitmentRow), followUpCheck(controlRow), followUpCheck(policyRow),
      followUpCheck(linkRow), followUpCheck(roomRow), followUpCheck(agentRow)]
    const seen = new Map<string, ReturnType<typeof RoomMessageSchema.parse>>()
    const messageFor = async (evidence: z.infer<typeof FollowUpUserEvidenceSchema>) => {
      if (evidence.sourceRoomId !== commitment.sourceRoomId) return fail('manual action evidence is from another room')
      let message = seen.get(evidence.sourceMessageId)
      if (!message) {
        const row = await input.store.get('message', evidence.sourceMessageId)
        if (!row || row.roomId !== commitment.sourceRoomId) return fail('manual action user message is unavailable')
        message = RoomMessageSchema.parse(row.value)
        seen.set(evidence.sourceMessageId, message)
        checks.push(followUpCheck(row))
      }
      if (message.id !== evidence.sourceMessageId || message.roomId !== commitment.sourceRoomId ||
        message.authorKind !== 'user' || message.status !== 'final' || message.bodyRevision !== evidence.messageRevision) {
        return fail('manual action user evidence changed')
      }
      return message
    }
    await messageFor({ kind: 'user_message', sourceRoomId: commitment.sourceRoomId,
      sourceMessageId: commitment.sourceMessageId, messageRevision: commitment.authorization.messageRevision })
    await messageFor(control.userEvidence)
    await messageFor(policy.userEvidence)
    await messageFor(link.userEvidence)
    const actionMessage = await messageFor(command.userEvidence)
    if (!actionMessage.body.trim() || actionMessage.attachmentIds.length || actionMessage.references?.length ||
      Buffer.byteLength(actionMessage.body, 'utf8') > 256 * 1024) return fail('manual action message cannot be represented safely')
    assertCurrent()
    if (prior) {
      const result = ContinueCommitmentResult.parse(prior.result)
      const [event, binding, execution, effect] = await Promise.all([
        input.store.get('collaboration_event', ids.eventId), input.store.get('commitment_event_binding', ids.bindingId),
        input.store.get('commitment_execution', ids.attemptId), input.store.get('commitment_effect', ids.effectId)
      ])
      if (!event || !binding || !execution || !effect || result.requestId !== ids.requestId ||
        result.attemptId !== ids.attemptId || result.effectId !== ids.effectId ||
        CollaborationEventSchema.parse(event.value).userAction?.actionId !== ids.requestId ||
        CommitmentEventBindingSchema.parse(binding.value).effectId !== ids.effectId ||
        CommitmentExecutionSchema.parse(execution.value).requestId !== ids.requestId ||
        CommitmentEffectSchema.parse(effect.value).requestId !== ids.requestId) {
        return fail('manual action replay lost its durable evidence')
      }
      assertCurrent()
      if (policy.expiresAt <= now()) return fail('manual action policy expired')
      return result
    }

    const scope = { commitmentId: commitment.id, participantAgentId: commitment.participantAgentId,
      sourceRoomId: commitment.sourceRoomId }
    const [activeExecutions, activeEffects] = await Promise.all([
      input.store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'executions', limit: 1 }),
      input.store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'effects', limit: 1 })
    ])
    if (activeExecutions.length || activeEffects.length) return fail('another follow-up outcome is unsettled')
    const createdAt = now()
    // Read-only check: staging never rewrites the control row, which is the anchor the
    // evidence reservation and command fingerprint were authorised against. Only one
    // attempt can be in flight at a time, so nothing can slip between check and dispatch.
    assertBudget(policy, control, createdAt)
    const base = (id: string) => ({ schemaVersion: 1 as const, id, createdAt, updatedAt: createdAt })
    const evidenceRefs = [{ kind: 'event' as const, id: ids.eventId, revision: 0 }]
    const envelope = FollowUpEnvelopeSchema.parse({ schemaVersion: 1, commitmentId: scope.commitmentId,
      sourceRoomId: scope.sourceRoomId, generation: control.generation,
      authorizationEpoch: control.authorizationEpoch, policyVersion: policyRow.revision, target: link.target,
      eventIds: [ids.eventId], evidenceRefs, attemptId: ids.attemptId, effectId: ids.effectId, requestId: ids.requestId })
    const request = manualContinueRequest(ids.requestId, actionMessage.body)
    const semanticFingerprint = manualContinueFingerprint(envelope, request)
    const event = CollaborationEventSchema.parse({ ...base(ids.eventId), sourceId: manualContinueSourceId(scope.sourceRoomId),
      nativeKey: ids.requestId, objectRevision: String(command.userEvidence.messageRevision), kind: 'user_continue',
      resourceKey: commitment.id, occurredAt: createdAt, receivedAt: createdAt,
      provenance: { kind: 'user_message', evidence: command.userEvidence },
      userAction: { actionId: ids.requestId, issuedAt: createdAt }, summary: 'User requested continuation', contextOnly: false })
    const binding = CommitmentEventBindingSchema.parse({ ...base(ids.bindingId), ...scope, eventId: ids.eventId,
      purpose: 'continuation', decisionVersion: 0, inputVersions: { controlRevision: controlRow.revision,
        policyRevision: policyRow.revision }, disposition: 'ready', consumption: 'reserved', effectId: ids.effectId,
      reason: 'Explicit user action', evidenceRefs })
    const effect = CommitmentEffectSchema.parse({ ...base(ids.effectId), ...scope, effectId: ids.effectId, kind: 'continue',
      status: 'pending', requestId: ids.requestId, admissionKey: ids.admissionKey, fingerprint: semanticFingerprint,
      // Eligible from the moment the user asked; the due scan requires a timestamp here.
      envelope, retryAt: createdAt, nextReconcileAt: null })
    const execution = CommitmentExecutionSchema.parse({ ...base(ids.attemptId), ...scope, attemptId: ids.attemptId,
      effectId: ids.effectId, requestId: ids.requestId, fingerprint: semanticFingerprint, envelope, phase: 'reserved',
      nextReconcileAt: null, nativeRequest: { threadId: link.nativeTarget.threadId, request } })
    const result = { requestId: ids.requestId, effectId: ids.effectId, attemptId: ids.attemptId, status: 'pending' as const }
    await input.store.commit({ requestId: ids.action, fingerprint, checks: [...checks,
      ...([['collaboration_event', ids.eventId], ['commitment_event_binding', ids.bindingId],
        ['commitment_effect', ids.effectId], ['commitment_execution', ids.attemptId]] as const)
        .map(([kind, id]) => ({ kind, id, expectedRevision: null }))], puts: [
      { kind: 'collaboration_event', id: event.id, roomId: scope.sourceRoomId, value: event },
      { kind: 'commitment_event_binding', id: binding.id, roomId: scope.sourceRoomId, value: binding },
      { kind: 'commitment_effect', id: effect.id, roomId: scope.sourceRoomId, value: effect },
      { kind: 'commitment_execution', id: execution.id, roomId: scope.sourceRoomId, value: execution }
    ], events: [{ roomId: scope.sourceRoomId, kind: 'agent.commitment.updated',
      payload: { id: commitment.id, participantAgentId: scope.participantAgentId, action: 'continue_requested' } }], result }, () => {
      assertCurrent()
      if (policy.expiresAt <= now()) throw new NativeFollowUpPermitError('manual action policy expired before staging')
    })
    return result
  })
}
