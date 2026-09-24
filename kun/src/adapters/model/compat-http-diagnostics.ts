import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import { isDeepSeekHost, probeDeepSeekReachable } from './model-error-probe.js'
import type { ModelFailureMetadata } from '../../contracts/model-route-pool.js'
import { modelFailureMetadata, providerErrorCode, type FailureHeaderSource } from './failure-reason.js'

export function buildCompatRequestHeaders(input: {
  apiKey: string
  /** User-configured custom headers (overrides protocol defaults). */
  customHeaders?: Record<string, string>
  /** Protected credential/material headers (override custom headers). */
  protectedHeaders?: Record<string, string>
  /** Runtime-reserved identity headers (override everything but internal flags). */
  runtimeHeaders?: Record<string, string>
  stream: boolean
  endpointFormat: ModelEndpointFormat
  responsesLite?: boolean
}): Record<string, string> {
  const defaults: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!input.stream) defaults.Accept = 'application/json'
  if (input.apiKey) {
    defaults.Authorization = `Bearer ${input.apiKey}`
    if (input.endpointFormat === 'messages') {
      defaults['x-api-key'] = input.apiKey
      defaults['anthropic-version'] = '2023-06-01'
    }
  }
  const reserved: Record<string, string> = {
    ...(input.responsesLite ? { 'x-openai-internal-codex-responses-lite': 'true' } : {})
  }
  return mergeHeadersCaseInsensitive(
    defaults,
    input.customHeaders,
    input.protectedHeaders,
    input.runtimeHeaders,
    reserved
  )
}

/**
 * Merge header layers case-insensitively. A later layer replaces an earlier
 * key even when the casing differs (e.g. a user `authorization` overrides the
 * protocol default `Authorization`), so header identity never depends on how
 * the caller spelled the name.
 */
export function mergeHeadersCaseInsensitive(
  ...layers: (Record<string, string> | undefined)[]
): Record<string, string> {
  const out: Record<string, string> = {}
  const canonicalByLower = new Map<string, string>()
  for (const layer of layers) {
    if (!layer) continue
    for (const [rawKey, value] of Object.entries(layer)) {
      const lower = rawKey.toLowerCase()
      const existing = canonicalByLower.get(lower)
      if (existing !== undefined && existing !== rawKey) delete out[existing]
      out[rawKey] = value
      canonicalByLower.set(lower, rawKey)
    }
  }
  return out
}

export async function classifyCompatHttpError(input: {
  status: number
  text: string
  baseUrl: string
  fetchImpl: typeof fetch
  retryAfter?: string | null
  /** Full response headers enable *-ratelimit-reset-* parsing. */
  headers?: FailureHeaderSource
}): Promise<{ message: string; code: string; failure: ModelFailureMetadata }> {
  const body = summarizeHttpErrorBody(input.text)
  const providerCode = providerErrorCode(input.text)
  const headerSource = input.headers ?? retryAfterHeaderRecord(input.retryAfter)
  const failure = modelFailureMetadata({
    status: input.status,
    ...(providerCode ? { providerCode } : {}),
    body: input.text,
    headers: headerSource
  })
  if (input.status === 404) {
    const prefix = body ? `${body} ` : ''
    return {
      message: `model request failed with status 404: ${prefix}Check your model provider configuration, especially Base URL and Endpoint format.`,
      code: 'http_404',
      failure
    }
  }
  if (input.status === 429) {
    return { message: `model request was rate limited (HTTP 429): ${body}`, code: 'rate_limited', failure }
  }
  if (input.status >= 500 && isDeepSeekHost(input.baseUrl)) {
    const probe = await probeDeepSeekReachable({ baseUrl: input.baseUrl, fetchImpl: input.fetchImpl })
    return {
      message: `model request failed with DeepSeek HTTP ${input.status}: ${body} ${probe.message}`,
      code: probe.reachable ? `deepseek_http_${input.status}` : 'deepseek_unreachable',
      failure
    }
  }
  return {
    message: `model request failed with status ${input.status}: ${body}`,
    code: `http_${input.status}`,
    failure
  }
}

function retryAfterHeaderRecord(retryAfter: string | null | undefined): FailureHeaderSource {
  return retryAfter ? { 'retry-after': retryAfter } : undefined
}

export { providerErrorCode } from './failure-reason.js'

export function compatHttpFailureLog(input: {
  provider: string
  status: number
  model: string
  configuredModel: string
  baseUrl: string
  requestUrl: string
  endpointFormat: ModelEndpointFormat
  configuredEndpointFormat: ModelEndpointFormat
  body: string
}): Record<string, unknown> {
  return {
    provider: input.provider,
    status: input.status,
    model: input.model,
    configuredModel: input.configuredModel,
    baseUrl: redactUrlForLog(input.baseUrl),
    requestUrl: redactUrlForLog(input.requestUrl),
    endpointFormat: input.endpointFormat,
    configuredEndpointFormat: input.configuredEndpointFormat,
    responseBody: summarizeForLog(input.body)
  }
}

export function redactUrlForLog(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(key|token|secret|signature|auth|password)/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
      }
    }
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    // A malformed URL has no dependable authority/query boundaries. Logging
    // any fragment risks leaking userinfo or credentials, so fail closed.
    return '[invalid URL]'
  }
}

export function summarizeForLog(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 1_000 ? `${normalized.slice(0, 1_000)}...` : normalized
}

export function summarizeHttpErrorBody(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (/<html[\s>]/i.test(normalized)) {
    if (/Enable JavaScript and cookies to continue/i.test(normalized)) {
      return 'provider returned an HTML challenge page (Enable JavaScript and cookies to continue). Check provider authentication/session and Endpoint format.'
    }
    const title = /<title[^>]*>(.*?)<\/title>/i.exec(normalized)?.[1]?.trim()
    return title ? `provider returned an HTML response (${title})` : 'provider returned an HTML response'
  }
  return normalized.length > 1_000 ? `${normalized.slice(0, 1_000)}...` : normalized
}
