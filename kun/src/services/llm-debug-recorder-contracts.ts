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

/** Legacy round projection retained for `/v1/debug/llm-rounds`. */
export type LlmDebugRound = {
  id: number
  roundId: string
  step: number
  purpose: 'assistant' | 'retry' | 'resume' | 'compaction' | 'subagent' | 'title'
  captureContent: boolean
  threadId: string
  turnId: string
  provider: string
  model: string
  url: string
  startedAt: string
  finishedAt: string
  durationMs: number
  requestBody: Record<string, unknown> | null
  requestBodyTruncated?: boolean
  requestBodyOriginalBytes?: number
  output: LlmDebugOutput
  retainedBytes?: number
  exchanges: ModelRequestTraceRecord[]
}

export type LlmDebugToolCall = {
  callId: string
  toolName: string
  arguments: Record<string, unknown>
}

export type LlmDebugToolResult = {
  callId: string
  toolName: string
  output: string
  isError: boolean
}

export type LlmDebugOutputTruncation = Partial<Record<
  'text' | 'reasoning' | 'toolCalls' | 'toolResults' | 'usage' | 'stopReason' | 'error',
  true
>>

export type LlmDebugOutput = {
  text: string
  reasoning: string
  toolCalls: LlmDebugToolCall[]
  toolResults: LlmDebugToolResult[]
  usage?: UsageSnapshot
  stopReason?: string
  error?: string
  truncated?: LlmDebugOutputTruncation
}

export type LlmDebugRoundMeta = {
  threadId: string
  turnId: string
  provider: string
  model: string
  roundId?: string
  step?: number
  purpose?: LlmDebugRound['purpose']
  /** Resolved once at request start; metadata is recorded even when false. */
  captureContent?: boolean
  toolCatalog?: readonly ModelRequestTraceToolCatalogEntry[]
  /** Exact model-only values that must never enter retained request traces. */
  redactedRequestValues?: readonly string[]
}

export type LlmHttpAttemptReason = ModelRequestTraceRecord['attemptReason']

export type LlmHttpAttemptMeta = {
  endpointFormat: string
  attempt: number
  reason: LlmHttpAttemptReason
  url: string
  headers: Record<string, string>
  bodyText: string
  secretValues?: readonly string[]
  /** Pipeline stage; defaults to `model` for existing callers. */
  phase?: ModelRequestTracePhase
  failureOrigin?: ModelRequestTraceFailureOrigin
  /** Stable failure code, e.g. `gemini_cli_setup_failed`. */
  diagnosticCode?: string
}

export type LlmCliInvocationMeta = {
  endpointFormat: string
  target: string
  bodyText: string
  delegated?: ModelRequestTraceDelegated
  phase?: ModelRequestTracePhase
}

export type LlmSdkInvocationMeta = {
  endpointFormat: string
  target: string
  bodyText: string
  secretValues?: readonly string[]
  delegated?: ModelRequestTraceDelegated
  phase?: ModelRequestTracePhase
}

/**
 * A structured failure that happened *before* any transport was attempted —
 * for example a locally unavailable credential or an invalid provider setup.
 * It produces a `not_started` trace record with no fabricated URL/headers/body,
 * so the Agent Perspective can truthfully show "no model request was made".
 */
export type LlmPhaseDiagnosticMeta = {
  phase: ModelRequestTracePhase
  failureOrigin: ModelRequestTraceFailureOrigin
  /** Stable machine-readable failure code, e.g. `gemini_cli_login_required`. */
  code: string
  message: string
  /** Exact values that must never enter the retained diagnostic. */
  secretValues?: readonly string[]
}

/** Narrow sink used by model clients to retain bounded debug data. */
export interface LlmDebugSink {
  shouldCapture?(threadId: string): boolean | Promise<boolean>
  start(meta: LlmDebugRoundMeta): LlmDebugRound
  beginHttpAttempt(round: LlmDebugRound, meta: LlmHttpAttemptMeta): ModelRequestTraceRecord
  beginCliInvocation(round: LlmDebugRound, meta: LlmCliInvocationMeta): ModelRequestTraceRecord
  beginSdkInvocation?(round: LlmDebugRound, meta: LlmSdkInvocationMeta): ModelRequestTraceRecord
  recordPhaseDiagnostic?(round: LlmDebugRound, meta: LlmPhaseDiagnosticMeta): ModelRequestTraceRecord
  captureHttpResponse(round: LlmDebugRound, record: ModelRequestTraceRecord, response: Response): void
  captureHttpError(record: ModelRequestTraceRecord, error: unknown): void
  captureTransportError(record: ModelRequestTraceRecord, error: unknown): void
  captureChunk(round: LlmDebugRound, chunk: ModelStreamChunk): void
  captureToolResult?(round: LlmDebugRound, result: LlmDebugToolResult): void
  finish(round: LlmDebugRound): Promise<void>
}

export type LlmDebugRecorderLimits = {
  capacity: number
  maxRequestBodyBytes: number
  maxResponseBodyBytes: number
  maxRoundBytes: number
  maxTotalBytes: number
  maxPageSize: number
}

export const DEFAULT_LLM_DEBUG_RECORDER_LIMITS: LlmDebugRecorderLimits = {
  capacity: 25,
  maxRequestBodyBytes: 4 * 1024 * 1024,
  maxResponseBodyBytes: 4 * 1024 * 1024,
  maxRoundBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPageSize: MAX_MODEL_REQUEST_TRACE_PAGE_SIZE
}

export type LlmDebugRecorderOptions = Partial<LlmDebugRecorderLimits> & {
  dataDir?: string
  shouldCapture?: (threadId: string) => boolean | Promise<boolean>
}

export type CaptureState = {
  requestBytes: number
  outputBytes: number
  toolCatalog: ModelRequestTraceToolCatalogEntry[]
  redactedRequestValues: string[]
  text: StringBlockAccumulator
  reasoning: StringBlockAccumulator
  pendingCaptures: Promise<void>[]
  lastCheckpointAt: number
}

export type StringBlockAccumulator = { blocks: string[]; parts: string[] }

export const DEBUG_TEXT_BLOCK_FRAGMENT_WINDOW = 256
