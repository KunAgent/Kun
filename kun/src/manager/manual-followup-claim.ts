import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CollaborationEventSchema } from '../contracts/collaboration-events.js'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { CommitmentControlSchema, CollaborationPolicySchema, CommitmentLinkSchema } from '../contracts/collaboration-followup.js'
import { followUpCheck, followUpPolicyCurrent } from '../agents/followup/state.js'
import { manualContinueEventId } from '../agents/followup/manual-contract.js'
import { nativeFollowUpTargetFingerprint } from '../domain/native-followup-target.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'
import type { FollowUpArbitrationFence, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { assertManualFollowUpFence } from './manual-followup-fence.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

const CLAIM_MS = 60_000
const fail = (message: string): never => { throw new NativeFollowUpPermitError(message) }

/** Claim a single already user-authorized action. This does not dispatch or mint a permit. */
export function claimManualFollowUp(input: {
  state: ServiceManagerState; store: SqliteRoomStore; threads: ThreadStore; writes: ManagerFollowUpWriteArbitration;
  fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence; attemptId: string;
  enabled: () => boolean; now?: () => string
}) {
  return input.writes.run(async () => {
    const now = input.now ?? (() => new Date().toISOString())
    const assertCurrent = () => assertManualFollowUpFence(input)
    assertCurrent()
    const executionRow = await input.store.get('commitment_execution', input.attemptId)
    if (!executionRow) return fail('manual follow-up execution is unavailable')
    const execution = CommitmentExecutionSchema.parse(executionRow.value), envelope = execution.envelope
    const [effectRow, controlRow, eventRow, commitmentRow] = await Promise.all([
      input.store.get('commitment_effect', execution.effectId), input.store.get('commitment_control', execution.commitmentId),
      input.store.get('collaboration_event', manualContinueEventId(execution.commitmentId, execution.requestId)),
      input.store.get('agent_commitment', execution.commitmentId)
    ])
    if (!effectRow || !controlRow || !eventRow || !commitmentRow) return fail('manual follow-up claim authority is unavailable')
    const effect = CommitmentEffectSchema.parse(effectRow.value), control = CommitmentControlSchema.parse(controlRow.value)
    const event = CollaborationEventSchema.parse(eventRow.value), commitment = AgentCommitmentSchema.parse(commitmentRow.value)
    if (execution.id !== input.attemptId || !execution.nativeRequest || !['reserved', 'admitted'].includes(execution.phase) ||
      execution.stopRequestedAt || execution.receipt || !['pending', 'dispatching'].includes(effect.status) || effect.receipt ||
      effect.kind !== 'continue' || effect.nextReconcileAt || effect.id !== execution.effectId ||
      effect.requestId !== execution.requestId || effect.fingerprint !== execution.fingerprint ||
      event.kind !== 'user_continue' || event.provenance.kind !== 'user_message' ||
      event.userAction?.actionId !== execution.requestId || envelope.eventIds.length !== 1 || envelope.eventIds[0] !== event.id ||
      control.commitmentId !== execution.commitmentId || control.participantAgentId !== execution.participantAgentId ||
      control.sourceRoomId !== execution.sourceRoomId || control.stoppedAt || control.authorizationEpoch !== envelope.authorizationEpoch ||
      commitment.id !== execution.commitmentId || commitment.sourceRoomId !== execution.sourceRoomId ||
      commitment.participantAgentId !== execution.participantAgentId || ['completed', 'cancelled'].includes(commitment.status) ||
      (!execution.permit && (!control.trackingEnabled || control.paused || control.generation !== envelope.generation))) {
      return fail('manual follow-up claim is no longer eligible')
    }
    const policyRow = control.policyRef ? await input.store.get('collaboration_policy', control.policyRef) : null
    const policy = policyRow ? CollaborationPolicySchema.parse(policyRow.value) : undefined
    if (!policy || policyRow!.revision !== envelope.policyVersion || !policy.allowedActions.includes('continue') ||
      !followUpPolicyCurrent(commitment, control, policy, now())) return fail('manual follow-up policy changed')
    const scope = { commitmentId: execution.commitmentId, participantAgentId: execution.participantAgentId,
      sourceRoomId: execution.sourceRoomId }
    const [effects, executions, owners] = await Promise.all([
      input.store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'effects', limit: 2 }),
      input.store.collaborationQuery({ kind: 'commitment_activity', ...scope, category: 'executions', limit: 2 }),
      input.store.collaborationQuery({ kind: 'owned_thread', threadId: execution.nativeRequest.threadId })
    ])
    if (effects.length !== 1 || effects[0].id !== effect.id || executions.length !== 1 || executions[0].id !== execution.id ||
      owners.length !== 1 || owners[0].kind !== 'commitment_link') return fail('manual follow-up target is ambiguous')
    const ownerRow = owners[0], owner = CommitmentLinkSchema.parse(ownerRow.value)
    if (!owner.active || owner.ownership !== 'owned' || owner.stopRequestedAt ||
      owner.commitmentId !== scope.commitmentId || owner.participantAgentId !== scope.participantAgentId ||
      owner.sourceRoomId !== scope.sourceRoomId || !owner.nativeTarget || owner.nativeTarget.threadId !== execution.nativeRequest.threadId ||
      !isDeepStrictEqual(owner.target, envelope.target)) return fail('manual follow-up target changed')
    const thread = await input.threads.getMetadata?.(owner.nativeTarget.threadId) ?? await input.threads.get(owner.nativeTarget.threadId)
    if (!thread || nativeFollowUpTargetFingerprint(thread) !== owner.nativeTarget.fingerprint ||
      thread.turns.some(turn => turn.status === 'queued' || turn.status === 'running')) return fail('manual follow-up target is busy')
    input.state.lease(thread.id)
    if (input.state.requiresTurnMutationFence(thread.id)) return fail('manual follow-up target still has an execution owner')
    assertCurrent()
    const currentTime = now(), prior = effect.claim
    if (prior && prior.expiresAt > currentTime) {
      if (effect.status !== 'dispatching' || prior.ownerId !== input.fence.ownerInstanceId) return fail('manual follow-up is already claimed')
      return { effectId: effect.id, attemptId: execution.id, token: prior.token, expiresAt: prior.expiresAt }
    }
    const claim = { ownerId: input.fence.ownerInstanceId, token: (prior?.token ?? 0) + 1,
      generation: envelope.generation, authorizationEpoch: envelope.authorizationEpoch,
      expiresAt: new Date(Date.parse(currentTime) + CLAIM_MS).toISOString() }
    const next = CommitmentEffectSchema.parse({ ...effect, status: 'dispatching', claim, updatedAt: currentTime })
    const result = { effectId: effect.id, attemptId: execution.id, token: claim.token, expiresAt: claim.expiresAt }
    await input.store.commit({ requestId: `manual-claim-${randomUUID()}`,
      checks: [effectRow, executionRow, controlRow, policyRow!, eventRow, ownerRow, commitmentRow].map(followUpCheck),
      puts: [{ kind: 'commitment_effect', id: effect.id, roomId: execution.sourceRoomId, value: next }], result }, () => {
      assertCurrent()
      if (policy.expiresAt <= now()) return fail('manual follow-up policy expired')
      input.state.lease(thread.id)
      if (input.state.requiresTurnMutationFence(thread.id)) return fail('manual follow-up target acquired an execution owner')
    })
    return result
  })
}
