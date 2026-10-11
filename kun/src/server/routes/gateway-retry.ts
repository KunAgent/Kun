import type { ModelStreamChunk } from '../../ports/model-client.js'
import type { ModelFailureMetadata } from '../../contracts/model-route-pool.js'
import type { JsonResponse } from '../response.js'
import type { GatewayUsageStream } from './gateway-usage.js'

export const GATEWAY_BUSY_MESSAGE = 'Too many concurrent gateway requests; retry when one finishes. See GET /v1/kun/limit for this key\'s limits.'
/** A refused request may retry after this long when no better estimate exists (busy concurrency slots). */
export const GATEWAY_BUSY_RETRY_MS = 1_000
/** How long a stream may take to show whether local admission refused it before headers are sent. */
const ADMISSION_WAIT_MS = 1_500

/**
 * Headers telling a client when a refused request can succeed. `retry-after`
 * and `retry-after-ms` are the ones OpenAI and Anthropic SDKs already honor;
 * `x-kun-limit-reset` is the same instant as an ISO timestamp.
 */
export function gatewayRetryHeaders(retryAfterMs: number, now = Date.now()): Record<string, string> {
  const ms = Math.max(0, Math.ceil(retryAfterMs))
  return {
    'retry-after': String(Math.max(1, Math.ceil(ms / 1_000))),
    'retry-after-ms': String(ms),
    'x-kun-limit-reset': new Date(now + ms).toISOString()
  }
}

/** Retry headers for a model failure that says when it clears; none otherwise. */
export function failureRetryHeaders(failure: ModelFailureMetadata | undefined, now = Date.now()): Record<string, string> {
  if (!failure) return {}
  const reset = failure.resetAt ? Date.parse(failure.resetAt) : Number.NaN
  const after = Number.isFinite(reset) ? reset - now : failure.retryAfterMs
  return after !== undefined && Number.isFinite(after) ? gatewayRetryHeaders(after, now) : {}
}

/** Refusal text for a rate-limited key, with the wait and where to read its limits. */
export function rateLimitedMessage(retryAfterMs: number): string {
  return `Gateway rate limit exceeded; retry in ${Math.max(1, Math.ceil(retryAfterMs / 1_000))}s. See GET /v1/kun/limit for this key's limits.`
}

export function withResponseHeaders(response: JsonResponse, headers: Record<string, string>): JsonResponse {
  return Object.keys(headers).length ? { ...response, headers: { ...response.headers, ...headers } } : response
}

/**
 * Local admission (token budget, cost limit) refuses before any upstream
 * call. A streaming reply would otherwise commit to 200 first and carry the
 * refusal as an in-stream error, so the first chunk is awaited briefly: a
 * local refusal comes back as `refused`, and anything else, including a
 * slow upstream, continues as the original stream with nothing lost.
 */
export async function admitGatewayStream(chunks: GatewayUsageStream, signal: AbortSignal,
  waitMs = ADMISSION_WAIT_MS): Promise<{ refused: Extract<ModelStreamChunk, { kind: 'error' }> } | { chunks: GatewayUsageStream }> {
  const iterator = chunks[Symbol.asyncIterator]()
  const first = iterator.next()
  first.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopWaiting = (): void => undefined
  const settled = await Promise.race([
    first.then((result) => ({ result }), () => ({ result: undefined })),
    new Promise<null>((resolve) => {
      stopWaiting = () => resolve(null)
      timer = setTimeout(stopWaiting, waitMs)
      signal.addEventListener('abort', stopWaiting, { once: true })
    })
  ]).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', stopWaiting) })
  const chunk = settled?.result && !settled.result.done ? settled.result.value : undefined
  if (chunk?.kind === 'error' && chunk.failure?.localAdmission) {
    await iterator.return?.().catch(() => undefined)
    return { refused: chunk }
  }
  return { chunks: { finish: (outcome) => chunks.finish(outcome), [Symbol.asyncIterator]: () => replayFirst(iterator, first) } }
}

function replayFirst(iterator: AsyncIterator<ModelStreamChunk>, first: Promise<IteratorResult<ModelStreamChunk>>): AsyncIterator<ModelStreamChunk> {
  let pending: Promise<IteratorResult<ModelStreamChunk>> | undefined = first
  return {
    next: () => {
      const next = pending ?? iterator.next()
      pending = undefined
      return next
    },
    return: async (value?: unknown) => {
      pending = undefined
      return await iterator.return?.(value) ?? { done: true, value: undefined }
    },
    throw: async (error?: unknown) => {
      pending = undefined
      if (iterator.throw) return iterator.throw(error)
      throw error
    }
  }
}
