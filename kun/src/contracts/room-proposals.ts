import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { RoomIdSchema } from './rooms.js'

const Timestamp = z.string().datetime({ offset: true })

/**
 * Member-drafted structural action waiting for explicit user confirmation.
 * Proposals are drafts only; they never execute on their own.
 */
export const RoomProposalPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin_agreement'), body: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('execution_request'), goal: z.string().trim().min(1).max(8000),
    memberIds: z.array(RoomIdSchema).max(8).default([]), repositoryId: RoomIdSchema.optional() }).strict(),
  z.object({ kind: z.literal('add_member'), participantAgentId: ParticipantAgentId,
    roleNotes: z.string().max(2000).default('') }).strict(),
  z.object({ kind: z.literal('create_agent'), name: z.string().trim().min(1).max(80),
    title: z.string().max(160).default(''), instructions: z.string().max(8000).default('') }).strict()
])
export type RoomProposalPayload = z.infer<typeof RoomProposalPayloadSchema>

export const RoomProposalResultRefSchema = z.object({
  kind: z.enum(['rule', 'message', 'room', 'agent']), id: z.string().min(1).max(256)
}).strict()
export type RoomProposalResultRef = z.infer<typeof RoomProposalResultRefSchema>

export const RoomProposalSchema = z.object({
  schemaVersion: z.literal(1), proposalId: RoomIdSchema, roomId: RoomIdSchema, messageId: RoomIdSchema,
  payload: RoomProposalPayloadSchema, rationale: z.string().trim().min(1).max(1000),
  status: z.enum(['open', 'committed', 'dismissed', 'withdrawn']),
  authorMemberId: RoomIdSchema, authorAgentId: ParticipantAgentId.optional(),
  originRunId: RoomIdSchema, rootRequestId: RoomIdSchema.optional(),
  resultRef: RoomProposalResultRefSchema.optional(),
  withdrawnReason: z.enum(['run_cancelled', 'topic_stopped']).optional(),
  createdAt: Timestamp, resolvedAt: Timestamp.optional()
}).strict()
export type RoomProposal = z.infer<typeof RoomProposalSchema>
export type RoomProposalEntry = RoomProposal & { revision: number }

export const ResolveRoomProposalSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(['committed', 'dismissed']), resultRef: RoomProposalResultRefSchema.optional()
}).strict()
export type ResolveRoomProposal = z.infer<typeof ResolveRoomProposalSchema>
