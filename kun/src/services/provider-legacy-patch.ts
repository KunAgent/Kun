import type { ModelConnectionPatchRequest } from '../contracts/model-connections.js'
import type { ProviderConfigurationState } from '../contracts/provider-configuration.js'
import type { StoredProfile } from './model-connection-registry-core.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'

/** Legacy projection round-trips keep inheritance; an actual edit becomes an explicit override. */
export function configurationAfterLegacyPatch(profile: StoredProfile, state: ProviderConfigurationState,
  patch: Partial<ModelConnectionPatchRequest>, preserveRoundTrip = true): ProviderConfigurationState {
  const existing = state.connections[profile.id]
  if (!existing) return state
  const effective = effectiveProviderConfiguration(profile, state).profile
  const configuration = structuredClone(existing)
  let changed = false
  const differs = (field: 'baseUrl' | 'endpointFormat' | 'endpoints' | 'useProxy') => patch[field] !== undefined &&
    (!preserveRoundTrip || (JSON.stringify(patch[field]) !== JSON.stringify(profile[field]) && JSON.stringify(patch[field]) !== JSON.stringify(effective[field])))
  for (const field of ['baseUrl', 'endpointFormat', 'endpoints'] as const) {
    if (!differs(field)) continue
    configuration.inherit = configuration.inherit.filter((key) => key !== field)
    if (field === 'baseUrl' && configuration.endpointBinding && patch.baseUrl) {
      configuration.endpointBinding = configuration.endpointBinding.urlMode === 'base'
        ? { ...configuration.endpointBinding, baseUrl: patch.baseUrl }
        : { ...configuration.endpointBinding, requestUrl: patch.baseUrl }
    }
    if (field === 'endpointFormat' && patch.endpointFormat !== effective.endpointFormat) configuration.endpointBinding = undefined
    changed = true
  }
  if (differs('useProxy')) {
    configuration.inherit = configuration.inherit.filter((field) => field !== 'proxy')
    configuration.proxy = { mode: patch.useProxy ? 'inherit' : 'direct' }
    changed = true
  }
  return changed ? { ...state, connections: { ...state.connections, [profile.id]: configuration } } : state
}
