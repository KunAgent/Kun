import type { AgentCommitment } from '../../contracts/agent-commitments.js'
import { CommitmentControlSchema, type CommitmentControl } from '../../contracts/collaboration-followup.js'
import { CollaborationSourceGrantSchema, type CollaborationSource,
  type CollaborationSourceGrant } from '../../contracts/collaboration-events.js'
import { CreateSourceGrant, RevokeSourceGrant, SOURCE_GRANT_MAX_TTL_MS,
  type SourceGrantResult } from '../../contracts/collaboration-followup-api.js'
import type { RoomStoreCommit } from '../../rooms/room-store.js'
import { agentStableId } from '../agent-identity-service.js'
import { FollowUpError, followUpCheck, followUpPut, followUpScope, type FollowUpState } from './state.js'

const MAX_ACTIVE_GRANTS = 20

/** Consent must be live at the moment it is used, not merely at the moment it was granted. */
export function assertGrantLive(grant: CollaborationSourceGrant, now: string): void {
  if (grant.revokedAt) throw new FollowUpError('SOURCE_GRANT_EXPIRED', 'this source grant was revoked')
  if (grant.expiresAt <= now) throw new FollowUpError('SOURCE_GRANT_EXPIRED', 'this source grant has expired')
}

/** A source that needs authorization again cannot back a new consent. */
function requireReadySource(source: CollaborationSource): void {
  if (source.authorizationBarrier !== 'open') {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source authorization is blocked')
  }
  if (source.health === 'authorization_required' || source.health === 'disconnected') {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'the source needs attention before it can be read')
  }
}

const resourceKeyOf = (grant: Pick<CollaborationSourceGrant, 'resource'>) =>
  `${grant.resource.owner}/${grant.resource.repository}#${grant.resource.number}`

export async function createSourceGrant(state: FollowUpState, agentId: string, id: string,
  raw: unknown): Promise<SourceGrantResult> {
  await state.ready()
  const input = CreateSourceGrant.parse(raw), commitment = await state.commitment(agentId, id)
  const request = state.request('grant', agentId, id, input), old = await state.replay<SourceGrantResult>(request)
  if (old) return old.result
  // A grant is an external read consent; the follow-up feature alone is not enough to mint one.
  if (!state.options.features().github) {
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'external source tracking is not enabled')
  }
  const control = await state.control(commitment.value, input.expectedControlRevision)
  if (!control || control.value.stoppedAt || ['completed', 'cancelled'].includes(commitment.value.status)) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'reopen this commitment before granting a source')
  }
  const source = await state.deps.store.get<CollaborationSource>('collaboration_source', input.sourceId)
  if (!source) throw new FollowUpError('AUTHORIZATION_CHANGED', 'unknown collaboration source')
  const sourceValue = source.value
  requireReadySource(sourceValue)
  const now = state.now(), expiresAt = Date.parse(input.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(now)) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'a grant must expire in the future')
  }
  if (expiresAt - Date.parse(now) > SOURCE_GRANT_MAX_TTL_MS) {
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'a grant cannot outlive its renewal window')
  }
  // Sharing with a model happens in a real thread of this room, on explicit providers only.
  const share = input.modelShare
  if (share.allowed) {
    const thread = await state.deps.threads.getMetadata(share.threadId)
    const owned = thread?.roomContext?.participantAgentId === commitment.value.participantAgentId &&
      thread.roomContext.roomId === commitment.value.sourceRoomId ||
      thread?.workbenchOrigin?.agentId === commitment.value.participantAgentId &&
      thread.workbenchOrigin.roomId === commitment.value.sourceRoomId
    if (!owned) throw new FollowUpError('AUTHORIZATION_CHANGED', 'model sharing must name a thread of this commitment')
  }
  const live = await state.deps.store.collaborationQuery<CollaborationSourceGrant>({ kind: 'by_commitment',
    ...followUpScope(commitment.value), documentKind: 'collaboration_source_grant', limit: 100 })
  const active = live.filter((row) => !row.value.revokedAt && row.value.expiresAt > now)
  const superseded = active.filter((row) => resourceKeyOf(row.value) === resourceKeyOf({ resource: input.resource }))
  if (active.length - superseded.length >= MAX_ACTIVE_GRANTS) {
    throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'this commitment has too many live source grants')
  }
  // One live consent per resource: a new grant replaces the old one instead of stacking.
  const supersededRows = superseded.map((row) => ({ row,
    value: CollaborationSourceGrantSchema.parse({ ...row.value, revokedAt: now, updatedAt: now }) }))
  const checks: NonNullable<RoomStoreCommit['checks']> = [...await state.userEvidence(commitment.value, input.userEvidence),
    followUpCheck(commitment), followUpCheck(control), followUpCheck(source),
    ...supersededRows.map(({ row }) => followUpCheck(row)),
    { kind: 'collaboration_source_grant', id: agentStableId('source-grant', id, input.clientRequestId),
      expectedRevision: null }]
  const grantId = agentStableId('source-grant', id, input.clientRequestId)
  const grant = CollaborationSourceGrantSchema.parse({ schemaVersion: 1, id: grantId, createdAt: now, updatedAt: now,
    sourceId: sourceValue.id, accountRef: sourceValue.accountRef, ...followUpScope(commitment.value),
    resource: input.resource, allowedReads: input.allowedReads, modelShare: share,
    continuationAllowed: input.continuationAllowed, expiresAt: input.expiresAt,
    authorizationEpoch: sourceValue.authorizationEpoch, userEvidence: input.userEvidence })
  const nextControl = CommitmentControlSchema.parse({ ...control.value, generation: control.value.generation + 1,
    updatedAt: now, nextWakeAt: now })
  const result: SourceGrantResult = { grantId, grantRevision: 0, controlRevision: control.revision + 1 }
  await state.commit({ ...request, checks,
    puts: [followUpPut(control, nextControl), { kind: 'collaboration_source_grant', id: grantId,
      roomId: commitment.value.sourceRoomId, value: grant },
    ...supersededRows.map(({ row, value }) => followUpPut(row, value))],
    events: [{ roomId: commitment.value.sourceRoomId, kind: 'agent.commitment.updated',
      payload: { id, participantAgentId: agentId, action: 'grant', grantId } }], result })
  return result
}

