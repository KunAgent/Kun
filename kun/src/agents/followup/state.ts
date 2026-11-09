import type { z } from 'zod'
import { AgentCommitmentSchema, type AgentCommitment } from '../../contracts/agent-commitments.js'
import { CommitmentControlSchema, FollowUpUserEvidenceSchema, type CommitmentControl, type CollaborationPolicy } from '../../contracts/collaboration-followup.js'
import type { FollowUpErrorCode } from '../../contracts/collaboration-followup-api.js'
import type { Room, RoomMessage } from '../../contracts/rooms.js'
import type { RoomRuntimeDeps } from '../../rooms/room-runtime-types.js'
import { RoomStoreConflictError, type RoomStoreCommit, type RoomStoredDocument } from '../../rooms/room-store.js'
import { roomFingerprint } from '../../rooms/room-service.js'
import { agentStableId } from '../agent-identity-service.js'

export class FollowUpError extends RoomStoreConflictError {
  constructor(readonly code: FollowUpErrorCode, message: string, revision: number | null = null) {
    super(message, revision)
  }
}
export type FollowUpFeatures = { enabled: boolean; auto: boolean; github: boolean }
export type FollowUpOptions = { features: () => FollowUpFeatures; wake: () => void; now?: () => string }
export type FollowUpScope = { commitmentId: string; sourceRoomId: string; participantAgentId: string }
export const followUpScope = (value: AgentCommitment): FollowUpScope => ({
  commitmentId: value.id, sourceRoomId: value.sourceRoomId, participantAgentId: value.participantAgentId
})
export const commitmentScopeFingerprint = (value: AgentCommitment) => roomFingerprint({
  objective: value.objective, acceptance: value.acceptance, deadline: value.deadline, links: value.links
})
export function followUpPolicyCurrent(commitment: AgentCommitment, control: CommitmentControl,
  policy: CollaborationPolicy | null, now: string): boolean {
  return Boolean(policy && policy.id === control.policyRef && policy.commitmentId === commitment.id &&
    policy.participantAgentId === commitment.participantAgentId && policy.sourceRoomId === commitment.sourceRoomId &&
    policy.continuationMode === control.continuationMode && policy.expiresAt > now &&
    policy.commitmentFingerprint === commitmentScopeFingerprint(commitment))
}
export const followUpCheck = (row: Pick<RoomStoredDocument, 'kind' | 'id' | 'revision'>) => ({
  kind: row.kind, id: row.id, expectedRevision: row.revision
})
export const followUpPut = <T>(row: RoomStoredDocument<T>, value: T) => ({
  kind: row.kind, id: row.id, roomId: row.roomId, value
})

/** Shared only by host services. This object is not a model tool or an execution authority. */
export class FollowUpState {
  constructor(readonly deps: RoomRuntimeDeps, readonly options: FollowUpOptions) {}
  now(): string { return this.options.now?.() ?? new Date().toISOString() }
  async ready(): Promise<void> {
    await this.deps.waitForOwnership?.()
    await this.deps.assertOwnership()
  }
  requireEnabled(mode?: string): void {
    const features = this.options.features()
    if (!features.enabled || mode === 'auto' && !features.auto) {
      throw new FollowUpError('CAPABILITY_UNAVAILABLE', 'this follow-up capability is not enabled')
    }
  }
  async commitment(agentId: string, id: string): Promise<RoomStoredDocument<AgentCommitment>> {
    const row = await this.deps.store.get<AgentCommitment>('agent_commitment', id)
    if (!row || row.value.participantAgentId !== agentId) throw new Error('agent commitment not found')
    return { ...row, value: AgentCommitmentSchema.parse(row.value) }
  }
  async control(value: AgentCommitment, expectedRevision?: number | null): Promise<RoomStoredDocument<CommitmentControl> | null> {
    const row = await this.deps.store.get<CommitmentControl>('commitment_control', value.id)
    if (row && (row.value.participantAgentId !== value.participantAgentId || row.value.sourceRoomId !== value.sourceRoomId)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'commitment tracking scope changed')
    }
    if (expectedRevision !== undefined && (row?.revision ?? null) !== expectedRevision) {
      throw new FollowUpError('STALE_REVISION', 'commitment tracking changed', row?.revision ?? null)
    }
    return row ? { ...row, value: CommitmentControlSchema.parse(row.value) } : null
  }
  async userEvidence(value: AgentCommitment, raw: z.infer<typeof FollowUpUserEvidenceSchema>) {
    const evidence = FollowUpUserEvidenceSchema.parse(raw)
    if (evidence.sourceRoomId !== value.sourceRoomId) throw new FollowUpError('AUTHORIZATION_CHANGED', 'authorization belongs to another room')
    const room = await this.deps.store.get<Room>('room', evidence.sourceRoomId)
    if (!room || room.value.archivedAt || !room.value.members.some((member) =>
      member.participantAgentId === value.participantAgentId && member.enabled && !member.removedAt)) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'commitment source room is unavailable')
    }
    const message = await this.deps.store.get<RoomMessage>('message', evidence.sourceMessageId)
    if (!message || message.roomId !== evidence.sourceRoomId || message.value.authorKind !== 'user' ||
      message.value.status !== 'final' || message.value.bodyRevision !== evidence.messageRevision) {
      throw new FollowUpError('AUTHORIZATION_CHANGED', 'follow-up requires the current actual user message')
    }
    return [followUpCheck(room), followUpCheck(message)]
  }
  request(action: string, agentId: string, id: string, input: unknown) {
    const request = input as { clientRequestId: string }
    return { requestId: agentStableId('followup', action, agentId, id, request.clientRequestId),
      fingerprint: roomFingerprint({ action, agentId, id, input }) }
  }
  async replay<T>(request: { requestId: string; fingerprint: string }): Promise<{ result: T } | null> {
    const old = await this.deps.store.getRequest(request.requestId)
    if (!old) return null
    if (old.fingerprint !== request.fingerprint) throw new FollowUpError('STALE_REVISION', 'follow-up request content changed')
    return { result: old.result as T }
  }
  async commit(input: RoomStoreCommit): Promise<void> {
    await this.deps.assertOwnership()
    await this.deps.store.commit(input)
    this.options.wake()
  }
}
