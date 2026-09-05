import type { TurnItem } from '../contracts/items.js'
import type { ModelRequestTraceRecord } from '../contracts/model-request-trace.js'
import {
  TRAJECTORY_SCHEMA_VERSION,
  TrajectoryPageSchema,
  TrajectorySummarySchema,
  type TrajectoryDetail,
  type TrajectoryDetailSection,
  type TrajectoryFilter,
  type TrajectoryPage,
  type TrajectoryRecord,
  type TrajectoryRequestRecord,
  type TrajectoryStatus,
  type TrajectorySummary,
  type TrajectoryToolRecord
} from '../contracts/trajectory.js'
import type { SessionStore } from '../ports/session-store.js'
import type { LlmDebugRecorder } from './llm-debug-recorder.js'
import { TRAJECTORY_SEARCH_PREVIEW_BYTES } from './trajectory-content-store.js'
import { resolveTrajectoryDetail } from './trajectory-query-detail.js'

const MAX_QUERY_RECORDS = 20_000
const REQUEST_PAGE_SIZE = 200

export type TrajectoryQuery = {
  limit: number
  cursor?: string
  filter: TrajectoryFilter
  query: string
}

export class TrajectoryQueryService {
  constructor(
    private readonly recorder: LlmDebugRecorder,
    private readonly sessions: SessionStore
  ) {}

  async page(threadId: string, query: TrajectoryQuery): Promise<TrajectoryPage> {
    const source = await this.source(threadId)
    const filtered = source.records
      .filter((record) => matchesFilter(record, query.filter))
      .filter((record) => matchesQuery(record, query.query))
      .filter((record) => beforeCursor(record, query.cursor))
    const records = filtered.slice(0, query.limit)
    const nextCursor = filtered.length > query.limit && records.length
      ? encodeCursor(records.at(-1)!)
      : undefined
    return TrajectoryPageSchema.parse({
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      records,
      ...(nextCursor ? { nextCursor } : {}),
      summary: source.summary,
      warnings: source.warnings,
      historyIncomplete: source.truncated
    })
  }

  async summary(threadId: string): Promise<TrajectorySummary> {
    return (await this.source(threadId)).summary
  }

  async detail(
    threadId: string,
    recordId: string,
    section: TrajectoryDetailSection
  ): Promise<TrajectoryDetail | null> {
    const source = await this.source(threadId)
    const record = source.records.find((candidate) => candidate.id === recordId)
    if (!record) return null
    const trace = record.kind === 'llm_request'
      ? source.requests.find((candidate) => candidate.id === record.requestId)
      : undefined
    return resolveTrajectoryDetail({
      recorder: this.recorder,
      threadId,
      record,
      trace,
      section,
      items: source.items,
      traces: source.requests,
      requests: source.records.filter(
        (candidate): candidate is TrajectoryRequestRecord => candidate.kind === 'llm_request'
      )
    })
  }

  private async source(threadId: string): Promise<{
    records: TrajectoryRecord[]
    requests: ModelRequestTraceRecord[]
    items: TurnItem[]
    summary: TrajectorySummary
    warnings: string[]
    truncated: boolean
  }> {
    const [requestSource, items] = await Promise.all([
      loadAllRequests(this.recorder, threadId),
      this.sessions.loadItems(threadId)
    ])
    const requestRecords = await projectRequests(
      requestSource.records,
      this.recorder,
      threadId
    )
    const itemRecords = projectItems(items, requestRecords)
    const records = [...requestRecords, ...itemRecords]
      .sort(newestFirst)
      .slice(0, MAX_QUERY_RECORDS)
    return {
      records,
      requests: requestSource.records,
      items,
      summary: summarize(records),
      warnings: requestSource.warnings,
      truncated: requestSource.truncated || requestRecords.length + itemRecords.length > MAX_QUERY_RECORDS
    }
  }
}

