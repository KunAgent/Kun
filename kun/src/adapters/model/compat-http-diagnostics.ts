import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import { isDeepSeekHost, probeDeepSeekReachable } from './model-error-probe.js'
import type { ModelFailureMetadata } from '../../contracts/model-route-pool.js'

export function buildCompatRequestHeaders(input: {
  apiKey: string
  configuredHeaders?: Record<string, string>
  stream: boolean
  endpointFormat: ModelEndpointFormat
  responsesLite?: boolean
}): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!input.stream) headers.Accept = 'application/json'
  if (input.apiKey) {
    headers.Authorization = `Bearer ${input.apiKey}`
    if (input.endpointFormat === 'messages') {
      headers['x-api-key'] = input.apiKey
      headers['anthropic-version'] = '2023-06-01'
    }
  }
  return {
    ...headers,
    ...(input.configuredHeaders ?? {}),
    ...(input.responsesLite ? { 'x-openai-internal-codex-responses-lite': 'true' } : {})
  }
}

export async function classifyCompatHttpError(input: {
  status: number
  text: string
  baseUrl: string
  fetchImpl: typeof fetch
  retryAfter?: string | null
}): Promise<{ message: string; code: string; failure: ModelFailureMetadata }> {
  const body = summarizeHttpErrorBody(input.text)
  const providerCode = providerErrorCode(input.text)
  const retryAfterMs = parseRetryAfterMs(input.retryAfter)
  const failure = failureForHttpStatus(input.status, providerCode, retryAfterMs)
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

function failureForHttpStatus(status: number, providerCode?: string, retryAfterMs?: number): ModelFailureMetadata {
  const category = status === 401 || status === 403
    ? 'authentication'
    : status === 402
      ? 'quota'
      : status === 404
        ? 'model_not_found'
        : status === 408
          ? 'timeout'
          : status === 429
            ? 'rate_limit'
            : status >= 500
              ? 'unavailable'
              : status === 400 || status === 413 || status === 422
                ? 'request'
                : 'unknown'
  return {
    category,
    responseReceived: true,
    httpStatus: status,
    ...(providerCode ? { providerCode } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    failoverAllowed: status === 401 || status === 402 || status === 403 || status === 404 || status === 408 || status === 425 || status === 429 || status >= 500
  }
}

function providerErrorCode(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown }; code?: unknown }
    const code = parsed?.error?.code ?? parsed?.code
    return typeof code === 'string' || typeof code === 'number' ? String(code).slice(0, 128) : undefined
  } catch {
    return undefined
  }
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_600_000, Math.round(seconds * 1_000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(3_600_000, date - Date.now())) : undefined
}

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
