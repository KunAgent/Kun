import { z } from 'zod'
import {
  CommitmentRecordFields, FollowUpId, FollowUpRevision, FollowUpTime,
  FollowUpArtifactVersionSchema, FollowUpEvidenceRefSchema
} from './collaboration-followup.js'

const Fields = {
  ...CommitmentRecordFields, priority: z.number().int().min(0).max(100),
  status: z.enum(['open', 'resolved', 'superseded', 'expired']),
  title: z.string().min(1).max(200), summary: z.string().max(2000)
}
const GateReference = z.object({
  threadId: FollowUpId, turnId: FollowUpId, requestId: FollowUpId, revision: FollowUpRevision
}).strict()
const Resolution = z.object({
  clientRequestId: FollowUpId, choiceId: FollowUpId, resolvedAt: FollowUpTime,
  surface: z.enum(['gui', 'remote']), connectionId: FollowUpId.optional(),
  effectId: FollowUpId.optional()
}).strict()
const BusinessFields = {
  ...Fields,
  choices: z.array(z.object({ id: FollowUpId, label: z.string().min(1).max(200) }).strict()).min(1).max(10),
  evidenceRefs: z.array(FollowUpEvidenceRefSchema).max(50), resolution: Resolution.optional()
}

/** Gate references have no shadow answer/approval field. Only their real owner may resolve them. */
export const CommitmentAttentionSchema = z.discriminatedUnion('kind', [
  z.object({ ...Fields, kind: z.literal('approval'), sourceRef: GateReference }).strict(),
  z.object({ ...Fields, kind: z.literal('input'), sourceRef: GateReference }).strict(),
  z.object({ ...BusinessFields, kind: z.literal('decision'), question: z.string().min(1).max(4000) }).strict(),
  z.object({ ...BusinessFields, kind: z.literal('acceptance'), artifactVersion: FollowUpArtifactVersionSchema }).strict(),
  z.object({ ...BusinessFields, kind: z.literal('recovery'), attemptId: FollowUpId.optional() }).strict()
]).superRefine((value, context) => {
  if (value.kind === 'approval' || value.kind === 'input') return
  if ((value.status === 'resolved') !== Boolean(value.resolution)) {
    context.addIssue({ code: 'custom', message: 'business resolution and status must agree', path: ['resolution'] })
  }
  if (value.resolution && !value.choices.some((choice) => choice.id === value.resolution?.choiceId)) {
    context.addIssue({ code: 'custom', message: 'resolution must select a declared choice', path: ['resolution', 'choiceId'] })
  }
})
export type CommitmentAttention = z.infer<typeof CommitmentAttentionSchema>
