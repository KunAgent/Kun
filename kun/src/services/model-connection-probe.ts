import { ProviderDiscoveryResponseError, ProviderDiscoveryConfigurationError } from './provider-discovery-error.js'
import { readLimitedResponseText } from '../adapters/model/compat-model-support.js'
import type { ModelConnectionProfile } from '../contracts/model-connections.js'
import { resolveModelEndpointUrl } from '../contracts/model-endpoint-format.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { fetchCodexProviderCatalog } from '../adapters/model/codex-provider-catalog.js'
import { providerAuthenticationHeaders, scopedProviderHeaders, scopedProviderProtectedHeaders } from './provider-request-security.js'
import type { ProviderAuthProfile, ProviderHeaderProfile, ProviderDiscovery } from '../contracts/provider-configuration.js'
import { discoverCustomModels } from './provider-custom-discovery.js'

const fetchProxiedCatalog = (url: string, init: RequestInit, proxyUrl: string): Promise<Response> =>
  (createProxyFetch(proxyUrl) ?? fetch)(url, init)

function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
}

export async function probeModels(input: {
  kind: ModelConnectionProfile['kind']
  authType?: ModelConnectionProfile['authType']
  baseUrl?: string
  endpointFormat?: ModelConnectionProfile['endpointFormat']
  /** Per-protocol base URL overrides; the probe resolves `endpoints[format] ?? baseUrl`. */
  endpoints?: ModelConnectionProfile['endpoints']
  apiKey: string
  headers?: Record<string, string>
  customHeaders?: Record<string, string>
  fallbackModels: readonly string[]
  proxyUrl: string
  discovery?: ProviderDiscovery
  authProfile?: ProviderAuthProfile
  headerProfile?: ProviderHeaderProfile
  signal?: AbortSignal
}): Promise<string[]> {
  input.signal?.throwIfAborted()
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }
  if (input.kind !== 'http') return uniqueModels(input.fallbackModels)
  if (!input.baseUrl) throw new ProviderDiscoveryConfigurationError('provider probe failed: HTTP provider has no base URL')
  if (input.discovery?.mode === 'manual') return uniqueModels(input.fallbackModels)
  if (input.discovery?.mode === 'custom') {
    const requestUrl = input.discovery.modelsUrl
    const fallbackUrls = [input.baseUrl, ...input.discovery.credentialHosts.map((host) => `https://${host}`)]
    const authHeaders = providerAuthenticationHeaders({ ...input, protocol: input.endpointFormat, requestUrl, purpose: 'discovery', fallbackUrls })
    const scopedHeaders = scopedProviderHeaders({ ...input, headers: input.customHeaders ?? {}, requestUrl, purpose: 'discovery', fallbackUrls })
    const protectedHeaders = scopedProviderProtectedHeaders({ ...input, headers: input.headers ?? {}, requestUrl, purpose: 'discovery', fallbackUrls })
    return discoverCustomModels({ discovery: input.discovery, baseUrl: input.baseUrl,
      headers: { ...scopedHeaders, ...protectedHeaders, ...authHeaders, Accept: 'application/json' },
      fetcher: createProxyFetch(input.proxyUrl) ?? fetch, signal: input.signal })
  }
  const endpoint = new URL(input.baseUrl)
  if (endpoint.protocol === 'https:' && endpoint.hostname === 'chatgpt.com' &&
      /^\/backend-api\/codex(?:\/|$)/u.test(endpoint.pathname)) {
    if (!input.apiKey.trim()) throw new ProviderDiscoveryConfigurationError('provider probe failed: Codex requires a credential')
    const requestUrl = 'https://chatgpt.com/backend-api/codex/models'
    const fallbackUrls = [input.baseUrl]
    const auth = providerAuthenticationHeaders({ ...input, requestUrl, purpose: 'discovery', fallbackUrls })
    const protectedHeaders = scopedProviderProtectedHeaders({ ...input, headers: input.headers ?? {}, requestUrl, purpose: 'discovery', fallbackUrls })
    const userHeaders = scopedProviderHeaders({ ...input, headers: input.customHeaders ?? {}, requestUrl, purpose: 'discovery', fallbackUrls })
    const { response, text, truncated } = await fetchCodexProviderCatalog({
      fetcher: input.proxyUrl ? fetchProxiedCatalog : fetch,
      proxyUrl: input.proxyUrl,
      headers: { ...userHeaders, ...protectedHeaders, Accept: 'application/json', ...auth },
      timeoutMs: 15_000, signal: input.signal
    })
    if (!response.ok) throw new ProviderDiscoveryResponseError(`provider probe failed with HTTP ${response.status}`, response.status)
    if (truncated) throw new ProviderDiscoveryResponseError('Codex model catalog exceeded its size limit')
    let catalog: { models?: unknown }
    try { catalog = JSON.parse(text) } catch { throw new ProviderDiscoveryResponseError('Codex returned an invalid model catalog') }
    if (!catalog || !Array.isArray(catalog.models)) throw new ProviderDiscoveryResponseError('Codex returned an invalid model catalog')
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
      throw new ProviderDiscoveryConfigurationError(
        'provider probe failed: custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
      )
    }
    if (!input.apiKey.trim() && input.authType !== 'none') {
      throw new ProviderDiscoveryConfigurationError('provider probe failed: custom_endpoint requires a credential when probing configured models')
    }
    return configured
  }
  const override = input.endpointFormat
    ? input.endpoints?.[input.endpointFormat]?.trim()
    : undefined
  const url = modelsUrl(override || input.baseUrl, input.endpointFormat)
  const fallbackUrls = [input.baseUrl, ...Object.values(input.endpoints ?? {})]
  const authHeaders = providerAuthenticationHeaders({ ...input, protocol: input.endpointFormat, requestUrl: url, purpose: 'discovery', fallbackUrls })
  const scopedHeaders = scopedProviderHeaders({ ...input, headers: input.customHeaders ?? {}, requestUrl: url, purpose: 'discovery', fallbackUrls })
  const protectedHeaders = scopedProviderProtectedHeaders({ ...input, headers: input.headers ?? {}, requestUrl: url, purpose: 'discovery', fallbackUrls })
  const fetchImpl = createProxyFetch(input.proxyUrl) ?? fetch
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: { ...scopedHeaders, ...protectedHeaders, ...authHeaders },
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new ProviderDiscoveryResponseError(`provider probe failed with HTTP ${response.status}`, response.status)
  const body = await readLimitedResponseText(response, 2_000_000)
  if (body.exceeded) throw new ProviderDiscoveryResponseError('Model discovery response exceeds its size limit')
  let value: { data?: Array<{ id?: unknown }>; models?: unknown[]; has_more?: boolean }
  try { value = JSON.parse(body.text) } catch { throw new ProviderDiscoveryResponseError('Provider returned an invalid model catalog') }
  if (!value || (!Array.isArray(value.data) && !Array.isArray(value.models))) throw new ProviderDiscoveryResponseError('Provider returned an invalid model catalog')
  if (value.has_more === true) throw new ProviderDiscoveryResponseError('This model catalog requires pagination; configure a custom discovery cursor mapping')
  const discovered = Array.isArray(value.data) ? value.data.map((entry) => entry?.id) : value.models!
  if (discovered.length > 2_000 || discovered.some((id) => typeof id !== 'string' || !id.trim() || id.length > 512)) {
    throw new ProviderDiscoveryResponseError('Provider model catalog exceeds its limits or contains invalid identifiers')
  }
  // An empty successful response is evidence, not a reason to resurrect stored selections.
  return uniqueModels(discovered as string[])
}

export function modelsUrl(
  baseUrl: string,
  endpointFormat: ModelConnectionProfile['endpointFormat'] | undefined
): string {
  return resolveModelEndpointUrl(baseUrl, endpointFormat ?? 'chat_completions', 'models')
}
