import type { CommitmentControl, CommitmentLink, CommitmentSubscription, FollowUpEnvelope, FollowUpLinkTarget } from '../contracts/collaboration-followup.js'
import type { CommitmentEffect, CommitmentExecution } from '../contracts/collaboration-effects.js'
import type { CollaborationEvent } from '../contracts/collaboration-events.js'

export const time = '2026-11-01T10:00:00.000Z'
export const later = '2026-11-01T11:00:00.000Z'
export const scope = { commitmentId: 'commitment', participantAgentId: 'agent', sourceRoomId: 'room' }
export const userEvidence = { kind: 'user_message' as const, sourceRoomId: 'room', sourceMessageId: 'message', messageRevision: 0 }
export function base(id: string) { return { schemaVersion: 1 as const, id, createdAt: time, updatedAt: time } }
export const resource = { kind: 'github_pull_request' as const, repositoryId: '123', owner: 'owner', repository: 'repo', number: 7 }

export function control(): CommitmentControl {
  return { ...base('commitment'), ...scope, generation: 0, continuationMode: 'manual', paused: false,
    trackingEnabled: true, policyRef: 'policy', authorizationEpoch: 0, nextWakeAt: null, userEvidence,
    budget: { windowStart: time, windowEnd: later, reserved: 0, consumed: 0, totalConsumed: 0 } }
}
export function link(id = 'link', target: FollowUpLinkTarget = { kind: 'thread', threadId: 'thread' }): CommitmentLink {
  return { ...base(id), ...scope, target, ownership: 'owned', active: true, userEvidence }
}
export function envelope(id = 'effect'): FollowUpEnvelope {
  return { schemaVersion: 1, commitmentId: scope.commitmentId, sourceRoomId: scope.sourceRoomId,
    effectId: id, attemptId: id + ':attempt', requestId: id + ':request', eventIds: [],
    generation: 0, policyVersion: 0, authorizationEpoch: 0,
    target: { kind: 'thread', threadId: 'thread' }, evidenceRefs: [] }
}
export function effect(id = 'effect'): CommitmentEffect {
  const payload = envelope(id)
  return { ...base(id), ...scope, effectId: id, kind: 'continue', requestId: payload.requestId,
    admissionKey: id + ':admission', fingerprint: 'a'.repeat(64), envelope: payload,
    status: 'pending', retryAt: time, nextReconcileAt: null }
}
export function execution(id = 'effect'): CommitmentExecution {
  const payload = envelope(id)
  return { ...base(payload.attemptId), ...scope, attemptId: payload.attemptId, effectId: id,
    requestId: payload.requestId, envelope: payload, fingerprint: 'a'.repeat(64),
    phase: 'reserved', nextReconcileAt: null }
}
export function subscription(id = 'subscription'): CommitmentSubscription {
  return { ...base(id), ...scope, sourceId: 'source', grantRef: 'grant', resource, enabled: true,
    eventKinds: ['head_changed'], checkpoint: { baselineComplete: false, endpoints: [] }, nextPollAt: time }
}
export function event(id = 'event'): CollaborationEvent {
  return { ...base(id), sourceId: 'source', nativeKey: 'head:1', objectRevision: '1', kind: 'head_changed',
    resourceKey: 'repo:123:pr:7', occurredAt: time, receivedAt: time, summary: 'Head changed', contextOnly: false,
    provenance: { kind: 'github', sourceGeneration: 0, credentialEpoch: 0, authorizationEpoch: 0,
      resource, endpoint: 'head' } }
}
