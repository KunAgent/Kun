import type { ProviderConfigurationState, ProviderDefaults } from '../contracts/provider-configuration.js'

type Profile = { id: string; name: string; baseUrl?: string; endpointFormat: string;
  endpoints?: { chat_completions?: string; responses?: string; messages?: string }; useProxy: boolean }

/** Resolve only explicitly inherited fields; legacy values stay explicit overrides. */
export function effectiveProviderConfiguration<T extends Profile>(profile: T, state: ProviderConfigurationState) {
  const configuration = state.connections[profile.id]
  const group = configuration?.groupId ? state.groups[configuration.groupId] : undefined
  const defaults: ProviderDefaults = {
    ...(configuration?.template ?? group?.template)?.defaults, ...group?.defaults
  }
  const effective = { ...profile }
  const sources: Record<string, 'connection' | 'group' | 'template'> = {}
  for (const field of ['baseUrl', 'endpointFormat', 'endpoints'] as const) {
    sources[field] = 'connection'
    if (configuration?.inherit.includes(field) && defaults[field] !== undefined) {
      Object.assign(effective, { [field]: defaults[field] })
      sources[field] = group?.defaults[field] !== undefined ? 'group' : 'template'
    }
  }
  const setting = <K extends 'proxy' | 'discovery' | 'admission'>(key: K) => {
    const explicit = !configuration?.inherit.includes(key) && configuration?.[key] !== undefined
    sources[key] = explicit ? 'connection' : group?.defaults[key] !== undefined ? 'group' : 'template'
    return explicit ? configuration![key] : defaults[key]
  }
  const proxy = setting('proxy')
  if (proxy?.mode === 'direct') effective.useProxy = false
  else if (proxy?.mode === 'inherit' || proxy?.mode === 'proxy') effective.useProxy = true
  const binding = configuration?.endpointBinding
  if (binding) {
    effective.baseUrl = binding.urlMode === 'base' ? binding.baseUrl : binding.requestUrl
    effective.endpointFormat = binding.urlMode === 'base' ? binding.protocol : 'custom_endpoint'
    sources.baseUrl = 'connection'
    sources.endpointFormat = 'connection'
  }
  return { profile: effective, configuration, sources,
    enabled: configuration?.enabled !== false && group?.enabled !== false,
    discovery: setting('discovery') ?? { mode: 'auto' as const }, admission: setting('admission'), proxy,
    ...(binding?.urlMode === 'full' ? { fullEndpointProtocol: binding.protocol } : {}) }
}
