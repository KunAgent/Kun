import { AgentCommitmentSchema } from '../../contracts/agent-commitments.js'
import { CommitmentControlSchema, CommitmentLinkSchema, type CommitmentLink } from '../../contracts/collaboration-followup.js'
import { CommitmentExecutionSchema, type CommitmentExecution } from '../../contracts/collaboration-effects.js'
import { StopCommitmentTracking } from '../../contracts/collaboration-followup-api.js'
import type { RoomStoreCommit } from '../../rooms/room-store.js'
import { FollowUpError, FollowUpState, followUpCheck, followUpPut } from './state.js'
import type { FollowUpControlResult } from './service.js'

/** Intent is committed before cancellation. A stopped flag never proves that an external process has exited. */
export async function stopFollowUp(state: FollowUpState, agentId: string, id: string, raw: unknown): Promise<FollowUpControlResult> {
  await state.ready()
  const input = StopCommitmentTracking.parse(raw), commitment = await state.commitment(agentId, id)
  const request = state.request('stop', agentId, id, input), replay = await state.replay<FollowUpControlResult>(request)
  if (replay) return replay.result
  const prior = await state.control(commitment.value, input.expectedControlRevision)
  if (!prior) throw new FollowUpError('AUTHORIZATION_CHANGED', 'commitment is not tracked')
  const now = state.now(), checks: RoomStoreCommit['checks'] = [followUpCheck(commitment), followUpCheck(prior)]
  const puts: RoomStoreCommit['puts'] = []
  let control = CommitmentControlSchema.parse({ ...prior.value, updatedAt: now, nextWakeAt: now })
  if (input.scope === 'commitment') {
    if (input.targetId !== id) throw new FollowUpError('AUTHORIZATION_CHANGED', 'stop target does not match this commitment')
    control = CommitmentControlSchema.parse({ ...control, generation: prior.value.generation + 1,
      authorizationEpoch: prior.value.authorizationEpoch + 1, trackingEnabled: false,
      paused: true, stoppedAt: prior.value.stoppedAt ?? now })
    if (!['completed', 'cancelled'].includes(commitment.value.status)) {
      puts.push(followUpPut(commitment, AgentCommitmentSchema.parse({ ...commitment.value,
        status: 'cancelled', nextCheckAt: null, finishedAt: now, updatedAt: now })))
    }
  } else if (input.scope === 'target') {
    const row = await state.deps.store.get<CommitmentLink>('commitment_link', input.targetId)
    if (!row || row.value.commitmentId !== id || row.value.participantAgentId !== agentId ||
      row.value.sourceRoomId !== commitment.value.sourceRoomId || !row.value.active || row.value.ownership !== 'owned') {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'only an active owned target may be stopped')
    }
    if (row.revision !== input.expectedTargetRevision) throw new FollowUpError('STALE_REVISION', 'owned target changed', row.revision)
    if (!['thread', 'workbench_link', 'room_task', 'ade'].includes(row.value.target.kind)) {
      throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'this resource is not a cancellable execution target')
    }
    checks.push(followUpCheck(row))
    puts.push(followUpPut(row, CommitmentLinkSchema.parse({ ...row.value,
      stopRequestedAt: row.value.stopRequestedAt ?? now, updatedAt: now })))
  } else {
    const row = await state.deps.store.get<CommitmentExecution>('commitment_execution', input.targetId)
    if (!row || row.value.commitmentId !== id || row.value.participantAgentId !== agentId ||
      row.value.sourceRoomId !== commitment.value.sourceRoomId) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'execution occurrence is outside this commitment')
    }
    if (row.revision !== input.expectedTargetRevision) throw new FollowUpError('STALE_REVISION', 'execution occurrence changed', row.revision)
    checks.push(followUpCheck(row))
    if (row.value.phase !== 'terminal') {
      puts.push(followUpPut(row, CommitmentExecutionSchema.parse({ ...row.value,
        stopRequestedAt: row.value.stopRequestedAt ?? now, updatedAt: now, nextReconcileAt: now,
        ...(row.value.permit ? { permit: { ...row.value.permit, revokedAt: row.value.permit.revokedAt ?? now } } : {}) })))
    }
  }
  puts.push(followUpPut(prior, control))
  const result = { control, controlRevision: prior.revision + 1 }
  await state.commit({ ...request, checks, puts, events: [{ roomId: commitment.value.sourceRoomId,
    kind: 'agent.commitment.updated', payload: { id, participantAgentId: agentId,
      action: 'stop_requested', scope: input.scope, targetId: input.targetId } }], result })
  return result
}
