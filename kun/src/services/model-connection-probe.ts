import type { ModelConnectionProfile } from '../contracts/model-connections.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { CODEX_CLI_VERSION } from '../adapters/model/provider-cli-identity.js'

function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
}

export async function probeModels(input: {
  kind: ModelConnectionProfile['kind']
  baseUrl?: string
  endpointFormat?: ModelConnectionProfile['endpointFormat']
  apiKey: string
  headers?: Record<string, string>
  fallbackModels: readonly string[]
  proxyUrl: string
}): Promise<string[]> {
  if (input.kind !== 'http') return uniqueModels(input.fallbackModels)
  if (!input.baseUrl) throw new Error('provider probe failed: HTTP provider has no base URL')
  const endpoint = new URL(input.baseUrl)
  if (endpoint.protocol === 'https:' && endpoint.hostname === 'chatgpt.com' &&
      /^\/backend-api\/codex(?:\/|$)/u.test(endpoint.pathname)) {
    if (!input.apiKey.trim()) throw new Error('provider probe failed: Codex requires a credential')
    const fetchImpl = createProxyFetch(input.proxyUrl) ?? fetch
    const response = await fetchImpl(
      `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`,
      {
        headers: { ...input.headers, Accept: 'application/json', authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(15_000)
      }
    )
    if (!response.ok) throw new Error(`provider probe failed with HTTP ${response.status}`)
    const catalog = await response.json() as { models?: unknown }
    if (!catalog || !Array.isArray(catalog.models)) throw new Error('Codex returned an invalid model catalog')
    return uniqueModels(catalog.models.slice(0, 2_000).flatMap((row) =>
      row && row.visibility === 'list' && typeof row.slug === 'string' && row.slug.length <= 512
        ? [row.slug] : []
    ))
  }
  // Custom full inference endpoints have no discoverable /models URL. When the
  // profile already lists models (coding-plan gateways, user custom
  // paths), treat an explicit credential + catalog as a successful probe.
  if (input.endpointFormat === 'custom_endpoint') {
    const configured = uniqueModels(input.fallbackModels)
    if (configured.length === 0) {
      throw new Error(
        'provider probe failed: custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
      )
    }
    if (!input.apiKey.trim()) {
      throw new Error('provider probe failed: custom_endpoint requires a credential when probing configured models')
    }
    return configured
  }
  const url = modelsUrl(input.baseUrl, input.endpointFormat)
  const usesAnthropicHeaders = input.endpointFormat === 'messages'
  const authHeaders: Record<string, string> = input.apiKey
    ? usesAnthropicHeaders
      ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${input.apiKey}` }
    : {}
  const fetchImpl = createProxyFetch(input.proxyUrl) ?? fetch
  const response = await fetchImpl(url, {
    headers: { ...(input.headers ?? {}), ...authHeaders },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`provider probe failed with HTTP ${response.status}`)
  const value = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown }>; models?: unknown[] }
  const discovered = Array.isArray(value.data)
    ? value.data.flatMap((entry) => typeof entry?.id === 'string' ? [entry.id] : [])
    : Array.isArray(value.models)
      ? value.models.flatMap((entry) => typeof entry === 'string' ? [entry] : [])
      : []
  return uniqueModels([...discovered, ...input.fallbackModels])
}

export function modelsUrl(
  baseUrl: string,
  endpointFormat: ModelConnectionProfile['endpointFormat'] | undefined
): string {
  if (endpointFormat === 'custom_endpoint') {
    throw new Error(
      'provider probe failed: custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
    )
  }
  const url = new URL(baseUrl)
  url.search = ''
  url.hash = ''
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments.at(-1)?.toLowerCase()
  if (last === 'models') {
    url.pathname = `/${segments.join('/')}`
    return url.toString()
  }
  if (last === 'responses' || last === 'messages') {
    segments.pop()
  } else if (last === 'completions' && segments.at(-2)?.toLowerCase() === 'chat') {
    segments.splice(-2)
  }
  const version = segments.at(-1)?.toLowerCase()
  if (version === 'beta') {
    segments[segments.length - 1] = 'v1'
  } else if (!version || !/^v\d+$/u.test(version)) {
    segments.push('v1')
  }
  if (segments.at(-1)?.toLowerCase() !== 'models') segments.push('models')
  url.pathname = `/${segments.join('/')}`
  return url.toString()
}
