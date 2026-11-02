import type { AgentCommitment } from '../../contracts/agent-commitments.js'
import type { AgentHandoff } from '../../contracts/agent-handoffs.js'
import type { WorkbenchLink } from '../../contracts/workbench-links.js'
import { CommitmentLinkSchema, followUpTargetKey, type FollowUpLinkTarget,
  type CommitmentLink } from '../../contracts/collaboration-followup.js'
import type { CollaborationSourceGrant, CollaborationSource } from '../../contracts/collaboration-events.js'
import { CreateCommitmentLink, ReleaseCommitmentLink } from '../../contracts/collaboration-followup-api.js'
import type { RoomTaskExecution } from '../../rooms/room-runtime-types.js'
import { nativeFollowUpTargetFingerprint } from '../../domain/native-followup-target.js'
import type { RoomStoreCommit } from '../../rooms/room-store.js'
import { agentStableId } from '../agent-identity-service.js'
import { FollowUpError, followUpCheck, followUpPut, followUpScope, type FollowUpState } from './state.js'

export type LinkResult = { link: CommitmentLink; linkRevision: number; controlRevision: number }

/** Validate actual target provenance before acquiring ownership, never a model's label or taskId alias. */
export async function validateFollowUpTarget(state: FollowUpState, value: AgentCommitment,
  target: FollowUpLinkTarget, ownership: CommitmentLink['ownership']): Promise<{
    checks: NonNullable<RoomStoreCommit['checks']>; nativeTarget?: CommitmentLink['nativeTarget']
  }> {
  const checks: NonNullable<RoomStoreCommit['checks']> = []
  let nativeTarget: CommitmentLink['nativeTarget']
  const fail = (): never => { throw new FollowUpError('AUTHORIZATION_CHANGED', 'linked target is outside the commitment scope') }
  const thread = async (id: string) => {
    const metadata = await state.deps.threads.getMetadata(id)
    if (!metadata || !(
      metadata.roomContext?.participantAgentId === value.participantAgentId && metadata.roomContext.roomId === value.sourceRoomId ||
      metadata.workbenchOrigin?.agentId === value.participantAgentId && metadata.workbenchOrigin.roomId === value.sourceRoomId
    )) fail()
    if (ownership === 'owned') nativeTarget = { threadId: id, fingerprint: nativeFollowUpTargetFingerprint(metadata!) }
    return metadata
  }
  switch (target.kind) {
    case 'thread': await thread(target.threadId); break
    case 'workbench_link': {
      const row = await state.deps.store.get<WorkbenchLink>('workbench_link', target.linkId)
      if (!row || row.value.participantAgentId !== value.participantAgentId || row.value.roomId !== value.sourceRoomId ||
        row.value.threadId !== target.threadId) fail()
      await thread(target.threadId)
      checks.push(followUpCheck(row!))
      break
    }
    case 'room_task': {
      const row = await state.deps.store.get<RoomTaskExecution>('task', target.taskId)
      if (!row || row.value.task.roomId !== value.sourceRoomId ||
        row.value.task.memberSnapshot.participantAgentId !== value.participantAgentId) fail()
      await thread(row!.value.task.executionThreadId)
      checks.push(followUpCheck(row!))
      break
    }
    case 'handoff': {
      const row = await state.deps.store.get<AgentHandoff>('agent_handoff', target.handoffId)
      if (!row || ![row.value.senderAgentId, row.value.recipientAgentId].includes(value.participantAgentId) ||
        ![row.value.sourceRoomId, row.value.pairRoomId].includes(value.sourceRoomId)) fail()
      if (ownership === 'owned') throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'handoffs may only be referenced')
      checks.push(followUpCheck(row!))
      break
    }
    case 'artifact': {
      const row = await state.deps.store.get<{ participantAgentId: string; roomId: string }>('agent_artifact', target.artifactId)
      if (!row || row.value.participantAgentId !== value.participantAgentId || row.value.roomId !== value.sourceRoomId) fail()
      if (ownership === 'owned') throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'artifacts may only be referenced')
      checks.push(followUpCheck(row!))
      break
    }
    case 'github_pull_request': {
      const grants = await state.deps.store.collaborationQuery<CollaborationSourceGrant>({ kind: 'by_commitment',
        ...followUpScope(value), documentKind: 'collaboration_source_grant', limit: 100 })
      const grant = grants.find((item) => !item.value.revokedAt && item.value.expiresAt > state.now() &&
        followUpTargetKey(item.value.resource) === followUpTargetKey(target))
      if (!grant) throw new FollowUpError('SOURCE_GRANT_EXPIRED', 'a current explicit grant for this PR is required')
      const source = await state.deps.store.get<CollaborationSource>('collaboration_source', grant.value.sourceId)
      if (!source || source.value.authorizationBarrier !== 'open' || source.value.accountRef !== grant.value.accountRef ||
        source.value.authorizationEpoch !== grant.value.authorizationEpoch) {
        throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source authorization no longer matches this grant')
      }
      checks.push(followUpCheck(grant), followUpCheck(source))
      break
    }
    case 'ade': throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'external execution association requires a verified adapter')
  }
  return { checks, nativeTarget }
}

