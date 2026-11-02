import { z } from 'zod'
import { FollowUpId, FollowUpRevision, FollowUpTime, FollowUpUserEvidenceSchema,
  ContinuationModeSchema, NewWorkModeSchema, CollaborationPolicySchema, FollowUpLinkTargetSchema,
  FollowUpArtifactVersionSchema, FollowUpEvidenceRefSchema, FollowUpPullRequestSchema,
  FollowUpReadKindSchema } from './collaboration-followup.js'

export const FollowUpMutation = z.object({
  clientRequestId: FollowUpId, expectedControlRevision: FollowUpRevision
}).strict()
export const FollowUpPolicyInput = z.object({
  continuationMode: ContinuationModeSchema.default('manual'),
  newWorkMode: NewWorkModeSchema.default('off'),
  allowedActions: CollaborationPolicySchema.shape.allowedActions,
  limits: CollaborationPolicySchema.shape.limits, expiresAt: FollowUpTime
}).strict()
export const EnableCommitmentTracking = z.object({
  clientRequestId: FollowUpId, expectedControlRevision: FollowUpRevision.nullable(),
  policy: FollowUpPolicyInput, userEvidence: FollowUpUserEvidenceSchema
}).strict()
export const UpdateCommitmentTracking = FollowUpMutation.extend({
  policy: FollowUpPolicyInput, userEvidence: FollowUpUserEvidenceSchema
}).strict()
export const ReopenCommitmentTracking = UpdateCommitmentTracking.extend({
  expectedCommitmentRevision: FollowUpRevision
}).strict()
export const StopCommitmentTracking = z.discriminatedUnion('scope', [
  FollowUpMutation.extend({ scope: z.literal('commitment'), targetId: FollowUpId }).strict(),
  FollowUpMutation.extend({ scope: z.literal('target'), targetId: FollowUpId, expectedTargetRevision: FollowUpRevision }).strict(),
  FollowUpMutation.extend({ scope: z.literal('occurrence'), targetId: FollowUpId, expectedTargetRevision: FollowUpRevision }).strict()
])
export const CreateCommitmentLink = FollowUpMutation.extend({
  target: FollowUpLinkTargetSchema, ownership: z.enum(['owned', 'referenced']),
  userEvidence: FollowUpUserEvidenceSchema
}).strict()
export const ReleaseCommitmentLink = FollowUpMutation.extend({
  linkId: FollowUpId, expectedLinkRevision: FollowUpRevision
}).strict()
/** An explicit user request; model or external event content is not action authority. */
export const ContinueCommitment = FollowUpMutation.extend({
  sourceRoomId: FollowUpId, linkId: FollowUpId, expectedLinkRevision: FollowUpRevision,
  expectedPolicyRevision: FollowUpRevision, userEvidence: FollowUpUserEvidenceSchema
}).strict()
export type ContinueCommitment = z.infer<typeof ContinueCommitment>
export const ContinueCommitmentResult = z.object({
  requestId: FollowUpId, effectId: FollowUpId, attemptId: FollowUpId, status: z.literal('pending')
}).strict()
export type ContinueCommitmentResult = z.infer<typeof ContinueCommitmentResult>
export const ManualFollowUpClaim = z.object({
  effectId: FollowUpId, attemptId: FollowUpId, token: FollowUpRevision, expiresAt: z.string().datetime()
}).strict()
export type ManualFollowUpClaim = z.infer<typeof ManualFollowUpClaim>
export const ManualFollowUpDispatch = z.object({ shouldDispatch: z.boolean(), dispatchId: FollowUpId }).strict()
export type ManualFollowUpDispatch = z.infer<typeof ManualFollowUpDispatch>
export const CommitmentTrackingActionSchema = z.enum(['pause', 'resume', 'disable'])
export type CommitmentTrackingAction = z.infer<typeof CommitmentTrackingActionSchema>

/** Grants are account-level; a repository never carries its own credential. */
export const FollowUpModelShareSchema = z.object({
  allowed: z.boolean(), threadId: FollowUpId,
  providers: z.array(z.object({ providerId: FollowUpId, model: FollowUpId }).strict()).max(20)
}).strict().refine((value) => !value.allowed || value.providers.length > 0,
  'model sharing requires explicit provider/model scope')
export const CreateSourceGrant = FollowUpMutation.extend({
  sourceId: FollowUpId, resource: FollowUpPullRequestSchema,
  allowedReads: z.array(FollowUpReadKindSchema).min(1).max(6),
  modelShare: FollowUpModelShareSchema, continuationAllowed: z.boolean(),
  expiresAt: FollowUpTime, userEvidence: FollowUpUserEvidenceSchema
}).strict().refine((value) => new Set(value.allowedReads).size === value.allowedReads.length,
  'allowed reads must be unique')
