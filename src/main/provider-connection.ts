import {
  isCustomModelEndpointFormat,
  normalizeModelEndpointFormat,
  type ModelEndpointFormat
} from '../shared/app-settings'
import type { ModelProviderProbeRequest, ModelProviderProbeResult } from '../shared/kun-gui-api'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'

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
  request: ModelProviderProbeRequest
): Promise<ModelProviderProbeResult> {
  const baseUrl = request.baseUrl.trim()
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, message: 'Base URL must start with http:// or https://.' }
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
    res = await fetch(url, {
      method: 'GET',
      headers: providerProbeHeaders(endpointFormat, request.apiKey),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
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
