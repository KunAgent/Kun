import type { ModelStreamChunk } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { isCustomModelEndpointFormat, modelEndpointPath, type ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import { DEFAULT_MODEL_STREAM_LIMITS, ModelStreamResourceBudget, ModelStreamResourceLimitError, type ModelStreamLimits } from './model-stream-resource-budget.js'
import type { ChatCompletionResponse, ChatMessage, StreamReadResult } from './compat-model-types.js'

export function mergeStreamFinishReason(current: string | null, next: string): string {
  if (current && current !== 'stop' && next === 'stop') return current
  return next
}

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 450_000

export function isCodexEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    return url.protocol === 'https:' &&
      url.hostname === 'chatgpt.com' &&
      url.pathname.replace(/\/+$/u, '').startsWith('/backend-api/codex')
  } catch {
    return false
  }
}

export function normalizeCodexResponsesUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim())
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'chatgpt.com' ||
      !url.pathname.replace(/\/+$/u, '').startsWith('/backend-api/codex')
    ) {
      return exactModelEndpointUrl(baseUrl)
    }
    url.pathname = '/backend-api/codex/responses'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return exactModelEndpointUrl(baseUrl)
  }
}

export function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCodexEndpoint(baseUrl)) return normalizeCodexResponsesUrl(baseUrl)
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${normalized.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (/^v\d+$/.test(lastSegment)) {
    return `${normalized}/${path}`
  }
  return `${normalized}/v1/${path}`
}

export function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}


export function buildChatCompletionsUrl(baseUrl: string): string {
  return buildModelEndpointUrl(baseUrl, 'chat_completions')
}

export function modelPayloadError(payload: Record<string, unknown>): { message: string; code?: string } | null {
  const rawError = payload.error
  if (typeof rawError === 'string' && rawError.trim()) {
    return { message: rawError.trim() }
  }
  const directError = modelErrorObject(recordValue(payload, 'error'))
  if (directError) return directError
  const responseError = modelErrorObject(recordValue(recordValue(payload, 'response'), 'error'))
  if (responseError) return responseError
  const baseResp = recordValue(payload, 'base_resp') ?? recordValue(payload, 'baseResp')
  if (baseResp) {
    const code = errorCodeString(
      baseResp.status_code ?? baseResp.status ?? baseResp.code ?? baseResp.err_code
    )
    if (code && !successErrorCode(code)) {
      return {
        message:
          recordString(baseResp, 'status_msg') ||
          recordString(baseResp, 'message') ||
          recordString(baseResp, 'msg') ||
          `model provider error (${code})`,
        code
      }
    }
  }
  const topLevelCode = errorCodeString(payload.code ?? payload.type ?? payload.status_code ?? payload.err_code)
  const topLevelMessage =
    recordString(payload, 'message') ||
    recordString(payload, 'error_msg') ||
    recordString(payload, 'status_msg')
  if (topLevelCode && topLevelMessage && !successErrorCode(topLevelCode)) {
    return { message: topLevelMessage, code: topLevelCode }
  }
  return null
}

function modelErrorObject(error: Record<string, unknown> | null): { message: string; code?: string } | null {
  if (!error) return null
  const message =
    recordString(error, 'message') ||
    recordString(error, 'msg') ||
    recordString(error, 'status_msg') ||
    recordString(error, 'error_msg')
  const code = errorCodeString(error.code ?? error.type ?? error.status ?? error.status_code ?? error.err_code)
  if (message) return { message, ...(code ? { code } : {}) }
  if (code && !successErrorCode(code)) return { message: `model provider error (${code})`, code }
  return null
}

function errorCodeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function successErrorCode(code: string): boolean {
  const normalized = code.trim().toLowerCase()
  return normalized === '0' || normalized === 'ok' || normalized === 'success'
}

function recordValue(value: unknown, key?: string): Record<string, unknown> | null {
  const target = key === undefined
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : null
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as Record<string, unknown>
    : null
}

function recordString(value: unknown, key: string): string {
  const target = value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined
  return typeof target === 'string' ? target : ''
}

export function mergeUsageSnapshots(current: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  if (!current) return next
  const promptTokens = next.promptTokens || current.promptTokens
  const completionTokens = Math.max(next.completionTokens, current.completionTokens)
  const totalTokens = next.totalTokens > 0 && next.promptTokens > 0
    ? next.totalTokens
    : promptTokens + completionTokens
  return {
    ...current,
    ...next,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: Math.max(current.cachedTokens ?? 0, next.cachedTokens ?? 0),
    cacheHitTokens: Math.max(current.cacheHitTokens ?? 0, next.cacheHitTokens ?? 0),
    cacheMissTokens: Math.max(current.cacheMissTokens ?? 0, next.cacheMissTokens ?? 0),
    cacheHitRate: next.cacheHitRate ?? current.cacheHitRate,
    costUsd: next.costUsd ?? current.costUsd,
    costCny: next.costCny ?? current.costCny
  }
}

export function shouldRetryWithoutStreamUsage(
  status: number,
  text: string,
  body: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false
  if (!Object.prototype.hasOwnProperty.call(body, 'stream_options')) return false
  return /\b(stream_options|include_usage)\b/i.test(text)
}

export {
  shouldRetryWithoutSamplingParams,
  stripSamplingFromBody
} from './fixed-sampling.js'

export function reasoningFromMessage(message: ChatCompletionResponse['choices'][number]['message'] | undefined): string {
  if (!message) return ''
  const value = message.reasoning_content ??
    (message as ChatMessage & { reasoning?: unknown }).reasoning
  return typeof value === 'string' ? value : ''
}

