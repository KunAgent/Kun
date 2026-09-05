import { z } from 'zod'
import {
  kunThreadTrajectoryDetailPath,
  kunThreadTrajectoryPath,
  kunThreadTrajectorySummaryPath
} from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'

export const TRAJECTORY_SCHEMA_VERSION = 2 as const

export const trajectoryStatusSchema = z.enum([
  'running', 'completed', 'failed', 'cancelled', 'interrupted'
])
export const trajectoryDetailStateSchema = z.enum([
  'available', 'not_captured', 'truncated', 'evicted', 'legacy'
])
export const trajectoryFilterSchema = z.enum(['all', 'llm', 'tool', 'error'])
export type TrajectoryFilter = z.infer<typeof trajectoryFilterSchema>

const usageSchema = z.object({
  promptTokens: z.number().nonnegative(),
  completionTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  reasoningTokens: z.number().nonnegative().optional(),
  cachedTokens: z.number().nonnegative().optional(),
  cacheHitTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  cacheHitRate: z.number().nullable(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  valueEstimateUsd: z.number().nonnegative().optional(),
  valueEstimateCny: z.number().nonnegative().optional(),
  requestTtftMs: z.number().nonnegative().optional(),
  requestGenerationMs: z.number().nonnegative().optional()
}).passthrough()

const recordBaseSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  id: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  roundId: z.string(),
  step: z.number().int().nonnegative(),
  sourceSeq: z.number().int().nonnegative().optional(),
  status: trajectoryStatusSchema,
  startedAt: z.string(),
  firstTokenAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  preview: z.string(),
  detailState: trajectoryDetailStateSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string().optional()
})

export const trajectoryRequestRecordSchema = recordBaseSchema.extend({
  kind: z.literal('llm_request'),
  requestId: z.string(),
  attempt: z.number().int().positive(),
  attemptReason: z.string(),
  purpose: z.string(),
  provider: z.string(),
  model: z.string(),
  endpointFormat: z.string(),
  responseStatus: z.number().optional(),
  usage: usageSchema.optional(),
  manifestId: z.string().optional(),
  optionsAvailable: z.boolean(),
  promptFingerprint: z.string().optional(),
  previousPromptFingerprint: z.string().optional(),
  systemBlobId: z.string().optional(),
  toolsBlobId: z.string().optional(),
  configBlobId: z.string().optional()
})

export const trajectoryToolRecordSchema = recordBaseSchema.extend({
  kind: z.enum(['tool', 'subtool']),
  callId: z.string(),
  parentRequestId: z.string().optional(),
  parentCallId: z.string().optional(),
  toolName: z.string(),
  argumentsItemId: z.string().optional(),
  resultItemId: z.string().optional(),
  isError: z.boolean(),
  argumentPreview: z.string(),
  resultPreview: z.string(),
  schemaAvailable: z.boolean(),
  attachmentIds: z.array(z.string())
})

export const trajectoryMessageRecordSchema = recordBaseSchema.extend({
  kind: z.enum(['system', 'user', 'context', 'compacted', 'assistant']),
  itemId: z.string(),
  itemIds: z.array(z.string()),
  parentRequestId: z.string().optional(),
  sourceType: z.string().optional(),
  sourceAvailable: z.boolean().optional(),
  sourceLabel: z.string().optional(),
  thinkingPreview: z.string(),
  attachmentIds: z.array(z.string()),
  promptFingerprint: z.string().optional(),
  previousPromptFingerprint: z.string().optional()
})

export const trajectoryRecordSchema = z.discriminatedUnion('kind', [
  trajectoryRequestRecordSchema,
  trajectoryToolRecordSchema,
  trajectoryMessageRecordSchema
])
export type TrajectoryRecord = z.infer<typeof trajectoryRecordSchema>
export type TrajectoryRequestRecord = z.infer<typeof trajectoryRequestRecordSchema>
export type TrajectoryToolRecord = z.infer<typeof trajectoryToolRecordSchema>

export const trajectorySummarySchema = z.object({
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
  cacheHitRate: z.number().nullable(),
  avgTtftMs: z.number().nullable(),
  avgTokensPerSecond: z.number().nullable(),
  totalDurationMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  costCny: z.number().nonnegative(),
  valueEstimateUsd: z.number().nonnegative(),
  valueEstimateCny: z.number().nonnegative(),
  lastStatus: trajectoryStatusSchema.nullable()
})
export type TrajectorySummary = z.infer<typeof trajectorySummarySchema>

