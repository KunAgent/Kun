import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { RoomMemberSchema, RoomRepositorySchema } from './rooms.js'

const Id = ParticipantAgentId
export const AgentHandoffInput = z.object({
  clientRequestId: Id, sourceRoomId: Id, sourceRootRequestId: Id,
  senderAgentId: Id, recipientAgentId: Id, body: z.string().trim().min(1).max(8000),
  sourceMessageIds: z.array(Id).max(8).default([]), parentHandoffId: Id.optional()
}).strict()
export const AgentHandoffSchema = z.object({
  schemaVersion: z.literal(1), id: Id, participantAgentId: Id,
  phase: z.enum(['handoff', 'settled']).default('handoff'),
  sourceRoomId: Id, sourceRootRequestId: Id, sourceRequestId: Id, sourceRunId: Id.optional(),
  sourceTaskId: Id.optional(), sourceTaskActorAgentId: Id.optional(),
  senderAgentId: Id, senderMemberId: Id, recipientAgentId: Id, pairRoomId: Id,
  parentHandoffId: Id.optional(), chainId: Id,
  sourceGeneration: z.number().int().nonnegative().optional(),
  body: z.string().max(8000),
  sources: z.array(z.object({ id: Id, version: z.number().int().nonnegative(),
    body: z.string().max(1600), author: z.string().max(120), attachmentIds: z.array(z.string()).max(20) }).strict()).max(8),
  allowedAgentIds: z.array(Id).max(100),
  designatedAgentIds: z.array(Id).max(100).default([]),
  recipientSnapshot: RoomMemberSchema, repositories: z.array(RoomRepositorySchema).max(100),
  workspace: z.string().optional(), repositoryId: Id.optional(), attachmentIds: z.array(z.string()).max(20),
  status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'stale', 'budget_exhausted', 'recovery_required']),
  inputChildIds: z.array(Id).max(32).default([]),
  attempt: z.number().int().nonnegative().default(0),
  threadId: Id, turnId: Id.optional(), clientTurnId: Id,
  admissionAttempted: z.boolean().optional(), runId: Id.optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), endedAt: z.string().datetime().optional(),
  result: z.string().max(64000).optional(), resultMessageId: Id.optional(), sourceNoticeId: Id.optional(),
  error: z.string().max(4000).optional(), waitingReason: z.string().max(200).optional()
}).strict()
export type AgentHandoff = z.infer<typeof AgentHandoffSchema>
