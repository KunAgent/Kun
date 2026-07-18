import { z } from 'zod'
import { GeneratedArtifactsSchema } from './artifacts.js'
import {
  ExtensionIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  PageInfoSchema,
  SemverSchema
} from './common.js'

const OpaqueJobReferenceSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/, 'Expected an opaque job reference')

export const JobIdSchema = OpaqueJobReferenceSchema
export type JobId = z.infer<typeof JobIdSchema>

export const JobCursorSchema = OpaqueJobReferenceSchema
export type JobCursor = z.infer<typeof JobCursorSchema>

export const JobStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type JobState = z.infer<typeof JobStateSchema>

export const JobTerminalStateSchema = z.enum([
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type JobTerminalState = z.infer<typeof JobTerminalStateSchema>

export const JobProgressSchema = z
  .strictObject({
    phase: z.string().min(1).max(128).optional(),
    completed: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    total: z.number().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    unit: z.string().min(1).max(64).optional(),
    percentage: z.number().min(0).max(100).optional(),
    message: z.string().min(1).max(4096).optional(),
    updatedAt: z.string().datetime()
  })
  .refine(
    (value) => value.completed === undefined || value.total === undefined || value.completed <= value.total,
    { message: 'completed cannot exceed total', path: ['completed'] }
  )
export type JobProgress = z.infer<typeof JobProgressSchema>

export const JobErrorSchema = z.strictObject({
  code: z.string().min(1).max(128).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(4096),
  retryable: z.boolean(),
  category: z.enum(['permission', 'scope', 'quota', 'unavailable', 'cancelled', 'invalid', 'internal']).optional(),
  details: JsonObjectSchema.optional()
})
export type JobError = z.infer<typeof JobErrorSchema>

export const JobResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  data: JsonValueSchema.optional(),
  generatedArtifacts: GeneratedArtifactsSchema.default([])
})
export type JobResult = z.infer<typeof JobResultSchema>
export type JobResultInput = z.input<typeof JobResultSchema>

export const JobSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: JobIdSchema,
  kind: z.string().min(1).max(128),
  kindSchemaVersion: z.number().int().positive(),
  ownerExtensionId: ExtensionIdSchema,
  ownerExtensionVersion: SemverSchema,
  workspaceId: z.string().min(1).max(256),
  initiatingOperation: z.string().min(1).max(128),
  state: JobStateSchema,
  executionAttempt: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  terminalAt: z.string().datetime().optional(),
  cancelRequestedAt: z.string().datetime().optional(),
  progress: JobProgressSchema.optional(),
  result: JobResultSchema.optional(),
  error: JobErrorSchema.optional(),
  latestCursor: JobCursorSchema
})
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>

export const JobReferenceSchema = z.strictObject({
  jobId: JobIdSchema,
  kind: z.string().min(1).max(128),
  state: JobStateSchema,
  cursor: JobCursorSchema
})
export type JobReference = z.infer<typeof JobReferenceSchema>

export const JobFilterSchema = z.strictObject({
  states: z.array(JobStateSchema).min(1).max(6).optional(),
  kinds: z.array(z.string().min(1).max(128)).min(1).max(32).optional(),
  workspaceId: z.string().min(1).max(256).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional()
})
export type JobFilter = z.infer<typeof JobFilterSchema>

export const JobGetRequestSchema = z.strictObject({ jobId: JobIdSchema })
export type JobGetRequest = z.infer<typeof JobGetRequestSchema>

export const JobListRequestSchema = z.strictObject({
  filter: JobFilterSchema.optional(),
  cursor: JobCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50)
})
export type JobListRequest = z.input<typeof JobListRequestSchema>

export const JobPageSchema = z.strictObject({
  items: z.array(JobSnapshotSchema).max(200),
  page: PageInfoSchema
})
export type JobPage = z.infer<typeof JobPageSchema>

export const JobEventTypeSchema = z.enum([
  'created',
  'state',
  'progress',
  'cancellation-requested',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'recovery'
])
export type JobEventType = z.infer<typeof JobEventTypeSchema>

export const JobEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: JobIdSchema,
  kind: z.string().min(1).max(128),
  type: JobEventTypeSchema,
  state: JobStateSchema,
  timestamp: z.string().datetime(),
  executionAttempt: z.number().int().nonnegative(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cursor: JobCursorSchema,
  progress: JobProgressSchema.optional(),
  result: JobResultSchema.optional(),
  error: JobErrorSchema.optional()
})
export type JobEvent = z.infer<typeof JobEventSchema>

export const JobSubscribeRequestSchema = z.strictObject({
  jobId: JobIdSchema,
  afterCursor: JobCursorSchema.optional()
})
export type JobSubscribeRequest = z.infer<typeof JobSubscribeRequestSchema>

export const JobSubscriptionResponseSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  snapshot: JobSnapshotSchema,
  replay: z.array(JobEventSchema).max(20_000).default([]),
  cursor: JobCursorSchema,
  gap: z.boolean().default(false),
  complete: z.boolean().default(false)
})
export type JobSubscriptionResponse = z.infer<typeof JobSubscriptionResponseSchema>

export const JobEventNotificationSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(256),
  event: JobEventSchema
})
export type JobEventNotification = z.infer<typeof JobEventNotificationSchema>

export const JobCancelRequestSchema = z.strictObject({
  jobId: JobIdSchema,
  reason: z.string().min(1).max(512).optional()
})
export type JobCancelRequest = z.infer<typeof JobCancelRequestSchema>

export const JobCancellationResultSchema = z.strictObject({
  accepted: z.boolean(),
  snapshot: JobSnapshotSchema
})
export type JobCancellationResult = z.infer<typeof JobCancellationResultSchema>
