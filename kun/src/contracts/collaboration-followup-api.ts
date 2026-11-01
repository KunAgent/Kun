import { z } from 'zod'
import { FollowUpId, FollowUpRevision, FollowUpTime, FollowUpUserEvidenceSchema,
  ContinuationModeSchema, NewWorkModeSchema, CollaborationPolicySchema, FollowUpLinkTargetSchema } from './collaboration-followup.js'

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
export const CommitmentTrackingActionSchema = z.enum(['pause', 'resume', 'disable'])
export type CommitmentTrackingAction = z.infer<typeof CommitmentTrackingActionSchema>

export const FollowUpErrorCodeSchema = z.enum([
  'STALE_REVISION', 'STALE_ATTENTION', 'SOURCE_GRANT_EXPIRED', 'AUTHORIZATION_CHANGED',
  'OUTCOME_UNKNOWN', 'CAPABILITY_UNAVAILABLE', 'BUDGET_EXHAUSTED'
])
export type FollowUpErrorCode = z.infer<typeof FollowUpErrorCodeSchema>
