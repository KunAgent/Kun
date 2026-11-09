import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'

export const FollowUpId = z.string().min(1).max(256)
export const FollowUpRevision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
// All ordering cursors use UTC timestamps, not lexically incomparable offsets.
export const FollowUpTime = z.string().datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
export const FollowUpFingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const ContinuationModeSchema = z.enum(['manual', 'observe', 'auto'])
export const NewWorkModeSchema = z.enum(['off', 'observe'])

export const FollowUpUserEvidenceSchema = z.object({
  kind: z.literal('user_message'), sourceRoomId: FollowUpId, sourceMessageId: FollowUpId,
  messageRevision: FollowUpRevision
}).strict()

export const FollowUpEvidenceRefSchema = z.object({
  kind: z.enum(['event', 'artifact', 'turn', 'test', 'review']), id: FollowUpId,
  revision: FollowUpRevision.optional()
}).strict()

export const FollowUpArtifactVersionSchema = z.object({
  resourceKey: FollowUpId, headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  // A -> B -> A invalidates evidence even when the current SHA equals an old SHA.
  observationRevision: FollowUpRevision
}).strict()

export const FollowUpExecutionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room_task'), taskId: FollowUpId }).strict(),
  z.object({ kind: z.literal('workbench_link'), linkId: FollowUpId, threadId: FollowUpId }).strict(),
  z.object({ kind: z.literal('thread'), threadId: FollowUpId }).strict(),
  z.object({ kind: z.literal('ade'), intentId: FollowUpId, workerId: FollowUpId.optional() }).strict()
])
export type FollowUpExecutionTarget = z.infer<typeof FollowUpExecutionTargetSchema>

