import type { TurnItem } from '../contracts/items.js'
import type { ModelRequestTraceRecord } from '../contracts/model-request-trace.js'
import {
  TRAJECTORY_SCHEMA_VERSION,
  TrajectoryDetailSchema,
  type TrajectoryDetail,
  type TrajectoryDetailSection,
  type TrajectoryMessageRecord,
  type TrajectoryRecord,
  type TrajectoryRequestRecord
} from '../contracts/trajectory.js'
import type { LlmDebugRecorder } from './llm-debug-recorder.js'
import {
  projectMessageRawDetail,
  projectMessageRenderedDetail,
  projectMessageSourceDetail
} from './trajectory-query-message-detail.js'

type DetailInput = {
  recorder: LlmDebugRecorder
  threadId: string
  record: TrajectoryRecord
  trace: ModelRequestTraceRecord | undefined
  section: TrajectoryDetailSection
  items: TurnItem[]
  traces: ModelRequestTraceRecord[]
  requests: TrajectoryRequestRecord[]
}

export async function resolveTrajectoryDetail(input: DetailInput): Promise<TrajectoryDetail> {
  const { record, section } = input
  const base = {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    recordId: record.id,
    section,
    state: record.detailState,
    truncated: record.detailState === 'truncated'
  }
  if (section === 'overview' || (section === 'raw' && record.kind === 'llm_request')) {
    return TrajectoryDetailSchema.parse({
      ...base,
      content: section === 'raw' ? record : overview(record)
    })
  }
  const resolved = record.kind === 'llm_request'
    ? await requestDetail(input, base)
    : await itemDetail(input, base)
  return TrajectoryDetailSchema.parse(resolved)
}

async function requestDetail(
  input: DetailInput,
  base: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { recorder, threadId, record, trace, section, items, requests } = input
  if (record.kind !== 'llm_request') return base
  if (section === 'usage') return { ...base, content: record.usage ?? null }
  if (section === 'timing') return { ...base, content: timing(record) }
  if (section === 'output' || section === 'result') {
    return {
      ...base,
      state: 'available',
      content: items
        .filter((item) => outputItem(item) && requestOwnsItem(requests, record, item))
        .map(publicItemDetail)
    }
  }
  if (section === 'options') {
    const captured = trace?.manifestId
      ? await recorder.loadPromptManifestContent(threadId, trace.manifestId)
      : null
    return { ...base, content: captured?.parts.filter((part) => part.kind === 'config') ?? [] }
  }
  if (section !== 'input' && section !== 'arguments') return base
  if (trace?.manifestId) {
    const captured = await recorder.loadPromptManifestContent(threadId, trace.manifestId)
    if (captured) {
      const truncated = captured.parts.some((part) => part.truncated)
      return {
        ...base,
        state: truncated ? 'truncated' : 'available',
        truncated,
        content: { manifest: captured.manifest, parts: captured.parts }
      }
    }
    return { ...base, state: 'evicted', warning: 'captured prompt detail was evicted' }
  }
  if (trace?.request?.body && trace.request.body.originalBytes > 0) {
    return { ...base, state: 'legacy', content: legacyBody(trace.request.body.text) }
  }
  return { ...base, state: 'not_captured', warning: 'complete request content was not captured' }
}