async function loadAllRequests(recorder: LlmDebugRecorder, threadId: string): Promise<{
  records: ModelRequestTraceRecord[]
  warnings: string[]
  truncated: boolean
}> {
  const records = new Map<string, ModelRequestTraceRecord>()
  const warnings = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await recorder.listThread(threadId, { limit: REQUEST_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
    for (const record of page.records) records.set(record.id, record)
    page.warnings.forEach((warning) => warnings.add(warning))
    cursor = page.nextCursor
  } while (cursor && records.size < MAX_QUERY_RECORDS)
  return { records: [...records.values()], warnings: [...warnings], truncated: Boolean(cursor) }
}

async function projectRequests(
  records: ModelRequestTraceRecord[],
  recorder: LlmDebugRecorder,
  threadId: string
): Promise<TrajectoryRequestRecord[]> {
  const steps = new Map<string, Map<string, number>>()
  let previousPromptFingerprint: string | undefined
  const projected: TrajectoryRequestRecord[] = []
  for (const trace of [...records].sort(oldestTraceFirst)) {
    const roundId = trace.roundId ?? trace.id
    const turnSteps = steps.get(trace.turnId) ?? new Map<string, number>()
    const step = trace.step ?? turnSteps.get(roundId) ?? turnSteps.size
    turnSteps.set(roundId, step)
    steps.set(trace.turnId, turnSteps)
    const usage = trace.decoded?.usage
    const manifest = trace.manifestId
      ? await recorder.loadPromptManifest(threadId, trace.manifestId)
      : null
    const systemBlobId = manifest?.blobs.find((blob) => blob.kind === 'system')?.blobId
    const toolsBlobId = manifest?.blobs.find((blob) => blob.kind === 'tools')?.blobId
    const configBlobId = manifest?.blobs.find((blob) => blob.kind === 'config')?.blobId
    const stablePromptBlobs = manifest?.blobs.filter((blob) => blob.kind !== 'message') ?? []
    const promptFingerprint = stablePromptBlobs.length
      ? stablePromptBlobs.map((blob) => `${blob.kind}:${blob.blobId}`).join(':')
      : undefined
    projected.push({
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      id: `request:${trace.id}`,
      kind: 'llm_request',
      threadId: trace.threadId,
      turnId: trace.turnId,
      roundId,
      sourceSeq: trace.sequence,
      requestId: trace.id,
      step,
      attempt: trace.attempt,
      attemptReason: trace.attemptReason,
      purpose: trace.purpose ?? (trace.turnId.endsWith('_title') ? 'title' : 'assistant'),
      provider: trace.provider,
      model: trace.model,
      endpointFormat: trace.endpointFormat,
      status: trajectoryStatus(trace),
      startedAt: trace.startedAt,
      ...(trace.firstTokenAt ? { firstTokenAt: trace.firstTokenAt } : {}),
      ...(trace.finishedAt ? { completedAt: trace.finishedAt } : {}),
      ...(trace.durationMs !== undefined ? { durationMs: trace.durationMs } : {}),
      ...(trace.response?.status ? { responseStatus: trace.response.status } : {}),
      ...(usage ? { usage } : {}),
      ...(trace.manifestId ? { manifestId: trace.manifestId } : {}),
      optionsAvailable: configBlobId !== undefined,
      ...(promptFingerprint ? { promptFingerprint } : {}),
      ...(previousPromptFingerprint ? { previousPromptFingerprint } : {}),
      ...(systemBlobId ? { systemBlobId } : {}),
      ...(toolsBlobId ? { toolsBlobId } : {}),
      ...(configBlobId ? { configBlobId } : {}),
      preview: boundedPreview(trace.error || trace.decoded?.error || `${trace.model} · ${trace.provider}`),
      detailState: trace.manifestId
        ? 'available'
        : trace.captureMode !== 'metadata' && (trace.request?.body.originalBytes ?? 0) > 0
          ? 'legacy'
          : 'not_captured',
      ...(trace.diagnosticCode ? { errorCode: trace.diagnosticCode } : {}),
      ...((trace.error || trace.decoded?.error)
        ? { errorMessage: boundedPreview(trace.error || trace.decoded?.error || '') }
        : {})
    })
    if (promptFingerprint) previousPromptFingerprint = promptFingerprint
  }
  return projected
}

function projectItems(items: TurnItem[], requests: TrajectoryRequestRecord[]): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = []
  const resultByCall = new Map(items
    .filter((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
    .map((item) => [item.callId, item]))
  for (const request of requests) {
    if (!request.promptFingerprint) continue
    if (request.previousPromptFingerprint === request.promptFingerprint) continue
    records.push({
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      id: `system:${request.requestId}`,
      kind: 'system',
      threadId: request.threadId,
      turnId: request.turnId,
      roundId: request.roundId,
      step: request.step,
      sourceSeq: request.sourceSeq,
      status: request.status,
      startedAt: request.startedAt,
      completedAt: request.startedAt,
      durationMs: 0,
      itemId: `prompt:${request.requestId}`,
      itemIds: [],
      parentRequestId: request.requestId,
      preview: request.previousPromptFingerprint
        ? 'System Prompt Updated'
        : 'Initial System Prompt',
      detailState: request.detailState,
      sourceAvailable: false,
      promptFingerprint: request.promptFingerprint,
      ...(request.previousPromptFingerprint
        ? { previousPromptFingerprint: request.previousPromptFingerprint }
        : {}),
      thinkingPreview: '',
      attachmentIds: []
    })
  }
  const assistantGroups = new Map<string, {
    request?: TrajectoryRequestRecord
    items: Array<Extract<TurnItem, { kind: 'assistant_text' | 'assistant_reasoning' }>>
  }>()
  for (const item of items) {
    const request = latestRequestBefore(requests, item.turnId, item.createdAt)
    const roundId = request?.roundId ?? `turn:${item.turnId}`
    const step = request?.step ?? 0
    if (item.kind === 'tool_call') {
      const result = resultByCall.get(item.callId)
      records.push(projectTool(item, result, request, roundId, step))
      records.push(...projectSubtools(item, result, request, roundId, step))
      continue
    }
    if (item.kind === 'assistant_text' || item.kind === 'assistant_reasoning') {
      const key = request?.requestId ?? `${item.turnId}:${step}`
      const group = assistantGroups.get(key) ?? { request, items: [] }
      group.items.push(item)
      assistantGroups.set(key, group)
      continue
    }
    if (!isTrajectoryMessageItem(item)) continue
    const kind = item.kind === 'user_message'
      ? item.messageSource ? 'context' : 'user'
      : item.kind === 'compaction'
        ? 'compacted'
        : 'context'
    records.push({
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      id: `item:${item.id}`,
      kind,
      threadId: item.threadId,
      turnId: item.turnId,
      roundId,
      step,
      status: item.status === 'failed' ? 'failed' : item.status === 'aborted' ? 'cancelled' : 'completed',
      startedAt: item.createdAt,
      ...(item.finishedAt ? { completedAt: item.finishedAt } : {}),
      ...(item.finishedAt ? { durationMs: elapsed(item.createdAt, item.finishedAt) } : {}),
      itemId: item.id,
      itemIds: [item.id],
      ...(request ? { parentRequestId: request.requestId } : {}),
      preview: boundedPreview(itemPreview(item)),
      detailState: 'available',
      sourceType: item.kind === 'user_message' ? item.messageSource ?? 'user' : item.kind,
      sourceAvailable: item.kind !== 'compaction',
      ...(item.kind !== 'compaction' ? { sourceLabel: messageSourceLabel(item) } : {}),
      thinkingPreview: '',
      attachmentIds: item.kind === 'user_message' ? item.attachmentIds ?? [] : []
    })
  }
  for (const [key, group] of assistantGroups) {
    const first = group.items[0]
    if (!first) continue
    const request = group.request
    const texts = group.items.filter((item) => item.kind === 'assistant_text').map((item) => item.text)
    const thinking = group.items.filter((item) => item.kind === 'assistant_reasoning').map((item) => item.text)
    const completedAt = group.items.map((item) => item.finishedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
    records.push({
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      id: `assistant:${key}`,
      kind: 'assistant',
      threadId: first.threadId,
      turnId: first.turnId,
      roundId: request?.roundId ?? `turn:${first.turnId}`,
      step: request?.step ?? 0,
      sourceSeq: request?.sourceSeq,
      status: group.items.some((item) => item.status === 'failed')
        ? 'failed'
        : group.items.some((item) => item.status === 'running')
          ? 'running'
          : group.items.some((item) => item.status === 'aborted')
            ? 'cancelled'
            : 'completed',
      startedAt: request?.startedAt ?? first.createdAt,
      ...(completedAt ? { completedAt, durationMs: elapsed(request?.startedAt ?? first.createdAt, completedAt) } : {}),
      itemId: first.id,
      itemIds: group.items.map((item) => item.id),
      ...(request ? { parentRequestId: request.requestId } : {}),
      preview: boundedPreview(texts.join('\n') || thinking.join('\n')),
      thinkingPreview: boundedPreview(thinking.join('\n')),
      detailState: 'available',
      sourceType: 'assistant',
      sourceAvailable: false,
      attachmentIds: []
    })
  }
  return records
}

function messageSourceLabel(item: Extract<TurnItem, {
  kind: 'user_message' | 'model_context' | 'runtime_context_source' | 'compaction'
}>): string {
  if (item.kind === 'model_context') return 'Model context'
  if (item.kind === 'runtime_context_source') return 'Runtime context'
  if (item.kind === 'compaction') return 'Compaction'
  if (!item.messageSource) return 'User'
  return item.messageSource.split('_').map((part) =>
    `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
  ).join(' ')
}

function isTrajectoryMessageItem(item: TurnItem): item is Extract<TurnItem, {
  kind: 'user_message' | 'model_context' | 'runtime_context_source' | 'compaction'
}> {
  return item.kind === 'user_message' || item.kind === 'model_context' ||
    item.kind === 'runtime_context_source' || item.kind === 'compaction'
}

function projectTool(
  call: Extract<TurnItem, { kind: 'tool_call' }>,
  result: Extract<TurnItem, { kind: 'tool_result' }> | undefined,
  request: TrajectoryRequestRecord | undefined,
  roundId: string,
  step: number
): TrajectoryToolRecord {
  const status: TrajectoryStatus = result?.isError
    ? 'failed'
    : result
      ? 'completed'
      : call.status === 'aborted'
        ? 'cancelled'
        : 'running'
  const completedAt = result?.finishedAt ?? result?.createdAt ?? call.finishedAt
  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    id: `tool:${call.callId}`,
    kind: 'tool',
    threadId: call.threadId,
    turnId: call.turnId,
    roundId,
    step,
    status,
    startedAt: call.createdAt,
    ...(completedAt ? { completedAt, durationMs: elapsed(call.createdAt, completedAt) } : {}),
    callId: call.callId,
    ...(request ? { parentRequestId: request.requestId } : {}),
    toolName: call.toolName,
    argumentsItemId: call.id,
    ...(result ? { resultItemId: result.id } : {}),
    isError: result?.isError === true,
    argumentPreview: boundedPreview(stringifyPreview(call.arguments)),
    resultPreview: result ? boundedPreview(stringifyPreview(result.output)) : '',
    schemaAvailable: Boolean(request?.toolsBlobId),
    attachmentIds: result ? collectAttachmentIds(result.output) : [],
    preview: boundedPreview(`${call.toolName} ${call.summary ?? stringifyPreview(call.arguments)}`),
    detailState: 'available',
    ...(result?.isError ? { errorMessage: boundedPreview(stringifyPreview(result.output)) } : {})
  }
}

function projectSubtools(
  call: Extract<TurnItem, { kind: 'tool_call' }>,
  result: Extract<TurnItem, { kind: 'tool_result' }> | undefined,
  request: TrajectoryRequestRecord | undefined,
  roundId: string,
  step: number
): TrajectoryToolRecord[] {
  if (!result || !isRecord(result.output) || !Array.isArray(result.output.childRuns)) return []
  return result.output.childRuns.flatMap((entry, index) => {
    if (!isRecord(entry)) return []
    const childId = textValue(entry.childId) || textValue(entry.id)
    const activity = isRecord(entry.activity) ? entry.activity : undefined
    const toolName = textValue(entry.toolName) || textValue(activity?.toolName) || textValue(entry.profile)
    if (!childId || !toolName) return []
    const startedAt = textValue(entry.startedAt) || textValue(entry.attemptStartedAt) || call.createdAt
    const completedAt = textValue(entry.completedAt)
    const failed = entry.status === 'failed' || entry.isError === true
    return [{
      schemaVersion: TRAJECTORY_SCHEMA_VERSION,
      id: `subtool:${call.callId}:${childId}:${index}`,
      kind: 'subtool' as const,
      threadId: call.threadId,
      turnId: call.turnId,
      roundId,
      step,
      status: failed ? 'failed' as const : completedAt ? 'completed' as const : 'running' as const,
      startedAt,
      ...(completedAt ? { completedAt, durationMs: elapsed(startedAt, completedAt) } : {}),
      callId: childId,
      parentCallId: call.callId,
      ...(request ? { parentRequestId: request.requestId } : {}),
      toolName,
      isError: failed,
      argumentPreview: '',
      resultPreview: boundedPreview(textValue(entry.summary) || textValue(entry.error)),
      schemaAvailable: false,
      attachmentIds: [],
      preview: boundedPreview(textValue(entry.summary) || toolName),
      detailState: 'available' as const,
      ...(failed ? { errorMessage: boundedPreview(textValue(entry.error) || 'subtool failed') } : {})
    }]
  })
}

function summarize(records: TrajectoryRecord[]): TrajectorySummary {
  const requests = records.filter((record): record is TrajectoryRequestRecord => record.kind === 'llm_request')
  let inputTokens = 0; let outputTokens = 0; let reasoningTokens = 0
  let cacheReadTokens = 0; let cacheWriteTokens = 0; let totalDurationMs = 0
  let costUsd = 0; let costCny = 0; let valueEstimateUsd = 0; let valueEstimateCny = 0
  let ttftTotal = 0; let ttftCount = 0; let tpsTotal = 0; let tpsCount = 0
  for (const request of requests) {
    const usage = request.usage
    inputTokens += usage?.promptTokens ?? 0
    outputTokens += usage?.completionTokens ?? 0
    reasoningTokens += usage?.reasoningTokens ?? 0
    cacheReadTokens += usage?.cacheHitTokens ?? usage?.cachedTokens ?? 0
    cacheWriteTokens += usage?.cacheWriteTokens ?? 0
    totalDurationMs += request.durationMs ?? 0
    costUsd += usage?.costUsd ?? 0; costCny += usage?.costCny ?? 0
    valueEstimateUsd += usage?.valueEstimateUsd ?? 0; valueEstimateCny += usage?.valueEstimateCny ?? 0
    if (usage?.requestTtftMs !== undefined) { ttftTotal += usage.requestTtftMs; ttftCount += 1 }
    if (usage?.requestGenerationMs && usage.completionTokens > 0) {
      tpsTotal += usage.completionTokens / (usage.requestGenerationMs / 1_000); tpsCount += 1
    }
  }
  const cacheTotal = cacheReadTokens + Math.max(0, inputTokens - cacheReadTokens)
  return TrajectorySummarySchema.parse({
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    requestCount: requests.length,
    toolCount: records.filter((record) => record.kind === 'tool').length,
    runningCount: records.filter((record) => record.status === 'running').length,
    failedCount: records.filter((record) => record.status === 'failed').length,
    inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens,
    cacheHitRate: cacheTotal > 0 ? cacheReadTokens / cacheTotal : null,
    avgTtftMs: ttftCount ? ttftTotal / ttftCount : null,
    avgTokensPerSecond: tpsCount ? tpsTotal / tpsCount : null,
    totalDurationMs, costUsd, costCny, valueEstimateUsd, valueEstimateCny,
    lastStatus: requests[0]?.status ?? null
  })
}

function matchesFilter(record: TrajectoryRecord, filter: TrajectoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'llm') return record.kind === 'llm_request' || record.kind === 'assistant'
  if (filter === 'tool') return record.kind === 'tool'
  return record.status === 'failed' || record.status === 'cancelled' || record.status === 'interrupted'
}

function matchesQuery(record: TrajectoryRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return JSON.stringify(record).slice(0, 16_384).toLowerCase().includes(normalized)
}

function beforeCursor(record: TrajectoryRecord, cursor: string | undefined): boolean {
  if (!cursor) return true
  const decoded = decodeCursor(cursor)
  if (!decoded) return true
  const byTime = record.startedAt.localeCompare(decoded.startedAt)
  return byTime < 0 || (byTime === 0 && record.id.localeCompare(decoded.id) < 0)
}

function encodeCursor(record: TrajectoryRecord): string {
  return Buffer.from(JSON.stringify({ v: 1, startedAt: record.startedAt, id: record.id }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { startedAt: string; id: string } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    return value.v === 1 && typeof value.startedAt === 'string' && typeof value.id === 'string'
      ? { startedAt: value.startedAt, id: value.id }
      : null
  } catch { return null }
}

function trajectoryStatus(trace: ModelRequestTraceRecord): TrajectoryStatus {
  if (trace.status === 'pending') return 'running'
  if (trace.status === 'cancelled') return 'cancelled'
  if (trace.status === 'interrupted') return 'interrupted'
  if (['transport_error', 'capture_error', 'failed', 'not_started'].includes(trace.status)) return 'failed'
  return trace.decoded?.error ? 'failed' : 'completed'
}

function latestRequestBefore(
  requests: TrajectoryRequestRecord[],
  turnId: string,
  timestamp: string
): TrajectoryRequestRecord | undefined {
  return requests
    .filter((request) => request.turnId === turnId && request.startedAt <= timestamp)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

function newestFirst(left: TrajectoryRecord, right: TrajectoryRecord): number {
  return right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)
}

function oldestTraceFirst(left: ModelRequestTraceRecord, right: ModelRequestTraceRecord): number {
  return left.startedAt.localeCompare(right.startedAt) || left.sequence - right.sequence
}

function itemPreview(item: TurnItem): string {
  if (item.kind === 'user_message' || item.kind === 'assistant_text' || item.kind === 'assistant_reasoning') return item.text
  if (item.kind === 'compaction') return item.summary
  if (item.kind === 'model_context') return item.text
  if (item.kind === 'runtime_context_source') return item.content
  return item.kind
}

function stringifyPreview(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function boundedPreview(value: string, max = TRAJECTORY_SEARCH_PREVIEW_BYTES): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 20))}… [truncated]`
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

function collectAttachmentIds(value: unknown): string[] {
  const found = new Set<string>()
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) return entry.forEach(visit)
    if (!isRecord(entry)) return
    for (const [key, child] of Object.entries(entry)) {
      if ((key === 'attachmentId' || key === 'attachment_id') && typeof child === 'string') {
        found.add(child)
      }
      visit(child)
    }
  }
  visit(value)
  return [...found]
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