export const FollowUpPullRequestSchema = z.object({
  kind: z.literal('github_pull_request'), repositoryId: FollowUpId,
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/),
  repository: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict()

export const FollowUpLinkTargetSchema = z.union([
  FollowUpExecutionTargetSchema,
  z.object({ kind: z.literal('handoff'), handoffId: FollowUpId }).strict(),
  z.object({ kind: z.literal('artifact'), artifactId: FollowUpId }).strict(),
  FollowUpPullRequestSchema
])
export type FollowUpLinkTarget = z.infer<typeof FollowUpLinkTargetSchema>

/** A Workbench link and its thread must not acquire independent owners. */
export function followUpTargetKey(target: FollowUpLinkTarget): string {
  switch (target.kind) {
    case 'thread': case 'workbench_link': return JSON.stringify(['thread', target.threadId])
    case 'room_task': return JSON.stringify(['room_task', target.taskId])
    case 'ade': return JSON.stringify(['ade', target.intentId])
    case 'handoff': return JSON.stringify(['handoff', target.handoffId])
    case 'artifact': return JSON.stringify(['artifact', target.artifactId])
    case 'github_pull_request': return JSON.stringify(['github_pull_request', target.repositoryId, target.number])
  }
}

export const FollowUpRecordFields = {
  schemaVersion: z.literal(1), id: FollowUpId, createdAt: FollowUpTime, updatedAt: FollowUpTime
}
export const CommitmentRecordFields = {
  ...FollowUpRecordFields, commitmentId: FollowUpId, participantAgentId: ParticipantAgentId,
  sourceRoomId: FollowUpId
}

export const FollowUpBudgetSchema = z.object({
  windowStart: FollowUpTime, windowEnd: FollowUpTime,
  reserved: FollowUpRevision, consumed: FollowUpRevision, totalConsumed: FollowUpRevision,
  // Needed for minimumIntervalMs; absent on rows written before budgets were enforced.
  lastAttemptAt: FollowUpTime.optional()
}).strict().refine((value) => value.windowEnd > value.windowStart, 'budget window must advance')

export const CommitmentControlSchema = z.object({
  ...CommitmentRecordFields, generation: FollowUpRevision,
  continuationMode: ContinuationModeSchema, paused: z.boolean(), trackingEnabled: z.boolean(),
  policyRef: FollowUpId, authorizationEpoch: FollowUpRevision,
  budget: FollowUpBudgetSchema, nextWakeAt: FollowUpTime.nullable(), stoppedAt: FollowUpTime.optional(),
  userEvidence: FollowUpUserEvidenceSchema
}).strict().refine((value) => value.id === value.commitmentId, 'one control per commitment')
  .refine((value) => !value.stoppedAt || !value.trackingEnabled, 'stopped tracking cannot be enabled')
export type CommitmentControl = z.infer<typeof CommitmentControlSchema>

export const CommitmentLinkSchema = z.object({
  ...CommitmentRecordFields, target: FollowUpLinkTargetSchema,
  ownership: z.enum(['owned', 'referenced']), active: z.boolean(), stopRequestedAt: FollowUpTime.optional(),
  // Captured by the host when linking; absence means legacy/unqualified, not unlimited authority.
  nativeTarget: z.object({ threadId: FollowUpId, fingerprint: FollowUpFingerprint }).strict().optional(),
  userEvidence: FollowUpUserEvidenceSchema
}).strict().refine((value) => !value.nativeTarget || value.ownership === 'owned' &&
  (value.target.kind === 'room_task' ||
    (value.target.kind === 'thread' || value.target.kind === 'workbench_link') && value.target.threadId === value.nativeTarget.threadId),
  'native target authority must belong to its owned execution thread')
export type CommitmentLink = z.infer<typeof CommitmentLinkSchema>

export const FollowUpReadKindSchema = z.enum(['head', 'checks', 'reviews', 'review_comments', 'comments', 'state'])
export const FollowUpEventKindSchema = z.enum([
  'head_changed', 'check_changed', 'review_changed', 'comment_changed', 'state_changed',
  'user_continue', 'reminder', 'execution_receipt'
])

export const FollowUpEndpointCheckpointSchema = z.object({
  endpoint: FollowUpReadKindSchema, etag: z.string().max(512).optional(),
  cursor: z.string().max(2048).optional(), completedAt: FollowUpTime.optional()
}).strict()
export type FollowUpReadKind = z.infer<typeof FollowUpReadKindSchema>
export type FollowUpEndpointCheckpoint = z.infer<typeof FollowUpEndpointCheckpointSchema>
export const CommitmentSubscriptionSchema = z.object({
  ...CommitmentRecordFields, sourceId: FollowUpId, grantRef: FollowUpId,
  resource: FollowUpPullRequestSchema, enabled: z.boolean(),
  eventKinds: z.array(FollowUpEventKindSchema).min(1).max(9),
  checkpoint: z.object({
    baselineComplete: z.boolean(), endpoints: z.array(FollowUpEndpointCheckpointSchema).max(6),
    observedHead: FollowUpArtifactVersionSchema.optional()
  }).strict(),
  nextPollAt: FollowUpTime.nullable()
}).strict()
export type CommitmentSubscription = z.infer<typeof CommitmentSubscriptionSchema>

export const CollaborationPolicySchema = z.object({
  ...CommitmentRecordFields, commitmentFingerprint: FollowUpFingerprint,
  allowedActions: z.array(z.enum(['continue', 'read_source', 'notify'])).max(3),
  continuationMode: ContinuationModeSchema, newWorkMode: NewWorkModeSchema,
  limits: z.object({
    attemptsPerDay: z.number().int().min(0).max(100), attemptsTotal: z.number().int().min(0).max(1000),
    minimumIntervalMs: z.number().int().min(1000).max(86_400_000),
    softTokenBudget: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  }).strict(),
  expiresAt: FollowUpTime, userEvidence: FollowUpUserEvidenceSchema
}).strict()
export type CollaborationPolicy = z.infer<typeof CollaborationPolicySchema>

export const FollowUpEnvelopeSchema = z.object({
  schemaVersion: z.literal(1), commitmentId: FollowUpId, sourceRoomId: FollowUpId,
  requestId: FollowUpId, attemptId: FollowUpId, effectId: FollowUpId,
  eventIds: z.array(FollowUpId).max(50), generation: FollowUpRevision,
  policyVersion: FollowUpRevision, authorizationEpoch: FollowUpRevision,
  source: z.object({
    sourceId: FollowUpId, sourceGeneration: FollowUpRevision, credentialEpoch: FollowUpRevision,
    authorizationEpoch: FollowUpRevision, grantRef: FollowUpId, grantRevision: FollowUpRevision
  }).strict().optional(),
  target: FollowUpExecutionTargetSchema, evidenceRefs: z.array(FollowUpEvidenceRefSchema).max(50),
  expectedArtifact: FollowUpArtifactVersionSchema.optional()
}).strict()
export type FollowUpEnvelope = z.infer<typeof FollowUpEnvelopeSchema>
