import {
  isCustomModelEndpointFormat,
  normalizeModelEndpointFormat,
  resolveModelProviderProxyUrl,
  type AppSettingsV1,
  type ModelEndpointFormat
} from '../shared/app-settings'
import type { ModelProviderProbeRequest, ModelProviderProbeResult } from '../shared/kun-gui-api'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'
import { fetchWithOptionalProxy } from './proxy-fetch'
import { isCodexOAuthCredentials, parseCodexCredentials } from './codex-auth'
import { isAnthropicOAuthCredentials, parseAnthropicCredentials } from './anthropic-auth'

const CODEX_FIXED_MODEL_IDS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']
function isCodexBaseUrl(url: string): boolean {
  return url.includes('chatgpt.com/backend-api/codex')
}

const ANTHROPIC_FIXED_MODEL_IDS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
function isAnthropicBaseUrl(url: string): boolean {
  return url.includes('api.anthropic.com')
}

const PROBE_TIMEOUT_MS = 10_000
const ANTHROPIC_VERSION = '2023-06-01'

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
  settings?: AppSettingsV1
): Promise<ModelProviderProbeResult> {
  const baseUrl = request.baseUrl.trim()
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, message: 'Base URL must start with http:// or https://.' }
  }
  if (isCodexBaseUrl(baseUrl)) {
    const rawKey = request.apiKey.trim()
    if (!rawKey) {
      return { ok: false, message: 'Codex 未登录，请先点击「登录 ChatGPT」。' }
    }
    if (!isCodexOAuthCredentials(rawKey)) {
      return { ok: false, message: 'Codex 凭据格式无效，请重新登录。' }
    }
    const creds = parseCodexCredentials(rawKey)
    if (!creds) {
      return { ok: false, message: 'Codex 凭据已损坏，请重新登录。' }
    }
    if (creds.expiresAt < Date.now()) {
      return { ok: false, message: 'Codex 凭据已过期，将在下次启动时自动刷新；或重新登录。' }
    }
    return { ok: true, latencyMs: 0, modelIds: [...CODEX_FIXED_MODEL_IDS] }
  }
  const rawAnthropicKey = request.apiKey.trim()
  if (isAnthropicOAuthCredentials(rawAnthropicKey)) {
    const creds = parseAnthropicCredentials(rawAnthropicKey)
    if (!creds) {
      return { ok: false, message: 'Claude 凭据已损坏，请重新登录。' }
    }
    if (creds.expiresAt < Date.now()) {
      return { ok: false, message: 'Claude 凭据已过期，将在下次启动时自动刷新；或重新登录。' }
    }
    // The subscription endpoint rejects /models with an OAuth token, so report
    // the fixed Claude line-up instead of probing.
    return { ok: true, latencyMs: 0, modelIds: [...ANTHROPIC_FIXED_MODEL_IDS] }
  }
  if (isAnthropicBaseUrl(baseUrl) && !rawAnthropicKey) {
    return { ok: false, message: 'Claude 未登录，请先点击「登录 Claude」。' }
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
  let res: Response
  let text: string
  try {
    res = await fetchWithOptionalProxy(url, {
      method: 'GET',
      headers: providerProbeHeaders(endpointFormat, request.apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    }, settings ? resolveModelProviderProxyUrl(settings) : '')
    text = await res.text()
  } catch (e) {
    const message = e instanceof Error && e.name === 'TimeoutError'
      ? `Request to ${url} timed out after ${PROBE_TIMEOUT_MS / 1_000}s.`
      : e instanceof Error ? e.message : String(e)
    return { ok: false, message }
  }
  const latencyMs = Date.now() - startedAt
  if (!res.ok) {
    return { ok: false, message: `${url} responded ${res.status}: ${text.slice(0, 300)}` }
  }
  return { ok: true, latencyMs, modelIds: parseModelIds(text) }
}

function parseModelIds(body: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    return []
  }
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const ids = new Set<string>()
  for (const row of data) {
    if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
      const id = (row as { id: string }).id.trim()
      if (id) ids.add(id)
    }
  }
  return [...ids]
}
