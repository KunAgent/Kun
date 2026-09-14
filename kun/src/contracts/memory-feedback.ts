import { z } from 'zod'
import { MemoryType } from './memory.js'

export const MEMORY_FEEDBACK_SCHEMA_VERSION = 1 as const
export const MEMORY_FEEDBACK_MAX_ID_CHARS = 256
export const MEMORY_FEEDBACK_MAX_DIAGNOSTIC_CHARS = 512
export const MEMORY_FEEDBACK_DEFAULT_SEGMENT_BYTES = 4 * 1024 * 1024
export const MEMORY_FEEDBACK_DEFAULT_TOTAL_BYTES = 32 * 1024 * 1024

const FeedbackId = z.string()
  .min(1)
  .max(MEMORY_FEEDBACK_MAX_ID_CHARS)
  .regex(/^[A-Za-z0-9._:-]+$/u, 'feedback ids must be opaque identifiers')
const FeedbackTimestamp = z.string().datetime()

const FeedbackEventBase = {
  schemaVersion: z.literal(MEMORY_FEEDBACK_SCHEMA_VERSION),
  id: FeedbackId,
  memoryId: FeedbackId,
  occurredAt: FeedbackTimestamp
}

export const MemoryFeedbackEvent = z.discriminatedUnion('kind', [
  z.object({
    ...FeedbackEventBase,
    kind: z.literal('retrieved'),
    threadId: FeedbackId,
    turnId: FeedbackId
  }).strict(),
  z.object({
    ...FeedbackEventBase,
    kind: z.literal('confirmed')
  }).strict(),
  z.object({
    ...FeedbackEventBase,
    kind: z.literal('corrected'),
    replacementMemoryId: FeedbackId
  }).strict()
])
export type MemoryFeedbackEvent = z.infer<typeof MemoryFeedbackEvent>

export function classifyMemoryFeedbackReplay(
  existing: MemoryFeedbackEvent,
  incoming: MemoryFeedbackEvent
): 'new' | 'replay' | 'conflict' {
  if (existing.id !== incoming.id) return 'new'
  return JSON.stringify(existing) === JSON.stringify(incoming) ? 'replay' : 'conflict'
}

export const MemoryFeedbackAggregate = z.object({
  schemaVersion: z.literal(MEMORY_FEEDBACK_SCHEMA_VERSION),
  memoryId: FeedbackId,
  retrievalCount: z.number().int().nonnegative(),
  confirmationCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  lastRetrievedAt: FeedbackTimestamp.optional(),
  lastConfirmedAt: FeedbackTimestamp.optional(),
  lastCorrectedAt: FeedbackTimestamp.optional()
}).strict()
export type MemoryFeedbackAggregate = z.infer<typeof MemoryFeedbackAggregate>

export const MemoryFeedbackDiagnostics = z.object({
  enabled: z.boolean(),
  state: z.enum(['disabled', 'ready', 'degraded']),
  projection: z.enum(['missing', 'ready', 'rebuilding', 'degraded']),
  eventCount: z.number().int().nonnegative(),
  aggregateCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  malformedCount: z.number().int().nonnegative(),
  lastCheckpointAt: FeedbackTimestamp.optional(),
  degradedReason: z.string().max(MEMORY_FEEDBACK_MAX_DIAGNOSTIC_CHARS).optional()
}).strict()
export type MemoryFeedbackDiagnostics = z.infer<typeof MemoryFeedbackDiagnostics>

export const MemoryFeedbackConfig = z.object({
  enabled: z.boolean().default(false),
  maxSegmentBytes: z.number().int().min(64 * 1024).max(64 * 1024 * 1024)
    .default(MEMORY_FEEDBACK_DEFAULT_SEGMENT_BYTES),
  maxTotalBytes: z.number().int().min(64 * 1024).max(512 * 1024 * 1024)
    .default(MEMORY_FEEDBACK_DEFAULT_TOTAL_BYTES)
}).strict().superRefine((value, context) => {
  if (value.maxTotalBytes >= value.maxSegmentBytes) return
  context.addIssue({
    code: 'custom',
    path: ['maxTotalBytes'],
    message: 'feedback maxTotalBytes must not be smaller than maxSegmentBytes'
  })
})
export type MemoryFeedbackConfig = z.infer<typeof MemoryFeedbackConfig>

export const MemoryFeedbackAccess = z.object({
  workspace: z.string().min(1).max(4_096).optional(),
  project: z.string().min(1).max(4_096).optional()
}).strict()
export type MemoryFeedbackAccess = z.infer<typeof MemoryFeedbackAccess>

export const MemoryConfirmRequest = z.object({
  operationId: FeedbackId,
  memoryId: FeedbackId,
  access: MemoryFeedbackAccess.default({})
}).strict()
export type MemoryConfirmRequest = z.input<typeof MemoryConfirmRequest>

export const MemoryConfirmResult = z.object({
  memoryId: FeedbackId,
  eventId: FeedbackId,
  confirmedAt: FeedbackTimestamp,
  replayed: z.boolean()
}).strict()
export type MemoryConfirmResult = z.infer<typeof MemoryConfirmResult>

export const MemoryCorrectionFields = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  type: MemoryType.optional(),
  observedAt: FeedbackTimestamp.optional(),
  validFrom: FeedbackTimestamp.nullable().optional(),
  validTo: FeedbackTimestamp.nullable().optional(),
  expiresAt: FeedbackTimestamp.nullable().optional()
}).strict().superRefine((value, context) => {
  if (!value.validFrom || !value.validTo || Date.parse(value.validFrom) <= Date.parse(value.validTo)) return
  context.addIssue({
    code: 'custom',
    path: ['validTo'],
    message: 'memory validFrom must not be after validTo'
  })
})
export type MemoryCorrectionFields = z.infer<typeof MemoryCorrectionFields>

export const MemoryCorrectRequest = z.object({
  operationId: FeedbackId,
  memoryId: FeedbackId,
  access: MemoryFeedbackAccess.default({}),
  replacement: MemoryCorrectionFields
}).strict()
export type MemoryCorrectRequest = z.input<typeof MemoryCorrectRequest>

export const MemoryCorrectResult = z.object({
  previousMemoryId: FeedbackId,
  replacementMemoryId: FeedbackId,
  eventId: FeedbackId,
  correctedAt: FeedbackTimestamp,
  replayed: z.boolean()
}).strict()
export type MemoryCorrectResult = z.infer<typeof MemoryCorrectResult>

export const MemoryFeedbackErrorCode = z.enum([
  'unauthorized',
  'not-found',
  'inactive',
  'cross-scope',
  'id-conflict',
  'unavailable',
  'validation'
])
export type MemoryFeedbackErrorCode = z.infer<typeof MemoryFeedbackErrorCode>

export const MemoryFeedbackOperationError = z.object({
  code: MemoryFeedbackErrorCode,
  message: z.string().min(1).max(MEMORY_FEEDBACK_MAX_DIAGNOSTIC_CHARS)
}).strict()
export type MemoryFeedbackOperationError = z.infer<typeof MemoryFeedbackOperationError>