export async function revokeSourceGrant(state: FollowUpState, agentId: string, id: string,
  raw: unknown): Promise<SourceGrantResult> {
  await state.ready()
  const input = RevokeSourceGrant.parse(raw), commitment = await state.commitment(agentId, id)
  const request = state.request('revoke-grant', agentId, id, input)
  const old = await state.replay<SourceGrantResult>(request)
  if (old) return old.result
  const control = await state.control(commitment.value, input.expectedControlRevision)
  const row = await state.deps.store.get<CollaborationSourceGrant>('collaboration_source_grant', input.grantId)
  if (!control || !row || row.value.commitmentId !== id ||
    row.value.participantAgentId !== agentId || row.value.sourceRoomId !== commitment.value.sourceRoomId) {
    throw new FollowUpError('AUTHORIZATION_CHANGED', 'source grant not found for this commitment')
  }
  if (row.revision !== input.expectedGrantRevision) {
    throw new FollowUpError('STALE_REVISION', 'source grant changed', row.revision)
  }
  // Revoking twice is not an error, but it must not look like a fresh revoke.
  if (row.value.revokedAt) {
    return { grantId: row.value.id, grantRevision: row.revision, controlRevision: control.revision,
      revokedAt: row.value.revokedAt }
  }
  const now = state.now()
  const grant = CollaborationSourceGrantSchema.parse({ ...row.value, revokedAt: now, updatedAt: now })
  const nextControl = CommitmentControlSchema.parse({ ...control.value, generation: control.value.generation + 1,
    updatedAt: now, nextWakeAt: now })
  const result: SourceGrantResult = { grantId: grant.id, grantRevision: row.revision + 1,
    controlRevision: control.revision + 1, revokedAt: now }
  await state.commit({ ...request, checks: [followUpCheck(commitment), followUpCheck(control), followUpCheck(row)],
    puts: [followUpPut(control, nextControl), followUpPut(row, grant)],
    events: [{ roomId: commitment.value.sourceRoomId, kind: 'agent.commitment.updated',
      payload: { id, participantAgentId: agentId, action: 'revoke_grant', grantId: grant.id } }], result })
  return result
}

/** The one live grant a reader may use for a resource, or a typed refusal. */
export async function liveSourceGrant(state: FollowUpState, value: AgentCommitment,
  resourceKey: string): Promise<CollaborationSourceGrant> {
  const rows = await state.deps.store.collaborationQuery<CollaborationSourceGrant>({ kind: 'by_commitment',
    ...followUpScope(value), documentKind: 'collaboration_source_grant', limit: 100 })
  const now = state.now()
  const live = rows.map((row) => row.value)
    .filter((grant) => !grant.revokedAt && grant.expiresAt > now && resourceKeyOf(grant) === resourceKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const grant = live[0]
  if (!grant) throw new FollowUpError('SOURCE_GRANT_EXPIRED', 'no live grant covers this resource')
  assertGrantLive(grant, now)
  return grant
}

export type { CommitmentControl }
