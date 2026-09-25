import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { resolveModelProviderPresetSource } from '@shared/model-provider-preset-operations-core'
import { isSubscriptionProvider } from './settings-section-providers-profile'
import type { SharedModelConnection } from './settings-section-providers-shared-api'

/**
 * Kinds that authenticate through their own CLI/SDK login instead of a
 * user-entered baseUrl. `gemini-cli-api` always targets Google's Code Assist
 * endpoint from the runtime client, so its AppSettings baseUrl stays empty.
 */
export function sharedConnectionBaseUrlOptional(kind: string | undefined): boolean {
  return kind === 'agent-sdk' ||
    kind === 'antigravity-cli' ||
    kind === 'gemini-cli-api' ||
    kind === 'gemini-code-assist' ||
    kind === 'cursor-sdk'
}

export function normalizedModelId(model: string): string {
  return model.trim().toLowerCase()
}

export function modelProfileFor(
  profiles: Readonly<Record<string, ModelProviderModelProfileV1>>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  return profiles[model] ?? profiles[normalizedModelId(model)]
}

export function wireModelCapability(
  model: string,
  profile: ModelProviderModelProfileV1 | undefined
): NonNullable<SharedModelConnection['modelCapabilities']>[string] | undefined {
  if (!profile) return undefined
  const { aliases: _aliases, ...capability } = profile
  return { id: model, ...capability }
}

export function catalogCapabilities(
  models: readonly string[],
  profiles: Readonly<Record<string, ModelProviderModelProfileV1>>
): NonNullable<SharedModelConnection['modelCapabilities']> {
  return Object.fromEntries(models.flatMap((model) => {
    const capability = wireModelCapability(model, modelProfileFor(profiles, model))
    return capability ? [[model, capability]] : []
  }))
}

export function sameCatalogCapabilities(
  left: SharedModelConnection['modelCapabilities'],
  right: SharedModelConnection['modelCapabilities']
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

export function registryPresetFields(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): { presetSource?: string; presetMode?: 'api' | 'token-plan' } {
  const source = resolveModelProviderPresetSource(provider)
  return source ? { presetSource: source.preset.id, presetMode: source.mode } : {}
}

/**
 * The profile fields every registry mutation carries. Per-protocol endpoint
 * overrides always ride along — `endpoints: {}` explicitly clears them so a
 * user removing an override does not leave a stale URL on the registry.
 */
export function sharedConnectionProfilePatch(provider: ModelProviderProfileV1): Record<string, unknown> {
  const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
  return {
    name: provider.name.trim() || provider.id,
    kind: provider.kind ?? 'http',
    authType: isSubscriptionProvider(provider) ? 'subscription' : 'api-key',
    ...(baseUrlOptional ? {} : { baseUrl: provider.baseUrl }),
    endpointFormat: provider.endpointFormat,
    endpoints: provider.endpoints ?? {},
    useProxy: provider.useProxy
  }
}

/**
 * The connect payload shared by fresh-connect paths. Per-protocol endpoint
 * overrides are forwarded only when present: an empty record on a first-time
 * connect is indistinguishable noise.
 */
export function sharedConnectionConnectFields(provider: ModelProviderProfileV1): Record<string, unknown> {
  const baseUrlOptional = sharedConnectionBaseUrlOptional(provider.kind)
  return {
    id: provider.id,
    name: provider.name.trim() || provider.id,
    ...registryPresetFields(provider),
    kind: provider.kind ?? 'http',
    authType: isSubscriptionProvider(provider) ? 'subscription' : 'api-key',
    ...(baseUrlOptional ? {} : { baseUrl: provider.baseUrl }),
    endpointFormat: provider.endpointFormat,
    ...(provider.endpoints ? { endpoints: provider.endpoints } : {}),
    useProxy: provider.useProxy
  }
}

export function sharedCapabilitiesFromProvider(
  provider: ModelProviderProfileV1
): SharedModelConnection['modelCapabilities'] {
  return catalogCapabilities(provider.models, provider.modelProfiles)
}
