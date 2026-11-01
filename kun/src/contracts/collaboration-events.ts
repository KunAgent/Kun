import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import {
  FollowUpRecordFields, FollowUpId, FollowUpRevision, FollowUpTime, FollowUpPullRequestSchema,
  FollowUpReadKindSchema, FollowUpUserEvidenceSchema, FollowUpEvidenceRefSchema, FollowUpEventKindSchema
} from './collaboration-followup.js'

export const CollaborationSourceSchema = z.object({
  ...FollowUpRecordFields, provider: z.literal('github'), accountRef: FollowUpId,
  credentialRef: FollowUpId, sourceGeneration: FollowUpRevision,
  credentialEpoch: FollowUpRevision, authorizationEpoch: FollowUpRevision,
  authorizationBarrier: z.enum(['open', 'blocked']),
  health: z.enum(['ready', 'backoff', 'authorization_required', 'disconnected']),
  retryAt: FollowUpTime.nullable(), lastError: z.string().max(500).optional()
}).strict().refine((value) => value.authorizationBarrier !== 'open' || value.health !== 'disconnected',
  'disconnected sources must block authorization')
export type CollaborationSource = z.infer<typeof CollaborationSourceSchema>

export const CollaborationSourceGrantSchema = z.object({
  ...FollowUpRecordFields, sourceId: FollowUpId, accountRef: FollowUpId,
  participantAgentId: ParticipantAgentId, sourceRoomId: FollowUpId, commitmentId: FollowUpId,
  resource: FollowUpPullRequestSchema, allowedReads: z.array(FollowUpReadKindSchema).min(1).max(6),
  modelShare: z.object({
    allowed: z.boolean(), threadId: FollowUpId,
    providers: z.array(z.object({ providerId: FollowUpId, model: FollowUpId }).strict()).max(20)
  }).strict(),
  // Read consent and model sharing never confer tool/workspace execution authority.
  continuationAllowed: z.boolean(), expiresAt: FollowUpTime, revokedAt: FollowUpTime.optional(),
  authorizationEpoch: FollowUpRevision, userEvidence: FollowUpUserEvidenceSchema
}).strict().refine((value) => !value.modelShare.allowed || value.modelShare.providers.length > 0,
  'model sharing requires explicit provider/model scope')
export type CollaborationSourceGrant = z.infer<typeof CollaborationSourceGrantSchema>

export const CollaborationEventSchema = z.object({
  ...FollowUpRecordFields, sourceId: FollowUpId, nativeKey: z.string().min(1).max(1024),
  objectRevision: z.string().min(1).max(512), kind: FollowUpEventKindSchema,
  resourceKey: FollowUpId, actor: z.object({ id: FollowUpId, login: z.string().max(100) }).strict().optional(),
  occurredAt: FollowUpTime, receivedAt: FollowUpTime,
  provenance: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('github'), sourceGeneration: FollowUpRevision,
      credentialEpoch: FollowUpRevision, authorizationEpoch: FollowUpRevision,
      resource: FollowUpPullRequestSchema, endpoint: FollowUpReadKindSchema }).strict(),
    z.object({ kind: z.literal('user_message'), evidence: FollowUpUserEvidenceSchema }).strict(),
    z.object({ kind: z.literal('reminder'), reminderId: FollowUpId, occurrenceId: FollowUpId }).strict(),
    z.object({ kind: z.literal('execution_receipt'), attemptId: FollowUpId, requestId: FollowUpId }).strict()
  ]),
  // Provider bodies live outside metadata; their contents cannot set host provenance or permissions.
  payloadRef: FollowUpId.optional(), summary: z.string().max(1000),
  contextOnly: z.boolean()
}).strict()
export type CollaborationEvent = z.infer<typeof CollaborationEventSchema>

export const CommitmentEventBindingSchema = z.object({
  ...FollowUpRecordFields, eventId: FollowUpId,
  participantAgentId: ParticipantAgentId, sourceRoomId: FollowUpId,
  commitmentId: FollowUpId.optional(), candidateGrantRef: FollowUpId.optional(),
  purpose: z.enum(['continuation', 'evidence', 'candidate']), decisionVersion: FollowUpRevision,
  inputVersions: z.object({
    controlRevision: FollowUpRevision.optional(), policyRevision: FollowUpRevision.optional(),
    grantRevision: FollowUpRevision.optional(), observationRevision: FollowUpRevision.optional()
  }).strict(),
  disposition: z.enum(['pending', 'ignored', 'observed', 'needs_decision', 'ready', 'superseded']),
  consumption: z.enum(['unconsumed', 'reserved', 'consumed', 'cancelled']),
  effectId: FollowUpId.optional(), reason: z.string().max(2000),
  evidenceRefs: z.array(FollowUpEvidenceRefSchema).max(50)
}).strict().refine((value) => Boolean(value.commitmentId) !== Boolean(value.candidateGrantRef),
  'binding requires one commitment or authorized candidate scope')
  .refine((value) => value.purpose === 'candidate' ? Boolean(value.candidateGrantRef) : Boolean(value.commitmentId),
    'candidate bindings cannot create a commitment')
  .refine((value) => !['reserved', 'consumed'].includes(value.consumption) || Boolean(value.effectId),
    'consumption requires the consuming effect identity')
export type CommitmentEventBinding = z.infer<typeof CommitmentEventBindingSchema>
