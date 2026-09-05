import { randomUUID } from 'node:crypto'
import type { UsageSnapshot } from '../contracts/usage.js'
import { redactBrowserUseActionForPersistence } from '../contracts/browser-use.js'
import {
  MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH,
  MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH,
  MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES,
  MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH,
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  type ModelRequestTraceDecoded,
  type ModelRequestTraceDelegated,
  type ModelRequestTraceFailureOrigin,
  type ModelRequestTraceLimits,
  type ModelRequestTracePage,
  type ModelRequestTracePhase,
  type ModelRequestTraceRecord,
  type ModelRequestTraceToolCatalogEntry
} from '../contracts/model-request-trace.js'
import type { ModelStreamChunk } from '../ports/model-client.js'
import {
  BoundedModelTraceBodyAccumulator,
  boundedModelTraceText,
  redactModelTraceValues,
  sanitizeModelTraceHeaders,
  sanitizeModelTraceUrl
} from './model-request-trace-safety.js'
import {
  MAX_MODEL_REQUEST_TRACE_PAGE_SIZE,
  ModelRequestTraceStore
} from './model-request-trace-store.js'
import { type CaptureState, DEBUG_TEXT_BLOCK_FRAGMENT_WINDOW, type LlmDebugOutput, type LlmDebugOutputTruncation, type LlmDebugRound, type LlmDebugRoundMeta, type LlmDebugSink, type StringBlockAccumulator } from './llm-debug-recorder-contracts.js'

/**
 * Metadata is always retained. The policy is checked exactly once to decide
 * whether optional prompt/wire content may be captured for this round.
 */
export async function startLlmDebugRoundIfEnabled(
  sink: LlmDebugSink | undefined,
  meta: LlmDebugRoundMeta,
  onError?: () => void
): Promise<LlmDebugRound | undefined> {
  if (!sink) return undefined
  try {
    const captureContent = sink.shouldCapture
      ? await sink.shouldCapture(meta.threadId)
      : true
    return sink.start({ ...meta, captureContent })
  } catch {
    onError?.()
    return undefined
  }
}

export function createCaptureState(
  toolCatalog?: readonly ModelRequestTraceToolCatalogEntry[],
  redactedRequestValues?: readonly string[]
): CaptureState {
  return {
    requestBytes: 0,
    outputBytes: 0,
    toolCatalog: normalizeTraceToolCatalog(toolCatalog),
    redactedRequestValues: normalizeRedactedRequestValues(redactedRequestValues),
    text: { blocks: [], parts: [] },
    reasoning: { blocks: [], parts: [] },
    pendingCaptures: [],
    lastCheckpointAt: 0
  }
}

export function normalizeRedactedRequestValues(input: readonly string[] | undefined): string[] {
  if (!input?.length) return []
  return [...new Set(input.filter((value) => value.trim().length > 0))]
    .sort((left, right) => right.length - left.length)
}

export function normalizeTraceToolCatalog(
  input: readonly ModelRequestTraceToolCatalogEntry[] | undefined
): ModelRequestTraceToolCatalogEntry[] {
  if (!input?.length) return []
  const out: ModelRequestTraceToolCatalogEntry[] = []
  for (const entry of input.slice(0, MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES)) {
    const name = boundedCatalogValue(entry.name, MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH)
    if (!name) continue
    const providerKind = boundedCatalogValue(
      entry.providerKind,
      MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH
    )
    const providerId = boundedCatalogValue(
      entry.providerId,
      MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH
    )
    out.push({
      name,
      ...(providerKind ? { providerKind } : {}),
      ...(providerId ? { providerId } : {})
    })
  }
  return out
}

export function boundedCatalogValue(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

export function appendStringBlock(accumulator: StringBlockAccumulator, value: string): void {
  accumulator.parts.push(value)
  if (accumulator.parts.length < DEBUG_TEXT_BLOCK_FRAGMENT_WINDOW) return
  accumulator.blocks.push(accumulator.parts.join(''))
  accumulator.parts = []
}

export function joinStringBlocks(accumulator: StringBlockAccumulator): string {
  if (accumulator.parts.length === 0) return accumulator.blocks.join('')
  return [...accumulator.blocks, accumulator.parts.join('')].join('')
}

export function cloneDecoded(output: LlmDebugOutput): ModelRequestTraceDecoded {
  return {
    text: output.text,
    reasoning: output.reasoning,
    toolCalls: output.toolCalls.map((call) => ({ ...call, arguments: { ...call.arguments } })),
    ...(output.toolResults.length
      ? { toolResults: output.toolResults.map((result) => ({ ...result })) }
      : {}),
    ...(output.usage ? { usage: { ...output.usage } } : {}),
    ...(output.stopReason ? { stopReason: output.stopReason } : {}),
    ...(output.error ? { error: output.error } : {}),
    ...(output.truncated ? { truncated: { ...output.truncated } } : {})
  }
}

export function cloneDecodedLive(round: LlmDebugRound, state: CaptureState | undefined): ModelRequestTraceDecoded {
  if (!state) return cloneDecoded(round.output)
  return cloneDecoded({
    ...round.output,
    text: joinStringBlocks(state.text),
    reasoning: joinStringBlocks(state.reasoning)
  })
}

export function parseLegacyRequestBody(
  value: string,
  body: { truncated: boolean; originalBytes: number }
): Record<string, unknown> | null {
  if (body.truncated) return { __debugTruncated: true, originalBytes: body.originalBytes, jsonPrefix: value }
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed }
  } catch {
    return { __debugInvalidJson: true, raw: value }
  }
}

