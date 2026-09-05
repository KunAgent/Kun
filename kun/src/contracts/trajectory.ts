import { z } from 'zod'
import { UsageSnapshotSchema } from './usage.js'

export const TRAJECTORY_SCHEMA_VERSION = 2 as const
export const PROMPT_MANIFEST_SCHEMA_VERSION = 1 as const

export const TrajectoryStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type TrajectoryStatus = z.infer<typeof TrajectoryStatusSchema>

export const TrajectoryDetailStateSchema = z.enum([
  'available',
  'not_captured',
  'truncated',
  'evicted',
  'legacy'
])
export type TrajectoryDetailState = z.infer<typeof TrajectoryDetailStateSchema>

const TrajectoryRecordBaseSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  id: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  roundId: z.string().min(1),
  step: z.number().int().nonnegative(),
  sourceSeq: z.number().int().nonnegative().optional(),
  status: TrajectoryStatusSchema,
  startedAt: z.string(),
  firstTokenAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  preview: z.string().max(2_048).default(''),
  detailState: TrajectoryDetailStateSchema,
  errorCode: z.string().max(256).optional(),
  errorMessage: z.string().max(2_048).optional()
})

export const TrajectoryRequestRecordSchema = TrajectoryRecordBaseSchema.extend({
  kind: z.literal('llm_request'),
  requestId: z.string().min(1),
  attempt: z.number().int().positive(),
  attemptReason: z.string().min(1).max(64),
  purpose: z.string().min(1).max(64).default('assistant'),
  provider: z.string(),
  model: z.string(),
  endpointFormat: z.string(),
  responseStatus: z.number().int().min(100).max(599).optional(),
  usage: UsageSnapshotSchema.optional(),
  manifestId: z.string().min(1).optional(),
  optionsAvailable: z.boolean().default(false),
  promptFingerprint: z.string().min(1).optional(),
  previousPromptFingerprint: z.string().min(1).optional(),
  systemBlobId: z.string().min(1).optional(),
  toolsBlobId: z.string().min(1).optional(),
  configBlobId: z.string().min(1).optional()
})
export type TrajectoryRequestRecord = z.infer<typeof TrajectoryRequestRecordSchema>

export const TrajectoryToolRecordSchema = TrajectoryRecordBaseSchema.extend({
  kind: z.enum(['tool', 'subtool']),
  callId: z.string().min(1),
  parentRequestId: z.string().min(1).optional(),
  parentCallId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  argumentsItemId: z.string().min(1).optional(),
  resultItemId: z.string().min(1).optional(),
  isError: z.boolean().default(false),
  argumentPreview: z.string().max(2_048).default(''),
  resultPreview: z.string().max(2_048).default(''),
  schemaAvailable: z.boolean().default(false),
  attachmentIds: z.array(z.string()).default([])
})
export type TrajectoryToolRecord = z.infer<typeof TrajectoryToolRecordSchema>

export const TrajectoryMessageRecordSchema = TrajectoryRecordBaseSchema.extend({
  kind: z.enum(['system', 'user', 'context', 'compacted', 'assistant']),
  itemId: z.string().min(1),
  itemIds: z.array(z.string()).default([]),
  parentRequestId: z.string().min(1).optional(),
  sourceType: z.string().max(128).optional(),
  sourceAvailable: z.boolean().optional(),
  sourceLabel: z.string().max(128).optional(),
  thinkingPreview: z.string().max(2_048).default(''),
  attachmentIds: z.array(z.string()).default([]),
  promptFingerprint: z.string().min(1).optional(),
  previousPromptFingerprint: z.string().min(1).optional()
})
export type TrajectoryMessageRecord = z.infer<typeof TrajectoryMessageRecordSchema>

export const TrajectoryRawBlockSchema = z.object({
  type: z.string().min(1).max(64),
  content: z.unknown().optional(),
  itemId: z.string().min(1).optional(),
  attachmentId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional()
})
export type TrajectoryRawBlock = z.infer<typeof TrajectoryRawBlockSchema>

export const TrajectoryRawDetailContentSchema = z.object({
  kind: z.literal('blocks'),
  blocks: z.array(TrajectoryRawBlockSchema)
})
export type TrajectoryRawDetailContent = z.infer<typeof TrajectoryRawDetailContentSchema>

export const TrajectoryMessageSourceDetailSchema = z.object({
  kind: z.literal('message-source'),
  label: z.string().min(1).max(128),
  value: z.unknown()
})
export type TrajectoryMessageSourceDetail = z.infer<typeof TrajectoryMessageSourceDetailSchema>

export const TrajectoryRecordSchema = z.discriminatedUnion('kind', [
  TrajectoryRequestRecordSchema,
  TrajectoryToolRecordSchema,
  TrajectoryMessageRecordSchema
])
export type TrajectoryRecord = z.infer<typeof TrajectoryRecordSchema>

export const TrajectoryFilterSchema = z.enum(['all', 'llm', 'tool', 'error'])
export type TrajectoryFilter = z.infer<typeof TrajectoryFilterSchema>

export const TrajectorySummarySchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  requestCount: z.number().int().nonnegative(),
  toolCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  avgTtftMs: z.number().nonnegative().nullable(),
  avgTokensPerSecond: z.number().nonnegative().nullable(),
  totalDurationMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  costCny: z.number().nonnegative(),
  valueEstimateUsd: z.number().nonnegative(),
  valueEstimateCny: z.number().nonnegative(),
  lastStatus: TrajectoryStatusSchema.nullable()
})
export type TrajectorySummary = z.infer<typeof TrajectorySummarySchema>

export const TrajectoryPageSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  records: z.array(TrajectoryRecordSchema),
  nextCursor: z.string().optional(),
  summary: TrajectorySummarySchema,
  warnings: z.array(z.string()),
  historyIncomplete: z.boolean().default(false)
})
export type TrajectoryPage = z.infer<typeof TrajectoryPageSchema>

export const TrajectoryDetailSectionSchema = z.enum([
  'overview', 'input', 'output', 'usage', 'timing', 'raw', 'arguments', 'result',
  'system-prompt', 'tools', 'diff', 'options', 'rendered', 'source', 'schema'
])
export type TrajectoryDetailSection = z.infer<typeof TrajectoryDetailSectionSchema>

export const TrajectoryDetailSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  recordId: z.string().min(1),
  section: TrajectoryDetailSectionSchema,
  state: TrajectoryDetailStateSchema,
  content: z.unknown().optional(),
  truncated: z.boolean().default(false),
  warning: z.string().optional()
})
export type TrajectoryDetail = z.infer<typeof TrajectoryDetailSchema>

export const PromptBlobRefSchema = z.object({
  blobId: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['system', 'tools', 'config', 'message']),
  codec: z.literal('br'),
  rawSize: z.number().int().nonnegative(),
  compressedSize: z.number().int().nonnegative(),
  truncated: z.boolean()
})
export type PromptBlobRef = z.infer<typeof PromptBlobRefSchema>

export const PromptManifestSchema = z.object({
  schemaVersion: z.literal(PROMPT_MANIFEST_SCHEMA_VERSION),
  manifestId: z.string().min(1),
  threadId: z.string().min(1),
  requestId: z.string().min(1),
  createdAt: z.string(),
  blobs: z.array(PromptBlobRefSchema),
  messageItemIds: z.array(z.string()),
  attachmentIds: z.array(z.string()),
  retainedBytes: z.number().int().nonnegative()
})
export type PromptManifest = z.infer<typeof PromptManifestSchema>
