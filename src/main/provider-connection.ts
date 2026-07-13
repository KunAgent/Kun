import {
  isCustomModelEndpointFormat,
  normalizeModelEndpointFormat,
  resolveModelProviderProxyUrl,
  type AppSettingsV1,
  type ModelEndpointFormat
} from '../shared/app-settings'
import type { ModelProviderProbeRequest, ModelProviderProbeResult } from '../shared/kun-gui-api'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'
import { CHATGPT_SUBSCRIPTION_MODEL_IDS } from '../shared/model-provider-presets'
import { fetchWithOptionalProxy } from './proxy-fetch'
import { isCodexOAuthCredentials, parseCodexCredentials } from './codex-auth'

function isCodexBaseUrl(url: string): boolean {
  return url.includes('chatgpt.com/backend-api/codex')
}

const PROBE_TIMEOUT_MS = 10_000
const MAX_MODEL_LIST_RESPONSE_BYTES = 2_000_000
const MAX_MODEL_COUNT = 2_000
const MAX_MODEL_ID_LENGTH = 512
// The proxy-vs-direct diagnosis runs only after the proxied probe already
// failed, so it gets a shorter budget — we just need to learn whether the
// provider is reachable at all, not wait out another full timeout (which would
// make a failed test connection take up to 20s).
const DIRECT_PROBE_TIMEOUT_MS = 5_000
const ANTHROPIC_VERSION = '2023-06-01'

type ProviderProbeFetch = typeof fetchWithOptionalProxy

export function providerProbeHeaders(
  endpointFormat: ModelEndpointFormat,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const key = apiKey.trim()
  if (endpointFormat === 'messages') {
    headers['anthropic-version'] = ANTHROPIC_VERSION
    if (key) headers['x-api-key'] = key
    return headers
  }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

/**
 * Probe a model provider by listing its models endpoint. Runs in the main
 * process so the API key never leaves it and renderer CORS does not apply.
 */
export async function probeModelProvider(
  request: ModelProviderProbeRequest,
  settings?: AppSettingsV1,
  fetcher: ProviderProbeFetch = fetchWithOptionalProxy
): Promise<ModelProviderProbeResult> {
  const baseUrl = request.baseUrl.trim()
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, message: 'Base URL must start with http:// or https://.' }
  }
  if (isCodexBaseUrl(baseUrl)) {
    const rawKey = request.apiKey.trim()
    if (!rawKey) {
      return { ok: false, message: 'ChatGPT 订阅未登录，请先点击「登录 ChatGPT」。' }
    }
    if (!isCodexOAuthCredentials(rawKey)) {
      return { ok: false, message: 'ChatGPT 订阅凭据格式无效，请重新登录。' }
    }
    const creds = parseCodexCredentials(rawKey)
    if (!creds) {
      return { ok: false, message: 'ChatGPT 订阅凭据已损坏，请重新登录。' }
    }
    if (creds.expiresAt < Date.now()) {
      return { ok: false, message: 'ChatGPT 订阅凭据已过期，请重新登录。' }
    }
    return { ok: true, latencyMs: 0, modelIds: [...CHATGPT_SUBSCRIPTION_MODEL_IDS] }
  }
  const endpointFormat = normalizeModelEndpointFormat(request.endpointFormat)
  if (isCustomModelEndpointFormat(endpointFormat)) {
    return {
      ok: false,
      message: 'Custom full endpoint mode does not support /models probing. Add model IDs manually.'
    }
  }
  const url = upstreamOpenAiModelsUrl(baseUrl)
  const startedAt = Date.now()
  const proxyUrl = settings ? resolveModelProviderProxyUrl(settings) : ''
  let res: Response
  let text: string
  try {
    res = await fetcher(url, {
      method: 'GET',
      headers: providerProbeHeaders(endpointFormat, request.apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    }, proxyUrl)
    const body = await readBoundedResponseText(res, MAX_MODEL_LIST_RESPONSE_BYTES)
    if (body.truncated) {
      return { ok: false, message: `Model list response exceeded the ${MAX_MODEL_LIST_RESPONSE_BYTES} byte limit.` }
    }
    text = body.text
  } catch (e) {
    const message = providerProbeFailureMessage(e, url)
    if (proxyUrl && await directProviderReachable(url, endpointFormat, request.apiKey, fetcher)) {
      return {
        ok: false,
        message: `${message} The configured model-request proxy failed, but a direct connection reached the provider. Disable or update the proxy in Settings > Providers.`
      }
    }
    return { ok: false, message }
  }
  const latencyMs = Date.now() - startedAt
  if (!res.ok) {
    return { ok: false, message: `${url} responded ${res.status}: ${text.slice(0, 300)}` }
  }
  return { ok: true, latencyMs, modelIds: parseModelIds(text) }
}

function providerProbeFailureMessage(error: unknown, url: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `Request to ${url} timed out after ${PROBE_TIMEOUT_MS / 1_000}s.`
  }
  return error instanceof Error ? error.message : String(error)
}

async function directProviderReachable(
  url: string,
  endpointFormat: ModelEndpointFormat,
  apiKey: string,
  fetcher: ProviderProbeFetch
): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: providerProbeHeaders(endpointFormat, apiKey),
      signal: AbortSignal.timeout(DIRECT_PROBE_TIMEOUT_MS)
    }, '')
    await response.body?.cancel().catch(() => undefined)
    return true
  } catch {
    return false
  }
}

export function parseModelIds(body: string): string[] {
  if (body.length > MAX_MODEL_LIST_RESPONSE_BYTES) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    return []
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (() => {
          const record = parsed as { data?: unknown; models?: unknown }
          if (Array.isArray(record.data)) return record.data
          if (Array.isArray(record.models)) return record.models
          return []
        })()
      : []
  const ids = new Set<string>()
  for (const row of rows.slice(0, MAX_MODEL_COUNT)) {
    if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
      const id = (row as { id: string }).id.trim()
      if (id && id.length <= MAX_MODEL_ID_LENGTH) ids.add(id)
    }
  }
  return [...ids]
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return { text: '', truncated: true }
  }
  if (!response.body) {
    const text = await response.text()
    return { text, truncated: new TextEncoder().encode(text).byteLength > maxBytes }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { text: '', truncated: true }
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(bytes), truncated: false }
}
