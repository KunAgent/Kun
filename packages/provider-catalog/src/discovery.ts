import { resolveProviderCatalogSource, type ProviderCatalogSourceInput } from './index.js'

export type ProviderCatalogDiscovery = {
  strategy: 'live' | 'live-with-fallback' | 'preset' | 'manual'
  sourceUrl: string
  checkedAt: string
}
export type ResolvedPresetDiscovery = ProviderCatalogDiscovery & { models: readonly string[] }
export type ProviderPresetScopeInput = ProviderCatalogSourceInput & {
  baseUrl?: string; endpoints?: Record<string, string>; endpointFormat?: string; kind?: string
}
const normalize = (url: string) => url.trim().replace(/\/+$/u, '')

function matchingPresetScope(input: ProviderPresetScopeInput) {
  const source = resolveProviderCatalogSource(input)
  if (!source) return null
  const definition = source.presetMode === 'token-plan' ? source.preset.tokenPlan : source.preset
  if (!definition) return null
  const expectedKind = source.presetMode === 'token-plan' ? 'http' : source.preset.kind
  if (input.kind && input.kind !== expectedKind) return null
  if (expectedKind === 'http' && !input.baseUrl?.trim()) return null
  const format = input.endpointFormat
  if (format && format !== definition.endpointFormat && ![definition.endpoints, ...(definition.regions ?? []).map((region) => region.endpoints)]
    .some((endpoints) => endpoints && Object.prototype.hasOwnProperty.call(endpoints, format))) return null
  const configured = normalize(input.baseUrl ?? '')
  const allowed = new Set([definition.baseUrl, ...Object.values(definition.endpoints ?? {}),
    ...(definition.regions ?? []).flatMap((region) => [region.baseUrl, ...Object.values(region.endpoints ?? {})])].map(normalize))
  if (!allowed.has(configured)) return null
  if (Object.values(input.endpoints ?? {}).some((url) => !allowed.has(normalize(url)))) return null
  return { source, definition, region: definition.regions?.find((region) => normalize(region.baseUrl) === configured) }
}

/** A preset name is insufficient evidence once its endpoint, product or protocol was edited. */
export function providerPresetScopeMatches(input: ProviderPresetScopeInput): boolean {
  if ((input.presetSource ?? input.id)?.trim().toLowerCase() === 'deepseek') {
    try {
      const url = new URL(input.baseUrl ?? '')
      return (!input.kind || input.kind === 'http') && url.protocol === 'https:' && url.hostname === 'api.deepseek.com' &&
        ['', '/beta', '/v1', '/chat/completions', '/beta/chat/completions', '/v1/chat/completions'].includes(normalize(url.pathname)) &&
        Object.values(input.endpoints ?? {}).every((endpoint) => providerPresetScopeMatches({ ...input, baseUrl: endpoint, endpoints: undefined }))
    } catch { return false }
  }
  return matchingPresetScope(input) !== null
}

/** A known name alone cannot authorize a plan policy for a user-modified endpoint. */
export function resolvePresetDiscovery(input: ProviderPresetScopeInput): ResolvedPresetDiscovery | null {
  const match = matchingPresetScope(input)
  if (!match) return null
  const { source, definition, region } = match
  const discovery = region?.discovery ?? definition.discovery
  if (discovery) return { ...discovery, models: definition.models }
  if ('noList' in definition && definition.noList) return { strategy: 'preset', models: definition.models,
    sourceUrl: source.preset.docsUrl, checkedAt: '2026-10-08' }
  return null
}