async function itemDetail(
  input: DetailInput,
  base: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { recorder, threadId, record, section, items, traces, requests } = input
  if (record.kind === 'llm_request') return base
  if (section === 'timing') return { ...base, content: timing(record) }
  const itemIds = 'itemId' in record
    ? [...new Set([record.itemId, ...record.itemIds])]
    : [record.argumentsItemId, record.resultItemId]
  const selected = items.filter((item) => itemIds.includes(item.id)).map(publicItemDetail)
  if (section === 'usage') return { ...base, content: null }
  const parentRequest = record.parentRequestId
    ? requests.find((request) => request.requestId === record.parentRequestId)
    : undefined
  const trace = parentRequest
    ? traces.find((candidate) => candidate.id === parentRequest.requestId)
    : undefined
  const captured = trace?.manifestId
    ? await recorder.loadPromptManifestContent(threadId, trace.manifestId)
    : null
  if (record.kind === 'system') {
    if (section === 'system-prompt') {
      return { ...base, content: captured?.parts.filter((part) => part.kind === 'system') ?? null }
    }
    if (section === 'tools') {
      return { ...base, content: captured?.parts.filter((part) => part.kind === 'tools') ?? null }
    }
    if (section === 'diff') {
      const previous = record.previousPromptFingerprint
        ? requests.find((request) => request.promptFingerprint === record.previousPromptFingerprint)
        : undefined
      const previousTrace = previous
        ? traces.find((candidate) => candidate.id === previous.requestId)
        : undefined
      const previousCaptured = previousTrace?.manifestId
        ? await recorder.loadPromptManifestContent(threadId, previousTrace.manifestId)
        : null
      return {
        ...base,
        content: {
          previous: previousCaptured?.parts ?? [],
          current: captured?.parts ?? []
        }
      }
    }
  }
  if (isMessageRecord(record)) {
    if (section === 'raw') return { ...base, ...projectMessageRawDetail(record, items, requests) }
    if (section === 'rendered') return { ...base, ...projectMessageRenderedDetail(record, items) }
    if (section === 'source') return { ...base, ...projectMessageSourceDetail(record, items) }
  }
  if ((record.kind === 'tool' || record.kind === 'subtool') && section === 'schema') {
    return { ...base, content: findToolSchema(captured?.parts ?? [], record.toolName) }
  }
  if (record.kind === 'subtool' && section === 'arguments') {
    return { ...base, content: record.argumentPreview }
  }
  if (record.kind === 'subtool' && section === 'result') {
    return { ...base, content: record.resultPreview || record.errorMessage || null }
  }
  if (record.kind === 'tool' && section === 'arguments') {
    return { ...base, content: selected.filter((item) => isItemKind(item, 'tool_call')) }
  }
  if (record.kind === 'tool' && section === 'result') {
    return { ...base, content: selected.filter((item) => isItemKind(item, 'tool_result')) }
  }
  return { ...base, state: 'available', content: selected }
}

function isMessageRecord(record: TrajectoryRecord): record is TrajectoryMessageRecord {
  return record.kind === 'system' || record.kind === 'user' || record.kind === 'context' ||
    record.kind === 'compacted' || record.kind === 'assistant'
}

function requestOwnsItem(
  requests: TrajectoryRequestRecord[],
  request: TrajectoryRequestRecord,
  item: TurnItem
): boolean {
  return latestRequestBefore(requests, item.turnId, item.createdAt)?.requestId === request.requestId
}

function latestRequestBefore(
  requests: TrajectoryRequestRecord[],
  turnId: string,
  timestamp: string
): TrajectoryRequestRecord | undefined {
  return requests
    .filter((request) => request.turnId === turnId && request.startedAt <= timestamp)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
}

function outputItem(item: TurnItem): boolean {
  return item.kind === 'assistant_text' || item.kind === 'assistant_reasoning' ||
    item.kind === 'tool_call' || item.kind === 'tool_result'
}

function publicItemDetail(item: TurnItem): unknown {
  if (item.kind === 'tool_result') {
    return { ...item, output: boundedPreview(stringifyPreview(item.output), 16_384) }
  }
  if (item.kind === 'tool_call') {
    return { ...item, arguments: boundedPreview(stringifyPreview(item.arguments), 16_384) }
  }
  return item
}

function overview(record: TrajectoryRecord): unknown {
  const { preview: _preview, ...rest } = record
  return rest
}

function timing(record: TrajectoryRecord): unknown {
  return {
    startedAt: record.startedAt,
    firstTokenAt: record.firstTokenAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    ttftMs: record.firstTokenAt ? elapsed(record.startedAt, record.firstTokenAt) : undefined
  }
}

function legacyBody(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return value }
}

function findToolSchema(parts: Array<{ kind: string; content: unknown }>, toolName: string): unknown {
  for (const part of parts) {
    if (part.kind !== 'tools') continue
    for (const tool of Array.isArray(part.content) ? part.content : []) {
      if (!isRecord(tool)) continue
      const nested = isRecord(tool.function) ? tool.function : tool
      if (nested.name === toolName) return tool
    }
  }
  return null
}

function stringifyPreview(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function boundedPreview(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 20))}… [truncated]`
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isItemKind(value: unknown, kind: 'tool_call' | 'tool_result'): boolean {
  return isRecord(value) && value.kind === kind
}
