import { isDeepStrictEqual } from 'node:util'
import type { AgentCommitment } from '../../contracts/agent-commitments.js'
import { CommitmentControlSchema, type CommitmentControl } from '../../contracts/collaboration-followup.js'
import type { RoomStore, RoomStoreCommit } from '../../rooms/room-store.js'
import { commitmentScopeFingerprint, FollowUpError, followUpCheck, followUpPut } from './state.js'

/** Included in the legacy update's transaction, so concurrent enable/stop cannot be bypassed by an old PATCH. */
export async function guardLegacyCommitmentUpdate(store: RoomStore, before: AgentCommitment, after: AgentCommitment):
  Promise<{ checks: NonNullable<RoomStoreCommit['checks']>; puts: NonNullable<RoomStoreCommit['puts']> }> {
  const row = await store.get<CommitmentControl>('commitment_control', before.id)
  if (!row) return { checks: [{ kind: 'commitment_control', id: before.id, expectedRevision: null }], puts: [] }
  const control = CommitmentControlSchema.parse(row.value)
  if (control.sourceRoomId !== before.sourceRoomId || control.participantAgentId !== before.participantAgentId) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'commitment tracking scope mismatch')
  }
  const changedScope = commitmentScopeFingerprint(before) !== commitmentScopeFingerprint(after)
  if (['completed', 'cancelled'].includes(before.status) && after.status !== before.status) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'tracked commitments require explicit reopen')
  }
  if (after.status === 'completed' && (before.status !== 'completed' || changedScope ||
    !isDeepStrictEqual(before.results, after.results) || !isDeepStrictEqual(before.acceptanceEvidence, after.acceptanceEvidence))) {
    throw new FollowUpError('STALE_ATTENTION', 'tracked completion requires current versioned acceptance, not a legacy evidence string')
  }
  const checks = [followUpCheck(row)], puts: NonNullable<RoomStoreCommit['puts']> = []
  if (after.status === 'cancelled' && !control.stoppedAt) {
    puts.push(followUpPut(row, CommitmentControlSchema.parse({ ...control, generation: control.generation + 1,
      authorizationEpoch: control.authorizationEpoch + 1, trackingEnabled: false, paused: true,
      stoppedAt: after.updatedAt, updatedAt: after.updatedAt, nextWakeAt: after.updatedAt })))
  } else if (changedScope) {
    puts.push(followUpPut(row, CommitmentControlSchema.parse({ ...control, generation: control.generation + 1,
      authorizationEpoch: control.authorizationEpoch + 1, paused: true, updatedAt: after.updatedAt, nextWakeAt: after.updatedAt })))
  }
  return { checks, puts }
}