export async function createFollowUpLink(state: FollowUpState, agentId: string, id: string, raw: unknown): Promise<LinkResult> {
  await state.ready()
  const input = CreateCommitmentLink.parse(raw), commitment = await state.commitment(agentId, id)
  const request = state.request('link', agentId, id, input), old = await state.replay<LinkResult>(request)
  if (old) return old.result
  state.requireEnabled()
  const control = await state.control(commitment.value, input.expectedControlRevision)
  if (!control || control.value.stoppedAt || ['completed', 'cancelled'].includes(commitment.value.status)) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'reopen this commitment before changing its links')
  }
  const links = await state.deps.store.collaborationQuery({ kind: 'commitment_activity', ...followUpScope(commitment.value), category: 'links', limit: 30 })
  if (links.length === 30) throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'a commitment supports at most 30 active links')
  const checks: NonNullable<RoomStoreCommit['checks']> = await state.userEvidence(commitment.value, input.userEvidence)
  const validated = await validateFollowUpTarget(state, commitment.value, input.target, input.ownership)
  checks.push(...validated.checks)
  const now = state.now(), linkId = agentStableId('commitment-link', id, input.clientRequestId)
  const link = CommitmentLinkSchema.parse({ schemaVersion: 1, id: linkId, ...followUpScope(commitment.value),
    target: input.target, ownership: input.ownership, active: true, nativeTarget: validated.nativeTarget,
    userEvidence: input.userEvidence, createdAt: now, updatedAt: now })
  // Binding changes invalidate unadmitted decisions; a link never silently expands the prior authorization.
  const nextControl = { ...control.value, generation: control.value.generation + 1, updatedAt: now, nextWakeAt: now }
  const result: LinkResult = { link, linkRevision: 0, controlRevision: control.revision + 1 }
  await state.commit({ ...request, checks: [...checks, followUpCheck(commitment), followUpCheck(control),
    { kind: 'commitment_link', id: linkId, expectedRevision: null }],
  puts: [followUpPut(control, nextControl), { kind: 'commitment_link', id: linkId, roomId: commitment.value.sourceRoomId, value: link }],
  events: [{ roomId: commitment.value.sourceRoomId, kind: 'agent.commitment.updated',
    payload: { id, participantAgentId: agentId, action: 'link', linkId, controlRevision: result.controlRevision } }], result })
  return result
}

export async function releaseFollowUpLink(state: FollowUpState, agentId: string, id: string, raw: unknown): Promise<LinkResult> {
  await state.ready()
  const input = ReleaseCommitmentLink.parse(raw), commitment = await state.commitment(agentId, id)
  const request = state.request('unlink', agentId, id, input), old = await state.replay<LinkResult>(request)
  if (old) return old.result
  const control = await state.control(commitment.value, input.expectedControlRevision)
  const row = await state.deps.store.get<CommitmentLink>('commitment_link', input.linkId)
  if (!control || !row || row.value.commitmentId !== id || row.value.participantAgentId !== agentId ||
    row.value.sourceRoomId !== commitment.value.sourceRoomId) throw new Error('commitment link not found')
  if (row.revision !== input.expectedLinkRevision) throw new FollowUpError('STALE_REVISION', 'commitment link changed', row.revision)
  if (row.value.ownership === 'owned') {
    // Release is not proof that a physical writer stopped. The bridge must verify that separately.
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'stop and reconcile owned work before releasing ownership')
  }
  const now = state.now(), link = { ...row.value, active: false, updatedAt: now }
  const nextControl = { ...control.value, generation: control.value.generation + 1, updatedAt: now, nextWakeAt: now }
  const result: LinkResult = { link, linkRevision: row.revision + 1, controlRevision: control.revision + 1 }
  await state.commit({ ...request, checks: [followUpCheck(commitment), followUpCheck(control), followUpCheck(row)],
    puts: [followUpPut(control, nextControl), followUpPut(row, link)],
    events: [{ roomId: commitment.value.sourceRoomId, kind: 'agent.commitment.updated',
      payload: { id, participantAgentId: agentId, action: 'unlink', linkId: row.id, controlRevision: result.controlRevision } }], result })
  return result
}
