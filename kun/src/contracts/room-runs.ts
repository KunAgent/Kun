import { z } from 'zod'
import { UsageSnapshotSchema } from './usage.js'

const Id = z.string().min(1).max(256)
export const RoomRunPhaseSchema = z.enum(['coordination', 'discussion', 'execution', 'review', 'integration', 'triage', 'memory'])
export const RoomRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'recovery_required'])
export const RoomRunOutcomeSchema = z.enum(['published', 'skipped', 'stale', 'duplicate', 'respond', 'failed', 'cancelled'])
export const RoomRunRecordSchema = z.object({
  participantAgentId: z.string().min(1).max(128).optional(),
  handoffId: z.string().min(1).max(128).optional(),
  id: Id, roomId: Id, rootRequestId: Id.optional(), requestId: Id.optional(), taskId: Id.optional(),
  memberId: Id, memberLabel: z.string().max(120), phase: RoomRunPhaseSchema,
  attempt: z.number().int().positive(), previousRunId: Id.optional(), clientRequestId: Id,
  triggerMessageId: Id.optional(), triggerMessageRevision: z.number().int().nonnegative().optional(),
  triggerSource: z.object({ kind: z.enum(['message', 'invitation', 'task']), id: Id, version: z.number().int().nonnegative() }).strict().optional(),
  generation: z.number().int().nonnegative().optional(),
  threadId: Id.optional(), turnId: Id.optional(), contextId: Id.optional(), admissionAttempted: z.boolean().optional(),
  input: z.string().max(64000), attachmentIds: z.array(Id).default([]),
  status: RoomRunStatusSchema, outcome: RoomRunOutcomeSchema.optional(),
  reason: z.string().max(4000).optional(), error: z.string().max(4000).optional(),
  publishedMessageId: Id.optional(), integrationId: Id.optional(), integrationStage: z.string().max(80).optional(),
  createdAt: z.string(), updatedAt: z.string(), startedAt: z.string().optional(), endedAt: z.string().optional(),
  model: z.string().optional(), usage: UsageSnapshotSchema.optional(),
  usageStatus: z.enum(['complete', 'partial', 'unavailable']).optional(), elapsedMs: z.number().nonnegative().optional(),
  // Captured before admission; these allow exact turn usage to exclude earlier conversation usage.
  usageSinceSeq: z.number().int().nonnegative().optional(), usageBaseline: UsageSnapshotSchema.optional()
}).strict()
export type RoomRunRecord = z.infer<typeof RoomRunRecordSchema>
export type RoomRunPhase = RoomRunRecord['phase']
export type RoomRunStatus = RoomRunRecord['status']
