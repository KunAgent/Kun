import type { z } from 'zod'
import { AgentCommitmentSchema } from '../../contracts/agent-commitments.js'
import { CollaborationPolicySchema, CommitmentControlSchema, type CommitmentControl, type CommitmentLink } from '../../contracts/collaboration-followup.js'
import { EnableCommitmentTracking, UpdateCommitmentTracking, ReopenCommitmentTracking,
  FollowUpMutation, ContinueCommitment, AttentionListQuery, type ContinueCommitmentResult,
  type CommitmentTrackingAction, type FollowUpPolicyInput } from '../../contracts/collaboration-followup-api.js'
import type { CommitmentAttention } from '../../contracts/collaboration-attention.js'
import type { RoomRuntimeDeps } from '../../rooms/room-runtime-types.js'
import { agentStableId } from '../agent-identity-service.js'
import { FollowUpState, FollowUpError, followUpCheck, followUpPut, followUpScope, commitmentScopeFingerprint,
  followUpPolicyCurrent, type FollowUpOptions } from './state.js'
import { stopFollowUp } from './stop.js'
import { createFollowUpLink, releaseFollowUpLink } from './links.js'
import { openBusinessAttention, resolveBusinessAttention } from './attention.js'
import { projectFollowUp, followUpTargetFact } from './projection.js'

export type FollowUpControlResult = { control: CommitmentControl; controlRevision: number }

/** User controls only record fenced intent. The Runtime owns all execution and reconciliation. */
export class FollowUpService {
  readonly state: FollowUpState
  constructor(deps: RoomRuntimeDeps, options: FollowUpOptions) { this.state = new FollowUpState(deps, options) }

  async get(agentId: string, id: string) {
    const commitment = await this.state.commitment(agentId, id)
    return projectFollowUp(this.state, commitment)
  }