export const trajectoryPageSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  records: z.array(trajectoryRecordSchema).max(200),
  nextCursor: z.string().optional(),
  summary: trajectorySummarySchema,
  warnings: z.array(z.string()),
  historyIncomplete: z.boolean()
})
export type TrajectoryPage = z.infer<typeof trajectoryPageSchema>

export const trajectoryDetailSectionSchema = z.enum([
  'overview', 'input', 'output', 'usage', 'timing', 'raw', 'arguments', 'result',
  'system-prompt', 'tools', 'diff', 'options', 'rendered', 'source', 'schema'
])
export type TrajectoryDetailSection = z.infer<typeof trajectoryDetailSectionSchema>

export const trajectoryDetailSchema = z.object({
  schemaVersion: z.literal(TRAJECTORY_SCHEMA_VERSION),
  recordId: z.string(),
  section: trajectoryDetailSectionSchema,
  state: trajectoryDetailStateSchema,
  content: z.unknown().optional(),
  truncated: z.boolean(),
  warning: z.string().optional()
})
export type TrajectoryDetail = z.infer<typeof trajectoryDetailSchema>

export async function fetchTrajectoryPage(
  threadId: string,
  options: {
    limit?: number
    cursor?: string
    filter?: TrajectoryFilter
    query?: string
  } = {}
): Promise<TrajectoryPage> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.filter && options.filter !== 'all') params.set('filter', options.filter)
  if (options.query?.trim()) params.set('q', options.query.trim())
  const response = await rendererRuntimeClient.runtimeRequest(
    `${kunThreadTrajectoryPath(threadId)}${params.size ? `?${params}` : ''}`,
    'GET'
  )
  if (!response.ok) throw runtimeError(response.body, 'failed to load trajectory')
  return parseTrajectoryPage(JSON.parse(response.body))
}

export async function fetchTrajectorySummary(threadId: string): Promise<TrajectorySummary> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunThreadTrajectorySummaryPath(threadId),
    'GET'
  )
  if (!response.ok) throw runtimeError(response.body, 'failed to load trajectory summary')
  return trajectorySummarySchema.parse(JSON.parse(response.body))
}

export async function fetchTrajectoryDetail(
  threadId: string,
  recordId: string,
  section: TrajectoryDetailSection
): Promise<TrajectoryDetail> {
  const response = await rendererRuntimeClient.runtimeRequest(
    `${kunThreadTrajectoryDetailPath(threadId, recordId)}?section=${encodeURIComponent(section)}`,
    'GET'
  )
  if (!response.ok) throw runtimeError(response.body, 'failed to load trajectory detail')
  return trajectoryDetailSchema.parse(JSON.parse(response.body))
}

function runtimeError(body: string, fallback: string): Error {
  return runtimeErrorToError(parseRuntimeErrorBody(body, fallback))
}

export function parseTrajectoryPage(value: unknown): TrajectoryPage {
  if (isRecord(value) && value.schemaVersion === TRAJECTORY_SCHEMA_VERSION) {
    return trajectoryPageSchema.parse(value)
  }
  return normalizeLegacyPage(value)
}

function normalizeLegacyPage(value: unknown): TrajectoryPage {
  const page = z.object({
    schemaVersion: z.literal(1),
    records: z.array(z.record(z.string(), z.unknown())),
    nextCursor: z.string().optional(),
    summary: z.record(z.string(), z.unknown()),
    warnings: z.array(z.string()),
    historyIncomplete: z.boolean()
  }).parse(value)
  const records = page.records.map((record) => normalizeLegacyRecord(record))
  return trajectoryPageSchema.parse({
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    records,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    summary: { ...page.summary, schemaVersion: TRAJECTORY_SCHEMA_VERSION },
    warnings: page.warnings,
    historyIncomplete: page.historyIncomplete
  })
}

function normalizeLegacyRecord(record: Record<string, unknown>): TrajectoryRecord {
  const kind = record.kind
  const base = { ...record, schemaVersion: TRAJECTORY_SCHEMA_VERSION }
  if (kind === 'llm_request') {
    return trajectoryRequestRecordSchema.parse({ ...base, optionsAvailable: false })
  }
  if (kind === 'tool') {
    return trajectoryToolRecordSchema.parse({
      ...base,
      argumentPreview: '',
      resultPreview: '',
      schemaAvailable: false,
      attachmentIds: []
    })
  }
  const mappedKind = kind === 'input' ? 'user' : kind === 'compaction' ? 'compacted' : kind
  return trajectoryMessageRecordSchema.parse({
    ...base,
    kind: mappedKind,
    itemIds: typeof record.itemId === 'string' ? [record.itemId] : [],
    thinkingPreview: '',
    attachmentIds: []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