export function normalizeStreamIdleTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(value)) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  return Math.max(0, Math.floor(value))
}

export function normalizeModelStreamLimits(input: Partial<ModelStreamLimits> | undefined): ModelStreamLimits {
  const normalize = (value: number | undefined, fallback: number): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.floor(value))
  }
  return {
    maxBufferBytes: normalize(input?.maxBufferBytes, DEFAULT_MODEL_STREAM_LIMITS.maxBufferBytes),
    maxFrameBytes: normalize(input?.maxFrameBytes, DEFAULT_MODEL_STREAM_LIMITS.maxFrameBytes),
    maxTotalBytes: normalize(input?.maxTotalBytes, DEFAULT_MODEL_STREAM_LIMITS.maxTotalBytes),
    maxFrames: normalize(input?.maxFrames, DEFAULT_MODEL_STREAM_LIMITS.maxFrames),
    maxOutputBytes: normalize(input?.maxOutputBytes, DEFAULT_MODEL_STREAM_LIMITS.maxOutputBytes),
    maxPendingToolCalls: normalize(input?.maxPendingToolCalls, DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolCalls),
    maxPendingToolArgumentBytes: normalize(
      input?.maxPendingToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolArgumentBytes
    ),
    maxTotalPendingToolArgumentBytes: normalize(
      input?.maxTotalPendingToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxTotalPendingToolArgumentBytes
    ),
    maxCompletedToolCalls: normalize(input?.maxCompletedToolCalls, DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolCalls),
    maxCompletedToolArgumentBytes: normalize(
      input?.maxCompletedToolArgumentBytes,
      DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolArgumentBytes
    )
  }
}

let modelTraceFailureWarned = false

export function ignoreModelTraceFailure<T>(operation: () => T): T | undefined {
  try {
    return operation()
  } catch {
    warnModelTraceFailure()
    return undefined
  }
}

export function warnModelTraceFailure(): void {
  if (modelTraceFailureWarned) return
  modelTraceFailureWarned = true
  console.warn('[kun:model] model request observability capture failed; the provider request continues unchanged')
}

export type LimitedResponseJson =
  | { kind: 'ok'; value: unknown }
  | { kind: 'limit'; maxBytes: number }
  | { kind: 'invalid_json'; message: string }

/** Read an HTTP body without delegating an unbounded response to Response.text/json. */
export async function readLimitedResponseText(response: Response, maxBytes: number): Promise<{ text: string; exceeded: boolean }> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel('model response body limit exceeded').catch(() => {})
    return { text: '', exceeded: true }
  }
  if (!response.body) return { text: '', exceeded: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        void reader.cancel('model response body limit exceeded').catch(() => {})
        return { text: parts.join(''), exceeded: true }
      }
      const text = decoder.decode(value, { stream: true })
      if (text) parts.push(text)
    }
    const tail = decoder.decode()
    if (tail) parts.push(tail)
    return { text: parts.join(''), exceeded: false }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Best effort; cancellation or a completed reader may already release it.
    }
  }
}

export async function readLimitedResponseJson(response: Response, maxBytes: number): Promise<LimitedResponseJson> {
  const body = await readLimitedResponseText(response, maxBytes)
  if (body.exceeded) return { kind: 'limit', maxBytes }
  try {
    return { kind: 'ok', value: JSON.parse(body.text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'invalid_json', message }
  }
}

export function* enforceNonStreamingLimits(
  chunks: Iterable<ModelStreamChunk>,
  limits: ModelStreamLimits
): Generator<ModelStreamChunk> {
  const budget = new ModelStreamResourceBudget(limits)
  try {
    for (const chunk of chunks) {
      if (chunk.kind === 'tool_call_complete') {
        budget.completeToolCall(JSON.stringify(chunk.arguments) ?? '{}')
      }
      budget.addOutput([chunk])
      yield chunk
    }
  } catch (error) {
    if (error instanceof ModelStreamResourceLimitError) {
      yield { kind: 'error', message: error.message, code: 'stream_resource_limit' }
      return
    }
    throw error
  }
}

export function isRecoverableStreamTransportError(
  chunk: ModelStreamChunk
): chunk is Extract<ModelStreamChunk, { kind: 'error' }> {
  return chunk.kind === 'error' && (
    chunk.code === 'stream_read_error' ||
    chunk.code === 'stream_truncated' ||
    chunk.code === 'stream_idle_timeout'
  )
}

export async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number
): Promise<StreamReadResult> {
  if (signal.aborted) return { kind: 'aborted' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanupAbort: (() => void) | undefined
  const readPromise = reader.read()
    .then((result): StreamReadResult => ({ kind: 'chunk', ...result }))
    .catch((error): StreamReadResult => {
      if (signal.aborted) return { kind: 'aborted' }
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', message: `model stream read failed: ${message}` }
    })
  const abortPromise = new Promise<StreamReadResult>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    if (signal.aborted) {
      resolve({ kind: 'aborted' })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupAbort = () => signal.removeEventListener('abort', onAbort)
  })
  const candidates: Array<Promise<StreamReadResult>> = [readPromise, abortPromise]
  if (idleTimeoutMs > 0) {
    candidates.push(new Promise<StreamReadResult>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), idleTimeoutMs)
    }))
  }
  const result = await Promise.race(candidates)
  if (timeout) clearTimeout(timeout)
  cleanupAbort?.()
  if (result.kind === 'timeout') {
    // A custom stream may never resolve `cancel()`. Fire-and-forget it so an
    // idle timeout remains a real deadline rather than another await point.
    void reader.cancel('model stream idle timeout').catch(() => {})
  }
  return result
}
