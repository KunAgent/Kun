import type { AgentCommitment } from '../../contracts/agent-commitments.js'
import { CollaborationPolicySchema, type CommitmentLink, type CommitmentSubscription } from '../../contracts/collaboration-followup.js'
import type { CommitmentExecution, CommitmentEffect } from '../../contracts/collaboration-effects.js'
import type { CommitmentAttention } from '../../contracts/collaboration-attention.js'
import type { RoomStoredDocument } from '../../rooms/room-store.js'
import type { RoomTaskExecution } from '../../rooms/room-runtime-types.js'
import type { WorkbenchLink } from '../../contracts/workbench-links.js'
import { roomFingerprint } from '../../rooms/room-service.js'
import { followUpScope, followUpPolicyCurrent, type FollowUpState } from './state.js'

export type FollowUpStage = 'stopping' | 'stopped' | 'recovery_required' | 'needs_approval' | 'needs_input' |
  'needs_decision' | 'needs_acceptance' | 'running' | 'queued' | 'awaiting_external' | 'ready' | 'completed'
type TargetFact = { linkId: string; revision: string; state: 'running' | 'queued' | 'settled' | 'unknown' }

/** Metadata only: never hydrate chat history to guess execution or completion. */
export async function followUpTargetFact(state: FollowUpState, link: CommitmentLink): Promise<TargetFact> {
  const target = link.target
  let threadId: string | undefined, revision = '', settled = false
  if (target.kind === 'thread') threadId = target.threadId
  else if (target.kind === 'workbench_link') {
    const row = await state.deps.store.get<WorkbenchLink>('workbench_link', target.linkId)
    if (!row || row.value.threadId !== target.threadId || row.value.participantAgentId !== link.participantAgentId ||
      row.value.roomId !== link.sourceRoomId) return { linkId: link.id, revision: 'missing', state: 'unknown' }
    revision = String(row.revision)
    threadId = row.value.threadId
    settled = ['completed', 'failed', 'cancelled', 'dismissed', 'ended'].includes(row.value.status)
  } else if (target.kind === 'room_task') {
    const row = await state.deps.store.get<RoomTaskExecution>('task', target.taskId)
    if (!row || row.value.task.roomId !== link.sourceRoomId ||
      row.value.task.memberSnapshot.participantAgentId !== link.participantAgentId) {
      return { linkId: link.id, revision: 'missing', state: 'unknown' }
    }
    revision = String(row.revision)
    threadId = row.value.task.executionThreadId
    settled = ['completed', 'failed', 'cancelled'].includes(row.value.task.status)
  } else if (target.kind === 'ade') return { linkId: link.id, revision: 'unsupported', state: 'unknown' }
  else return { linkId: link.id, revision: 'resource', state: 'settled' }
  const metadata = threadId ? await state.deps.threads.getMetadata(threadId) : null
  if (!metadata || !(metadata.roomContext?.participantAgentId === link.participantAgentId && metadata.roomContext.roomId === link.sourceRoomId ||
    metadata.workbenchOrigin?.agentId === link.participantAgentId && metadata.workbenchOrigin.roomId === link.sourceRoomId)) {
    return { linkId: link.id, revision, state: 'unknown' }
  }
  const active = metadata.turns.find((turn) => ['running', 'queued'].includes(turn.status))
  revision += ':' + metadata.updatedAt + ':' + (active?.id ?? '')
  if (active) return { linkId: link.id, revision, state: active.status === 'running' ? 'running' : 'queued' }
  // A CLI or managed child may still own the workspace after a turn's text finished.
  if (state.deps.backgroundExecutionActive?.(threadId!)) return { linkId: link.id, revision, state: 'running' }
  const last = metadata.turns.at(-1)
  const terminal = settled || Boolean(last && ['completed', 'failed', 'aborted'].includes(last.status)) ||
    target.kind === 'thread' && !last
  const proven = terminal && await state.deps.proveStopped?.(threadId!, last?.id)
  return { linkId: link.id, revision, state: proven ? 'settled' : 'unknown' }
}

