import { isDeepStrictEqual } from 'node:util'
import { AgentCommitmentSchema, type AgentCommitment } from '../../contracts/agent-commitments.js'
import { CommitmentAttentionSchema, type CommitmentAttention } from '../../contracts/collaboration-attention.js'
import { CollaborationPolicySchema, type CollaborationPolicy } from '../../contracts/collaboration-followup.js'
import { OpenBusinessAttention, ResolveBusinessAttention,
  type BusinessAttentionResult } from '../../contracts/collaboration-followup-api.js'
import type { RoomStoreCommit, RoomStoredDocument } from '../../rooms/room-store.js'
import { agentStableId } from '../agent-identity-service.js'
import { FollowUpError, followUpCheck, followUpPolicyCurrent, followUpPut,
  followUpScope, type FollowUpState } from './state.js'

/** Bounded per commitment so attention can never become an unbounded inbox. */
const MAX_OPEN_ATTENTION = 50
const MAX_ACCEPTANCE_EVIDENCE = 30
const ended = (value: AgentCommitment): boolean => ['completed', 'cancelled'].includes(value.status)

/**
 * Raise a business question. This records a question; it never answers one and
 * never grants execution authority, so it is safe for the host to call on the
 * agent's behalf. Native approval/input gates are not representable here.
 */
export async function openBusinessAttention(state: FollowUpState, agentId: string, commitmentId: string,
  raw: unknown): Promise<BusinessAttentionResult> {
  await state.ready()
  const input = OpenBusinessAttention.parse(raw)
  const commitment = await state.commitment(agentId, commitmentId)
  const request = state.request('attention-open', agentId, commitmentId, input)
  const old = await state.replay<BusinessAttentionResult>(request)
  if (old) return old.result
  state.requireEnabled()
  const control = await state.control(commitment.value, input.expectedControlRevision)
  if (!control || control.value.stoppedAt || ended(commitment.value)) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'attention requires live tracking on an open commitment')
  }
  const policyRow = await state.deps.store.get<CollaborationPolicy>('collaboration_policy', control.value.policyRef)
  const policy = policyRow ? CollaborationPolicySchema.parse(policyRow.value) : null
  const now = state.now()
  // A question raised under an expired or superseded policy would look authorized
  // when it is not, so refuse instead of recording it optimistically.
  if (!policyRow || !followUpPolicyCurrent(commitment.value, control.value, policy, now)) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the follow-up policy is no longer current')
  }
  const scope = followUpScope(commitment.value)
  const open = await state.deps.store.collaborationQuery({ kind: 'commitment_activity', ...scope,
    category: 'attention', limit: MAX_OPEN_ATTENTION })
  if (open.length >= MAX_OPEN_ATTENTION) {
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'a commitment supports at most 50 open attention items')
  }
  const checks: NonNullable<RoomStoreCommit['checks']> = [
    followUpCheck(commitment), followUpCheck(control), followUpCheck(policyRow)
  ]
  if (input.kind === 'recovery' && input.attemptId) {
    const execution = await state.deps.store.get('commitment_execution', input.attemptId)
    const value = execution?.value as { commitmentId?: string; participantAgentId?: string; sourceRoomId?: string } | undefined
    if (!execution || value?.commitmentId !== commitmentId || value.participantAgentId !== scope.participantAgentId ||
      value.sourceRoomId !== scope.sourceRoomId) {
      throw new FollowUpError('OUTCOME_UNKNOWN', 'recovery attention refers to an unknown attempt')
    }
    checks.push(followUpCheck(execution))
  }
  const id = agentStableId('commitment-attention', commitmentId, input.clientRequestId)
  const base = { schemaVersion: 1 as const, id, ...scope, priority: input.priority, status: 'open' as const,
    title: input.title, summary: input.summary, choices: input.choices, evidenceRefs: input.evidenceRefs,
    createdAt: now, updatedAt: now }
  const attention = CommitmentAttentionSchema.parse(input.kind === 'decision'
    ? { ...base, kind: 'decision', question: input.question }
    : input.kind === 'acceptance' ? { ...base, kind: 'acceptance', artifactVersion: input.artifactVersion }
      : { ...base, kind: 'recovery', ...(input.attemptId ? { attemptId: input.attemptId } : {}) })
  const result: BusinessAttentionResult = { attentionId: id, attentionRevision: 0, status: 'open',
    controlRevision: control.revision }
  await state.commit({ ...request, checks: [...checks, { kind: 'commitment_attention', id, expectedRevision: null }],
    puts: [{ kind: 'commitment_attention', id, roomId: scope.sourceRoomId, value: attention }],
    events: [{ roomId: scope.sourceRoomId, kind: 'agent.commitment.updated',
      payload: { id: commitmentId, participantAgentId: agentId, action: 'attention', attentionId: id } }], result })
  return result
}