export type CreateSourceGrant = z.infer<typeof CreateSourceGrant>
/** Revocation is immediate: continuations must re-check the grant on every use. */
export const RevokeSourceGrant = FollowUpMutation.extend({
  grantId: FollowUpId, expectedGrantRevision: FollowUpRevision
}).strict()
export type RevokeSourceGrant = z.infer<typeof RevokeSourceGrant>
export const SourceGrantResult = z.object({
  grantId: FollowUpId, grantRevision: FollowUpRevision, controlRevision: FollowUpRevision,
  revokedAt: FollowUpTime.optional()
}).strict()
export type SourceGrantResult = z.infer<typeof SourceGrantResult>
/** The version a client negotiates. It names this surface, not a promise of remote support. */
export const FOLLOW_UP_API_VERSION = 'collaboration-followup-v1'
export const FollowUpCapability = z.object({
  apiVersion: z.literal(FOLLOW_UP_API_VERSION),
  features: z.object({ tracking: z.boolean(), manualContinuation: z.boolean(),
    attention: z.boolean(), sourceGrants: z.boolean(), githubReader: z.boolean() }).strict(),
  /** Only modes that can actually execute are advertised. */
  modes: z.object({ continuation: z.array(ContinuationModeSchema).min(1),
    newWork: z.array(NewWorkModeSchema).min(1) }).strict()
}).strict()
export type FollowUpCapability = z.infer<typeof FollowUpCapability>
/** Longest a user consent may stand before it must be renewed in person. */
export const SOURCE_GRANT_MAX_TTL_MS = 24 * 60 * 60 * 1000

export const FollowUpErrorCodeSchema = z.enum([
  'STALE_REVISION', 'STALE_ATTENTION', 'SOURCE_GRANT_EXPIRED', 'AUTHORIZATION_CHANGED',
  'OUTCOME_UNKNOWN', 'CAPABILITY_UNAVAILABLE', 'BUDGET_EXHAUSTED'
])
export type FollowUpErrorCode = z.infer<typeof FollowUpErrorCodeSchema>

/**
 * Business attention is raised by the host, never by model prose. Native approval
 * and input gates are owned by their real resolvers and cannot be minted here.
 */
export const BusinessAttentionKindSchema = z.enum(['decision', 'acceptance', 'recovery'])
export const OpenBusinessAttention = FollowUpMutation.extend({
  expectedControlRevision: FollowUpRevision,
  kind: BusinessAttentionKindSchema,
  priority: z.number().int().min(0).max(100).default(50),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(2000).default(''),
  choices: z.array(z.object({ id: FollowUpId, label: z.string().trim().min(1).max(200) }).strict())
    .min(1).max(10),
  question: z.string().trim().min(1).max(4000).optional(),
  evidenceRefs: z.array(FollowUpEvidenceRefSchema).max(50).default([]),
  artifactVersion: FollowUpArtifactVersionSchema.optional(),
  attemptId: FollowUpId.optional()
}).strict().superRefine((value, context) => {
  if (value.kind === 'decision' && !value.question) {
    context.addIssue({ code: 'custom', message: 'a decision needs its question', path: ['question'] })
  }
  if (value.kind === 'acceptance' && !value.artifactVersion) {
    context.addIssue({ code: 'custom', message: 'acceptance needs the artifact version it judges', path: ['artifactVersion'] })
  }
  if (value.kind !== 'acceptance' && value.artifactVersion) {
    context.addIssue({ code: 'custom', message: 'only acceptance is version bound', path: ['artifactVersion'] })
  }
  if (value.kind !== 'recovery' && value.attemptId) {
    context.addIssue({ code: 'custom', message: 'only recovery refers to an attempt', path: ['attemptId'] })
  }
  const ids = value.choices.map((choice) => choice.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'choice ids must be unique', path: ['choices'] })
  }
})
export type OpenBusinessAttention = z.infer<typeof OpenBusinessAttention>

/** Resolution is version bound: an answer always names the attention revision it saw. */
export const ResolveBusinessAttention = FollowUpMutation.extend({
  expectedControlRevision: FollowUpRevision,
  expectedAttentionRevision: FollowUpRevision,
  choiceId: FollowUpId,
  surface: z.enum(['gui', 'remote']),
  connectionId: FollowUpId.optional(),
  /** Acceptance must restate the observed artifact version; the host re-reads it. */
  expectedArtifact: FollowUpArtifactVersionSchema.optional()
}).strict()
export type ResolveBusinessAttention = z.infer<typeof ResolveBusinessAttention>
export const BusinessAttentionResult = z.object({
  attentionId: FollowUpId, attentionRevision: FollowUpRevision,
  status: z.enum(['open', 'resolved', 'superseded']),
  choiceId: FollowUpId.optional(), commitmentRevision: FollowUpRevision.optional(),
  controlRevision: FollowUpRevision
}).strict()
export type BusinessAttentionResult = z.infer<typeof BusinessAttentionResult>

/** Keyset cursor over (priority, updatedAt, id), matching the attention index. */
export const AttentionCursor = z.object({
  priority: z.number().int().min(0).max(100), at: FollowUpTime, id: FollowUpId
}).strict()
export const AttentionListQuery = z.object({
  status: z.enum(['open', 'resolved', 'superseded', 'expired']).default('open'),
  cursor: AttentionCursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict()
export type AttentionListQuery = z.infer<typeof AttentionListQuery>

/** Read-only tracking projection: what the user sees, never an execution grant. */
export const FollowUpTrackingQuery = z.object({}).strict()