  async enable(agentId: string, id: string, raw: unknown): Promise<FollowUpControlResult> {
    const state = this.state
    await state.ready()
    const input = EnableCommitmentTracking.parse(raw), commitment = await state.commitment(agentId, id)
    const request = state.request('enable', agentId, id, input), replay = await state.replay<FollowUpControlResult>(request)
    if (replay) return replay.result
    state.requireEnabled(input.policy.continuationMode)
    const prior = await state.control(commitment.value, input.expectedControlRevision)
    if (['completed', 'cancelled'].includes(commitment.value.status) || prior?.value.stoppedAt) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'ended commitments require an explicit reopen')
    }
    if (prior?.value.trackingEnabled) throw new FollowUpError('STALE_REVISION', 'tracking is already enabled', prior.revision)
    const evidenceChecks = await state.userEvidence(commitment.value, input.userEvidence)
    const now = state.now(), scope = followUpScope(commitment.value)
    this.validatePolicy(input.policy, now)
    const policy = CollaborationPolicySchema.parse({ ...scope, ...input.policy, commitmentFingerprint: commitmentScopeFingerprint(commitment.value),
      id: agentStableId('policy', request.requestId),
      schemaVersion: 1, createdAt: now, updatedAt: now, userEvidence: input.userEvidence })
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0)
    const control = CommitmentControlSchema.parse({ ...scope, id, schemaVersion: 1,
      generation: prior ? prior.value.generation + 1 : 0, continuationMode: policy.continuationMode,
      paused: false, trackingEnabled: true, policyRef: policy.id,
      authorizationEpoch: prior ? prior.value.authorizationEpoch + 1 : 0,
      budget: prior?.value.budget ?? { windowStart: day.toISOString(),
        windowEnd: new Date(day.getTime() + 86_400_000).toISOString(), reserved: 0, consumed: 0, totalConsumed: 0 },
      nextWakeAt: now, userEvidence: input.userEvidence, createdAt: prior?.value.createdAt ?? now, updatedAt: now })
    const result = { control, controlRevision: (prior?.revision ?? -1) + 1 }
    await state.commit({ ...request, checks: [followUpCheck(commitment), ...evidenceChecks,
      { kind: 'commitment_control', id, expectedRevision: prior?.revision ?? null },
      { kind: 'collaboration_policy', id: policy.id, expectedRevision: null }],
      puts: [{ kind: 'commitment_control', id, roomId: scope.sourceRoomId, value: control },
        { kind: 'collaboration_policy', id: policy.id, roomId: scope.sourceRoomId, value: policy }],
      events: [this.event(scope.sourceRoomId, agentId, id, 'enabled')], result })
    return result
  }

  async action(agentId: string, id: string, action: CommitmentTrackingAction, raw: unknown): Promise<FollowUpControlResult> {
    const state = this.state
    await state.ready()
    const input = FollowUpMutation.parse(raw), commitment = await state.commitment(agentId, id)
    const request = state.request(action, agentId, id, input), replay = await state.replay<FollowUpControlResult>(request)
    if (replay) return replay.result
    const prior = await state.control(commitment.value, input.expectedControlRevision)
    if (!prior) throw new FollowUpError('AUTHORIZATION_CHANGED', 'commitment is not tracked')
    if (prior.value.stoppedAt || ['completed', 'cancelled'].includes(commitment.value.status)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'ended commitments require an explicit reopen')
    }
    const checks = [followUpCheck(commitment), followUpCheck(prior)]
    if (action === 'resume') {
      state.requireEnabled(prior.value.continuationMode)
      if (!prior.value.trackingEnabled) throw new FollowUpError('AUTHORIZATION_CHANGED', 'enable tracking explicitly before resuming')
      const policy = await state.deps.store.get('collaboration_policy', prior.value.policyRef)
      const currentPolicy = policy && CollaborationPolicySchema.parse(policy.value)
      if (!followUpPolicyCurrent(commitment.value, prior.value, currentPolicy, state.now())) {
        throw new FollowUpError('AUTHORIZATION_CHANGED', 'follow-up scope or expiry changed; renew authorization explicitly')
      }
      checks.push(followUpCheck(policy!))
    }
    const now = state.now()
    const control = CommitmentControlSchema.parse({ ...prior.value, updatedAt: now,
      generation: prior.value.generation + 1, paused: action !== 'resume',
      trackingEnabled: action === 'disable' ? false : prior.value.trackingEnabled, nextWakeAt: now })
    const result = { control, controlRevision: prior.revision + 1 }
    await state.commit({ ...request, checks,
      puts: [followUpPut(prior, control)], events: [this.event(control.sourceRoomId, agentId, id, action)], result })
    return result
  }

  async update(agentId: string, id: string, raw: unknown): Promise<FollowUpControlResult> {
    const state = this.state
    await state.ready()
    const input = UpdateCommitmentTracking.parse(raw), commitment = await state.commitment(agentId, id)
    const request = state.request('update', agentId, id, input), replay = await state.replay<FollowUpControlResult>(request)
    if (replay) return replay.result
    state.requireEnabled(input.policy.continuationMode)
    const prior = await state.control(commitment.value, input.expectedControlRevision)
    if (!prior || prior.value.stoppedAt || ['completed', 'cancelled'].includes(commitment.value.status)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'ended or untracked commitment cannot change follow-up policy')
    }
    const evidenceChecks = await state.userEvidence(commitment.value, input.userEvidence)
    const now = state.now()
    this.validatePolicy(input.policy, now)
    const policy = CollaborationPolicySchema.parse({ ...followUpScope(commitment.value), ...input.policy,
      commitmentFingerprint: commitmentScopeFingerprint(commitment.value),
      schemaVersion: 1, id: agentStableId('policy', request.requestId), userEvidence: input.userEvidence, createdAt: now, updatedAt: now })
    const control = CommitmentControlSchema.parse({ ...prior.value, policyRef: policy.id,
      generation: prior.value.generation + 1, authorizationEpoch: prior.value.authorizationEpoch + 1,
      continuationMode: policy.continuationMode, userEvidence: input.userEvidence, updatedAt: now, nextWakeAt: now })
    const result = { control, controlRevision: prior.revision + 1 }
    await state.commit({ ...request, checks: [followUpCheck(commitment), followUpCheck(prior), ...evidenceChecks,
      { kind: 'collaboration_policy', id: policy.id, expectedRevision: null }],
      puts: [followUpPut(prior, control), { kind: 'collaboration_policy', id: policy.id, roomId: control.sourceRoomId, value: policy }],
      events: [this.event(control.sourceRoomId, agentId, id, 'policy_changed')], result })
    return result
  }

  async reopen(agentId: string, id: string, raw: unknown): Promise<FollowUpControlResult> {
    const state = this.state
    await state.ready()
    const input = ReopenCommitmentTracking.parse(raw), commitment = await state.commitment(agentId, id)
    const request = state.request('reopen', agentId, id, input), replay = await state.replay<FollowUpControlResult>(request)
    if (replay) return replay.result
    state.requireEnabled(input.policy.continuationMode)
    const prior = await state.control(commitment.value, input.expectedControlRevision)
    if (!prior || !prior.value.stoppedAt && !['completed', 'cancelled'].includes(commitment.value.status)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'only ended tracking can be reopened')
    }
    if (commitment.revision !== input.expectedCommitmentRevision) {
      throw new FollowUpError('STALE_REVISION', 'commitment changed', commitment.revision)
    }
    const scope = followUpScope(commitment.value)
    for (const category of ['executions', 'effects'] as const) {
      if ((await state.deps.store.collaborationQuery({ kind: 'commitment_activity', ...scope, category, limit: 1 })).length) {
        throw new FollowUpError('OUTCOME_UNKNOWN', 'reconcile outstanding execution before reopening')
      }
    }
    const links = await state.deps.store.collaborationQuery<CommitmentLink>({ kind: 'commitment_activity', ...scope, category: 'links', limit: 50 })
    const facts = await Promise.all(links.filter((row) => row.value.ownership === 'owned').map((row) => followUpTargetFact(state, row.value)))
    if (links.length === 50 || facts.some((fact) => fact.state !== 'settled')) {
      throw new FollowUpError('OUTCOME_UNKNOWN', 'owned targets must have authoritative stop proof before reopening')
    }
    const evidenceChecks = await state.userEvidence(commitment.value, input.userEvidence)
    const now = state.now()
    this.validatePolicy(input.policy, now)
    const policy = CollaborationPolicySchema.parse({ ...scope, ...input.policy, schemaVersion: 1,
      commitmentFingerprint: commitmentScopeFingerprint(commitment.value),
      id: agentStableId('policy', request.requestId), userEvidence: input.userEvidence, createdAt: now, updatedAt: now })
    const { stoppedAt: _stopped, ...old } = prior.value
    const control = CommitmentControlSchema.parse({ ...old, generation: old.generation + 1,
      authorizationEpoch: old.authorizationEpoch + 1, paused: false, trackingEnabled: true,
      continuationMode: policy.continuationMode, policyRef: policy.id, nextWakeAt: now, updatedAt: now, userEvidence: input.userEvidence })
    const { finishedAt: _finished, ...oldCommitment } = commitment.value
    const value = AgentCommitmentSchema.parse({ ...oldCommitment, status: 'open', acceptanceEvidence: [], updatedAt: now })
    const result = { control, controlRevision: prior.revision + 1 }
    await state.commit({ ...request, checks: [followUpCheck(commitment), followUpCheck(prior), ...evidenceChecks, ...links.map(followUpCheck),
      { kind: 'collaboration_policy', id: policy.id, expectedRevision: null }],
      puts: [followUpPut(prior, control), followUpPut(commitment, value),
        { kind: 'collaboration_policy', id: policy.id, roomId: control.sourceRoomId, value: policy }],
      events: [this.event(control.sourceRoomId, agentId, id, 'reopened')], result })
    return result
  }

  async continueExplicitly(agentId: string, id: string, raw: unknown): Promise<ContinueCommitmentResult> {
    const state = this.state
    await state.ready()
    state.requireEnabled()
    const command = ContinueCommitment.parse(raw), commitment = await state.commitment(agentId, id)
    if (commitment.value.sourceRoomId !== command.sourceRoomId || !state.deps.manualFollowUp) {
      throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'manual follow-up authority is unavailable for this commitment')
    }
    const result = await state.deps.manualFollowUp.stage(agentId, id, command)
    state.options.wake()
    return result
  }

  stop(agentId: string, id: string, input: unknown) { return stopFollowUp(this.state, agentId, id, input) }
  link(agentId: string, id: string, input: unknown) { return createFollowUpLink(this.state, agentId, id, input) }
  releaseLink(agentId: string, id: string, input: unknown) { return releaseFollowUpLink(this.state, agentId, id, input) }
  // Business questions are host-raised and user-answered; neither grants execution.
  openAttention(agentId: string, id: string, input: unknown) {
    return openBusinessAttention(this.state, agentId, id, input)
  }
  resolveAttention(agentId: string, id: string, attentionId: string, input: unknown) {
    return resolveBusinessAttention(this.state, agentId, id, attentionId, input)
  }
  /** Bounded keyset page of attention for one commitment, scoped to its own room. */
  async attentionList(agentId: string, id: string, raw: unknown) {
    const state = this.state
    await state.ready()
    const input = AttentionListQuery.parse(raw)
    const commitment = await state.commitment(agentId, id)
    return state.deps.store.collaborationQuery<CommitmentAttention>({ kind: 'attention',
      participantAgentId: commitment.value.participantAgentId,
      sourceRoomId: commitment.value.sourceRoomId, ...input })
  }

  private validatePolicy(policy: z.infer<typeof FollowUpPolicyInput>, now: string) {
    if (policy.expiresAt <= now) throw new FollowUpError('AUTHORIZATION_CHANGED', 'follow-up policy must expire in the future')
    if (policy.continuationMode === 'auto' && !policy.allowedActions.includes('continue')) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'automatic continuation requires explicit continue authorization')
    }
  }
  private event(roomId: string, participantAgentId: string, id: string, action: string) {
    return { roomId, kind: 'agent.commitment.updated', payload: { id, participantAgentId, action } }
  }
}
