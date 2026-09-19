import { z } from 'zod'
import { RoomIdSchema, RoomMemberSchema } from './rooms.js'

export const RoomTaskStatusSchema = z.enum([
  'queued', 'waiting_dependency', 'running', 'needs_input', 'needs_approval',
  'recovery_required', 'stopping', 'awaiting_acceptance', 'completed', 'failed', 'cancelled'
])
export type RoomTaskStatus = z.infer<typeof RoomTaskStatusSchema>
export const RoomVerificationStatusSchema = z.enum(['not_run', 'passed', 'partial', 'failed'])
export const RoomApplicationStatusSchema = z.enum([
  'not_applied', 'preparing', 'applying', 'applied', 'conflict', 'failed', 'recovery_required'
])

export const RoomTaskSchema = z.object({
  id: RoomIdSchema,
  roomId: RoomIdSchema,
  requestId: RoomIdSchema,
  sourceMessageId: RoomIdSchema,
  title: z.string().trim().min(1).max(240),
  ownerMemberId: RoomIdSchema,
  memberSnapshot: RoomMemberSchema,
  repositoryId: RoomIdSchema,
  workspaceId: RoomIdSchema,
  executionThreadId: z.string().min(1).max(256),
  status: RoomTaskStatusSchema,
  stage: z.enum(['analyze', 'develop', 'test', 'review', 'fix']),
  requirementRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  latestDeliveryId: RoomIdSchema.optional(),
  acceptedDeliveryId: RoomIdSchema.optional(),
  latestProgress: z.string().max(2000).default(''),
  verificationStatus: RoomVerificationStatusSchema.default('not_run'),
  applicationStatus: RoomApplicationStatusSchema.default('not_applied'),
  updatedAt: z.string().datetime({ offset: true })
}).strict().refine((task) => task.ownerMemberId === task.memberSnapshot.id,
  'task owner must match frozen member snapshot')
export type RoomTask = z.infer<typeof RoomTaskSchema>

export const RoomTaskAttemptSchema = z.object({
  id: RoomIdSchema,
  taskId: RoomIdSchema,
  stepId: RoomIdSchema,
  attemptNo: z.number().int().positive(),
  threadId: z.string().min(1).max(256),
  turnIds: z.array(z.string().min(1).max(256)).max(1000),
  clientRequestId: RoomIdSchema,
  outcome: z.enum(['pending', 'running', 'interrupted', 'completed', 'failed', 'cancelled']),
  runtimeInstanceId: z.string().min(1).max(256).optional(),
  fencingToken: z.number().int().positive().optional(),
  lastRuntimeSeq: z.number().int().nonnegative(),
  error: z.string().max(4000).optional()
}).strict()
export type RoomTaskAttempt = z.infer<typeof RoomTaskAttemptSchema>

export const RoomAmendmentSchema = z.object({
  id: RoomIdSchema,
  taskId: RoomIdSchema,
  sourceMessageId: RoomIdSchema,
  revision: z.number().int().positive(),
  body: z.string().min(1).max(64000),
  status: z.enum(['received', 'scheduled', 'applied', 'rejected']),
  effectiveTurnId: z.string().min(1).max(256).optional(),
  reason: z.string().max(2000).optional()
}).strict().refine((amendment) => amendment.status !== 'applied' || Boolean(amendment.effectiveTurnId),
  'applied amendment requires runtime consumption evidence')
