import { session } from 'electron'
import {
  isCustomModelEndpointFormat,
  normalizeModelEndpointFormat,
  ProviderProxyConfigurationError,
  resolveProviderProxyUrl,
  type AppSettingsV1,
  type ModelEndpointFormat
} from '../shared/app-settings'
import type { ModelProviderProbeRequest, ModelProviderProbeResult } from '../shared/kun-gui-api'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'
import { GROK_SUBSCRIPTION_MODEL_IDS } from '../shared/model-provider-presets'
import { fetchWithOptionalProxy } from './proxy-fetch'
import { CODEX_CLI_VERSION, codexRequestHeaders, isCodexOAuthCredentials, parseCodexCredentials } from './codex-auth'
import { parseCodexModelCatalog } from './codex-model-catalog'
import {
  ensureFreshGrokCredentials,
  isGrokOAuthCredentials,
  parseGrokCredentials
} from './grok-auth'
import { logWarn } from './logger'

function isCodexBaseUrl(url: string): boolean {
  return hasExpectedHttpsHost(url, 'chatgpt.com') && new URL(url).pathname.startsWith('/backend-api/codex')
}

function isGrokSubscriptionBaseUrl(url: string): boolean {
  return hasExpectedHttpsHost(url, 'cli-chat-proxy.grok.com')
}

function hasExpectedHttpsHost(url: string, host: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === host
  } catch {
    return false
  }
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

export async function fetchProviderProbe(
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
): Promise<Response> {
  // Keep the probe on the same transport as real model requests. Otherwise a
  // Chromium/system-proxy success can hide that the Node-based Kun runtime is
  // still unable to reach the provider.
  return fetchWithOptionalProxy(input, init, proxyUrl)
}

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
  fetcher: ProviderProbeFetch = fetchProviderProbe
): Promise<ModelProviderProbeResult> {
  const baseUrl = request.baseUrl.trim()
  let proxyUrl = ''
  if (settings) {
    const stored = settings.provider.providers.find((provider) => provider.id === request.providerId)
    try {
      proxyUrl = resolveProviderProxyUrl(settings, {
        id: request.providerId,
        kind: stored?.kind ?? 'http',
        useProxy: request.useProxy
      })
    } catch (error) {
      if (error instanceof ProviderProxyConfigurationError) {
        return {
          ok: false,
          message: 'This provider selected the app proxy, but its global proxy configuration is invalid. Open Global network proxy and correct it.'
        }
      }
      throw error
    }
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, message: 'Base URL must start with http:// or https://.' }
  }
  let codexHeaders: Record<string, string> | undefined
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
    codexHeaders = {
      Accept: 'application/json',
      ...codexRequestHeaders(creds),
      Authorization: `Bearer ${creds.accessToken}`
    }
  }
  if (isGrokSubscriptionBaseUrl(baseUrl)) {
    const rawKey = request.apiKey.trim()
    if (!rawKey) {
      return { ok: false, message: 'Grok 订阅未登录，请先点击「登录 Grok」。' }
    }
    if (!isGrokOAuthCredentials(rawKey)) {
      return { ok: false, message: 'Grok 订阅凭据格式无效，请重新登录。' }
    }
    const fresh = await ensureFreshGrokCredentials(rawKey, { fetcher, proxyUrl })
    const creds = fresh.credentials ?? parseGrokCredentials(fresh.apiKey)
    if (!creds) {
      return { ok: false, message: 'Grok 订阅凭据已损坏，请重新登录。' }
    }
    if (creds.expiresAt < Date.now()) {
      return { ok: false, message: 'Grok 订阅凭据已过期，请重新登录。' }
    }
    return { ok: true, latencyMs: 0, modelIds: [...GROK_SUBSCRIPTION_MODEL_IDS] }
  }
  const endpointFormat = normalizeModelEndpointFormat(request.endpointFormat)
  if (!codexHeaders && isCustomModelEndpointFormat(endpointFormat)) {
    return {
      ok: false,
      message: 'Custom full endpoint mode does not support /models probing. Add model IDs manually.'
    }
  }
  const url = codexHeaders
    ? `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`
    : upstreamOpenAiModelsUrl(baseUrl)
  const headers = codexHeaders ?? providerProbeHeaders(endpointFormat, request.apiKey)
  const startedAt = Date.now()
  let res: Response
  let text: string
  try {
    res = await fetcher(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    }, proxyUrl)
    const body = await readBoundedResponseText(res, MAX_MODEL_LIST_RESPONSE_BYTES)
    if (body.truncated) {
      return { ok: false, message: `Model list response exceeded the ${MAX_MODEL_LIST_RESPONSE_BYTES} byte limit.` }
    }
    text = body.text
  } catch (e) {
    const message = providerProbeFailureMessage(e, url)
    logWarn('provider-probe', 'Provider model discovery failed.', {
      requestUrl: url,
      usingConfiguredProxy: Boolean(proxyUrl),
      message: describeProviderProbeError(e)
    })
    if (!proxyUrl) {
      const systemProxyUrl = await resolveElectronSystemProxyUrl(url)
      if (
        systemProxyUrl &&
        await providerReachable(url, headers, fetcher, systemProxyUrl)
      ) {
        return { ok: false, message, suggestedProxyUrl: systemProxyUrl }
      }
    }
    return { ok: false, message }
  }
  const latencyMs = Date.now() - startedAt
  if (!res.ok) {
    return { ok: false, message: `${url} responded ${res.status}: ${text.slice(0, 300)}` }
  }
  if (codexHeaders) {
    try {
      return { ok: true, latencyMs, ...parseCodexModelCatalog(text) }
    } catch {
      return { ok: false, message: 'Codex returned an invalid model catalog.' }
    }
  }
  return { ok: true, latencyMs, modelIds: parseModelIds(text) }
}

