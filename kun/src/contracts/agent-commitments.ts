import { z } from 'zod'

const Id = z.string().min(1).max(256)
const Time = z.string().datetime({ offset: true })
export const AgentCommitmentStatus = z.enum(['open', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled'])
export const AgentCommitmentLink = z.object({
  kind: z.enum(['thread', 'goal', 'handoff', 'task', 'workbench_link']), id: Id
}).strict()
export const AgentCommitmentFields = z.object({
  objective: z.string().trim().min(1).max(8000),
  deadline: Time.nullable().default(null),
  nextCheckAt: Time.nullable().default(null),
  waitingOn: z.string().max(2000).nullable().default(null),
  acceptance: z.string().trim().min(1).max(4000),
  links: z.array(AgentCommitmentLink).max(30).default([])
}).strict()
export const CreateAgentCommitment = AgentCommitmentFields.extend({
  clientRequestId: Id, sourceRoomId: Id, sourceMessageId: Id
}).strict()
export const UpdateAgentCommitment = z.object({
  objective: AgentCommitmentFields.shape.objective.optional(),
  deadline: AgentCommitmentFields.shape.deadline.unwrap().optional(),
  nextCheckAt: AgentCommitmentFields.shape.nextCheckAt.unwrap().optional(),
  waitingOn: AgentCommitmentFields.shape.waitingOn.unwrap().optional(),
  acceptance: AgentCommitmentFields.shape.acceptance.optional(),
  links: AgentCommitmentFields.shape.links.unwrap().optional(),
  clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
  status: AgentCommitmentStatus.optional(),
  acceptanceEvidence: z.array(z.object({ summary: z.string().trim().min(1).max(4000),
    reference: z.string().min(1).max(4096).optional() }).strict()).max(30).optional(),
  results: z.array(z.object({ summary: z.string().trim().min(1).max(4000),
    artifactId: Id.optional(), version: z.number().int().positive().optional() }).strict()).max(30).optional()
}).strict()
export const AgentCommitmentSchema = AgentCommitmentFields.extend({
  schemaVersion: z.literal(1), id: Id, participantAgentId: Id,
  sourceRoomId: Id, sourceMessageId: Id,
  /** Evidence of the user's request, never a grant of executable permissions. */
  authorization: z.object({ kind: z.literal('user_message'), messageRevision: z.number().int().nonnegative(),
    text: z.string().max(16000), capturedAt: Time }).strict(),
  status: AgentCommitmentStatus,
  acceptanceEvidence: UpdateAgentCommitment.shape.acceptanceEvidence.unwrap().default([]),
  results: UpdateAgentCommitment.shape.results.unwrap().default([]),
  createdAt: Time, updatedAt: Time, finishedAt: Time.optional()
}).strict()
export type AgentCommitment = z.infer<typeof AgentCommitmentSchema>
export type AgentCommitmentEntry = AgentCommitment & { revision: number }
export const AgentCommitmentQuery = z.object({
  status: AgentCommitmentStatus.optional(), search: z.string().trim().max(200).optional(),
  cursor: z.coerce.number().int().nonnegative().optional(), limit: z.coerce.number().int().min(1).max(100).default(30)
}).strict()