export async function projectFollowUp(state: FollowUpState, commitment: RoomStoredDocument<AgentCommitment>) {
  const scope = followUpScope(commitment.value), limit = 50
  const query = <T>(category: 'links' | 'subscriptions' | 'executions' | 'effects' | 'attention') =>
    state.deps.store.collaborationQuery<T>({ kind: 'commitment_activity', ...scope, category, limit })
  const [control, links, subscriptions, executions, effects, attentionRows] = await Promise.all([
    state.control(commitment.value), query<CommitmentLink>('links'), query<CommitmentSubscription>('subscriptions'),
    query<CommitmentExecution>('executions'), query<CommitmentEffect>('effects'), query<CommitmentAttention>('attention')
  ])
  const policy = control ? await state.deps.store.get('collaboration_policy', control.value.policyRef) : null
  const attention = attentionRows.filter(({ value }) => {
    if (value.kind !== 'approval' && value.kind !== 'input') return true
    const actual = (value.kind === 'approval' ? state.deps.approvals : state.deps.inputs).get(value.sourceRef.requestId)
    return actual?.threadId === value.sourceRef.threadId && actual.turnId === value.sourceRef.turnId
  })
  const facts = await Promise.all(links.filter((row) => row.value.ownership === 'owned').map((row) => followUpTargetFact(state, row.value)))
  const truncated = [links, subscriptions, executions, effects, attentionRows].some((page) => page.length === limit)
  const uncertain = executions.some((row) => row.value.phase === 'reconciling') ||
    effects.some((row) => row.value.status === 'outcome_unknown') || facts.some((fact) => fact.state === 'unknown')
  const running = facts.some((fact) => fact.state === 'running')
  const queued = facts.some((fact) => fact.state === 'queued') || executions.length > 0 || effects.some((row) => row.value.status === 'pending')
  let stage: FollowUpStage
  if (control?.value.stoppedAt || commitment.value.status === 'cancelled') {
    stage = uncertain || running || queued || truncated ? 'stopping' : 'stopped'
  } else if (uncertain || commitment.value.status === 'completed' && (running || queued)) stage = 'recovery_required'
  else if (attention.some((row) => row.value.kind === 'recovery')) stage = 'recovery_required'
  else if (attention.some((row) => row.value.kind === 'approval')) stage = 'needs_approval'
  else if (attention.some((row) => row.value.kind === 'input')) stage = 'needs_input'
  else if (attention.some((row) => row.value.kind === 'decision')) stage = 'needs_decision'
  else if (attention.some((row) => row.value.kind === 'acceptance')) stage = 'needs_acceptance'
  else if (running) stage = 'running'
  else if (queued) stage = 'queued'
  else if (commitment.value.status === 'completed') stage = 'completed'
  else stage = subscriptions.length && control?.value.trackingEnabled ? 'awaiting_external' : 'ready'
  const ended = Boolean(control?.value.stoppedAt || ['completed', 'cancelled'].includes(commitment.value.status))
  const features = state.options.features(), asOf = state.now()
  const resumable = Boolean(features.enabled && control?.value.trackingEnabled && control.value.paused && !ended &&
    (control.value.continuationMode !== 'auto' || features.auto) &&
    followUpPolicyCurrent(commitment.value, control.value, policy ? CollaborationPolicySchema.parse(policy.value) : null, asOf))
  const revisions = [commitment, ...(control ? [control] : []), ...(policy ? [policy] : []), ...links, ...subscriptions, ...executions, ...effects, ...attentionRows]
    .map((row) => [row.kind, row.id, row.revision])
  return {
    commitment: { ...commitment.value, revision: commitment.revision },
    control: control?.value ?? null, controlRevision: control?.revision ?? null,
    projectionRevision: roomFingerprint({ revisions, facts, features, resumable, attention: attention.map((row) => row.id) }),
    asOf, stage, incomplete: truncated,
    links: links.map((row) => ({ ...row.value, revision: row.revision })),
    attention: attention.map((row) => ({ ...row.value, revision: row.revision })),
    executions: executions.map((row) => ({ ...row.value, revision: row.revision })),
    nextCheckAt: control?.value.trackingEnabled ? subscriptions.reduce<string | null>((next, row) =>
      row.value.nextPollAt && (!next || row.value.nextPollAt < next) ? row.value.nextPollAt : next, control.value.nextWakeAt) : null,
    actions: {
      enable: features.enabled && !ended && !control?.value.trackingEnabled,
      pause: Boolean(control?.value.trackingEnabled && !control.value.paused && !ended),
      resume: resumable,
      disable: Boolean(control?.value.trackingEnabled && !ended), stop: Boolean(control && stage !== 'stopped'),
      reopen: Boolean(features.enabled && ended && !uncertain && !running && !queued && !truncated)
    }
  }
}