function providerProbeFailureMessage(error: unknown, url: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `Request to ${url} timed out after ${PROBE_TIMEOUT_MS / 1_000}s.`
  }
  return `Request to ${url} failed: ${describeProviderProbeError(error)}`
}

/** Flatten Node fetch causes and Chromium/Node AggregateErrors for actionable UI output. */
export function describeProviderProbeError(error: unknown): string {
  const pending: unknown[] = [error]
  const parts: string[] = []
  for (let depth = 0; depth < 10 && pending.length > 0; depth += 1) {
    const current = pending.shift()
    if (current instanceof AggregateError) {
      const message = current.message.trim()
      if (message) parts.push(message)
      pending.unshift(...current.errors)
      continue
    }
    if (!(current instanceof Error)) {
      if (current != null) parts.push(String(current))
      continue
    }
    const code = (current as { code?: unknown }).code
    const codeText = typeof code === 'string' ? code : ''
    const message = current.message.trim()
    if (message) {
      parts.push(codeText && !message.includes(codeText) ? `${message} (${codeText})` : message)
    } else if (codeText) {
      parts.push(codeText)
    }
    if (current.cause != null) pending.push(current.cause)
  }
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.join(': ') || 'unknown network error'
}

async function providerReachable(
  url: string,
  headers: Record<string, string>,
  fetcher: ProviderProbeFetch,
  proxyUrl: string
): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(DIRECT_PROBE_TIMEOUT_MS)
    }, proxyUrl)
    await response.body?.cancel().catch(() => undefined)
    return true
  } catch {
    return false
  }
}

export async function resolveElectronSystemProxyUrl(url: string): Promise<string> {
  try {
    const rules = await session.defaultSession.resolveProxy(url)
    for (const entry of rules.split(';')) {
      const [kind = '', target = ''] = entry.trim().split(/\s+/, 2)
      if (!target || kind.toUpperCase() === 'DIRECT') continue
      const protocol = kind.toUpperCase() === 'HTTPS'
        ? 'https:'
        : kind.toUpperCase() === 'SOCKS' || kind.toUpperCase() === 'SOCKS5'
          ? 'socks5:'
          : kind.toUpperCase() === 'SOCKS4'
            ? 'socks4:'
            : kind.toUpperCase() === 'PROXY'
              ? 'http:'
              : ''
      if (!protocol) continue
      const candidate = new URL(`${protocol}//${target}`)
      if (!candidate.hostname || !candidate.port) continue
      return candidate.toString()
    }
  } catch (error) {
    logWarn('provider-probe', 'Failed to resolve the desktop system proxy.', {
      requestUrl: url,
      message: describeProviderProbeError(error)
    })
  }
  return ''
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