export function finishRecord(record: ModelRequestTraceRecord): void {
  const finishedAt = new Date().toISOString()
  record.finishedAt = finishedAt
  record.durationMs = elapsedMs(record.startedAt, finishedAt)
}

export function elapsedMs(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

export function addCaptureWarning(record: ModelRequestTraceRecord, warning: string): void {
  const warnings = record.captureWarnings ?? (record.captureWarnings = [])
  if (!warnings.includes(warning)) warnings.push(warning)
}

export function markTruncated(output: LlmDebugOutput, field: keyof LlmDebugOutputTruncation): void {
  const truncated = output.truncated ?? (output.truncated = {})
  truncated[field] = true
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback
}

export function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8') } catch { return 0 }
}

export function truncateJsonStringContent(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (jsonStringContentBytes(value) <= maxBytes) return value
  let low = 0
  let high = value.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prefix = safeStringPrefix(value, middle)
    if (jsonStringContentBytes(prefix) <= maxBytes) {
      best = prefix
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

export function jsonStringContentBytes(value: string): number {
  const serialized = JSON.stringify(value)
  return Buffer.byteLength(serialized.slice(1, -1), 'utf8')
}

export function safeStringPrefix(value: string, length: number): string {
  let end = Math.min(value.length, Math.max(0, length))
  if (end > 0) {
    const last = value.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) end -= 1
  }
  return value.slice(0, end)
}

export function redactBrowserUseDebugContent(value: string): string {
  const withoutImages = value.replace(
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi,
    'data:image/[redacted];base64,[redacted]'
  )
  try {
    const parsed = JSON.parse(withoutImages)
    return JSON.stringify(redactBrowserUseDebugValue(parsed, 0))
  } catch {
    return withoutImages
  }
}

export function redactBrowserUseDebugValue(value: unknown, depth: number): unknown {
  if (depth > 64) return '[redacted:depth-limit]'
  if (typeof value === 'string') {
    const withoutImages = value.replace(
      /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi,
      'data:image/[redacted];base64,[redacted]'
    )
    if (
      withoutImages.includes('browser_snapshot') ||
      withoutImages.includes('browser_screenshot') ||
      withoutImages.includes('"browser_use"')
    ) {
      try {
        const nested = JSON.parse(withoutImages)
        if (nested !== withoutImages) {
          return JSON.stringify(redactBrowserUseDebugValue(nested, depth + 1))
        }
      } catch {
        // Plain untrusted page text is retained only within the normal trace limit.
      }
    }
    return withoutImages
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactBrowserUseDebugValue(entry, depth + 1))
  }
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    output[key] = redactBrowserUseDebugValue(child, depth + 1)
  }
  if (record.kind === 'browser_screenshot') {
    delete output.images
    delete output.data_base64
    output.images_omitted = Array.isArray(record.images) ? record.images.length : 1
  }
  if (record.kind === 'browser_snapshot' && output.snapshot && typeof output.snapshot === 'object') {
    const snapshot = output.snapshot as Record<string, unknown>
    output.snapshot = {
      ...snapshot,
      title: '[redacted]',
      nodes: [],
      truncated: true
    }
  }
  if (record.name === 'browser_use' || record.toolName === 'browser_use') {
    if (typeof record.arguments === 'string') {
      try {
        output.arguments = JSON.stringify(
          redactBrowserUseActionForPersistence(JSON.parse(record.arguments))
        )
      } catch {
        output.arguments = '{"action":"invalid"}'
      }
    } else if (record.arguments !== undefined) {
      output.arguments = redactBrowserUseActionForPersistence(record.arguments)
    }
    if (record.input !== undefined) {
      output.input = redactBrowserUseActionForPersistence(record.input)
    }
  }
  return output
}

export function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_096)
}

export function newestRecordFirst(left: ModelRequestTraceRecord, right: ModelRequestTraceRecord): number {
  const timestamp = right.startedAt.localeCompare(left.startedAt)
  if (timestamp !== 0) return timestamp
  const sequence = right.sequence - left.sequence
  return sequence === 0 ? right.id.localeCompare(left.id) : sequence
}