/** Answer one attention item. The answer names the exact revision the user saw. */
export async function resolveBusinessAttention(state: FollowUpState, agentId: string, commitmentId: string,
  attentionId: string, raw: unknown): Promise<BusinessAttentionResult> {
  await state.ready()
  const input = ResolveBusinessAttention.parse(raw)
  const commitment = await state.commitment(agentId, commitmentId)
  // The answer identity must include the attention and choice: a request key that
  // ignored them would replay one answer as if it settled every later question.
  const request = state.request('attention-resolve', agentId, commitmentId,
    { clientRequestId: input.clientRequestId, attentionId, choiceId: input.choiceId })
  const old = await state.replay<BusinessAttentionResult>(request)
  if (old) return old.result
  state.requireEnabled()
  const control = await state.control(commitment.value, input.expectedControlRevision)
  const row = await state.deps.store.get<CommitmentAttention>('commitment_attention', attentionId)
  if (!control || !row || row.value.commitmentId !== commitmentId ||
    row.value.participantAgentId !== agentId || row.value.sourceRoomId !== commitment.value.sourceRoomId) {
    throw new FollowUpError('STALE_ATTENTION', 'attention item not found')
  }
  const attention = CommitmentAttentionSchema.parse(row.value)
  // A protected gate keeps its single owner; duplicating it here would create a
  // second, weaker way to approve or answer real runtime work.
  if (attention.kind === 'approval' || attention.kind === 'input') {
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'a protected gate is resolved only by its owner')
  }
  if (row.revision !== input.expectedAttentionRevision) {
    throw new FollowUpError('STALE_ATTENTION', 'attention changed', row.revision)
  }
  if (attention.status !== 'open') {
    throw new FollowUpError('STALE_ATTENTION', 'attention is no longer open', row.revision)
  }
  const choice = attention.choices.find((candidate) => candidate.id === input.choiceId)
  if (!choice) throw new FollowUpError('STALE_ATTENTION', 'the selected choice is not declared by this attention')
  const now = state.now()
  const scope = followUpScope(commitment.value)
  if (attention.kind === 'acceptance') {
    // Restating the version is not enough: a stale tab can restate a version that
    // the artifact has already moved past, so the head is re-read here.
    if (!input.expectedArtifact || !isDeepStrictEqual(input.expectedArtifact, attention.artifactVersion)) {
      throw new FollowUpError('STALE_ATTENTION', 'acceptance must restate the exact artifact version')
    }
    if (ended(commitment.value)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'this commitment has already ended')
    }
    const head = state.deps.observedHead ? await state.deps.observedHead(attention.artifactVersion.resourceKey) : null
    if (!head) {
      throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'acceptance requires an authoritative artifact reader')
    }
    if (head.headSha !== attention.artifactVersion.headSha ||
      head.observationRevision !== attention.artifactVersion.observationRevision) {
      // The judged version is gone, so the answer is discarded rather than applied
      // to work the user never saw.
      await supersede(state, commitment.value, row, now)
      throw new FollowUpError('STALE_ATTENTION', 'the artifact changed before acceptance', row.revision)
    }
  }
  const resolution = { clientRequestId: input.clientRequestId, choiceId: input.choiceId, resolvedAt: now,
    surface: input.surface, ...(input.connectionId ? { connectionId: input.connectionId } : {}) }
  const next = CommitmentAttentionSchema.parse({ ...attention, status: 'resolved', updatedAt: now, resolution })
  const puts: NonNullable<RoomStoreCommit['puts']> = [followUpPut(row, next)]
  const checks: NonNullable<RoomStoreCommit['checks']> = [
    followUpCheck(commitment), followUpCheck(control), followUpCheck(row)
  ]
  let nextCommitment: AgentCommitment | undefined
  if (attention.kind === 'acceptance') {
    // Acceptance and the business effect it authorizes land in one transaction.
    nextCommitment = AgentCommitmentSchema.parse({ ...commitment.value, status: 'completed',
      updatedAt: now, finishedAt: now,
      acceptanceEvidence: [...commitment.value.acceptanceEvidence, { summary: acceptanceSummary(choice.label,
        attention.artifactVersion.headSha), reference: 'attention:' + attention.id }].slice(-MAX_ACCEPTANCE_EVIDENCE) })
    puts.push(followUpPut(commitment, nextCommitment))
  }
  const result: BusinessAttentionResult = { attentionId, attentionRevision: row.revision + 1,
    status: 'resolved', choiceId: input.choiceId, controlRevision: control.revision,
    ...(nextCommitment ? { commitmentRevision: commitment.revision + 1 } : {}) }
  await state.commit({ ...request, checks, puts,
    events: [{ roomId: scope.sourceRoomId, kind: 'agent.commitment.updated', payload: {
      id: commitmentId, participantAgentId: agentId, action: 'attention_resolved',
      attentionId, choiceId: input.choiceId, ...(nextCommitment ? { commitmentStatus: 'completed' } : {})
    } }], result })
  return result
}

/** Retire a question whose premise disappeared; it must never be silently answered. */
async function supersede(state: FollowUpState, commitment: AgentCommitment,
  row: RoomStoredDocument<CommitmentAttention>, now: string): Promise<void> {
  const value = CommitmentAttentionSchema.parse({ ...row.value, status: 'superseded', updatedAt: now })
  const request = state.request('attention-supersede', commitment.participantAgentId, commitment.id,
    { clientRequestId: 'supersede-' + row.value.id + '-' + row.revision })
  await state.commit({ ...request, checks: [followUpCheck(row)], puts: [followUpPut(row, value)],
    events: [{ roomId: commitment.sourceRoomId, kind: 'agent.commitment.updated', payload: {
      id: commitment.id, participantAgentId: commitment.participantAgentId, action: 'attention_superseded',
      attentionId: row.value.id } }], result: { superseded: row.value.id } })
}

function acceptanceSummary(label: string, headSha: string): string {
  return ('Accepted ' + label + ' at ' + headSha).slice(0, 4000)
}
