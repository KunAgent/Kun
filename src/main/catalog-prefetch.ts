import type { AppSettingsV1 } from '../shared/app-settings'
import {
  getModelProviderSettings,
  resolveModelProviderPresetSource
} from '../shared/app-settings'
import type { ModelProviderModelProfileV1 } from '../shared/app-settings'
import type { ModelsDevCatalogModel, ModelsDevCatalogResult } from '../shared/kun-gui-api'
import { fetchModelsDevCatalog } from './models-dev-catalog'

type SettingsStoreLike = {
  load(): Promise<AppSettingsV1>
  update(
    mutation: (current: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
  ): Promise<AppSettingsV1>
}

/**
 * Preset providers whose own catalog entry reports zero prices (subscription
 * plans) can still show a reference estimate by borrowing the public API
 * pricing of the same model family from another catalog provider. Keys are
 * preset ids; each entry points at the catalog provider and maps the preset's
 * model id onto the catalog's model id.
 */
const REFERENCE_PRICING_SOURCES: Record<string, {
  catalogProviderId: string
  catalogBaseUrl: string
  modelIdAliases: Record<string, string>
}> = {
  'kimi-code': {
    catalogProviderId: 'moonshot-cn',
    catalogBaseUrl: 'https://api.moonshot.cn/v1',
    modelIdAliases: {
      k3: 'kimi-k3',
      'kimi-for-coding': 'kimi-k2.7-code',
      'kimi-for-coding-highspeed': 'kimi-k2.7-code-highspeed'
    }
  }
}

/**
 * Startup prefetch: pull the models.dev catalog (with its kun-agent.com
 * fallback) once per preset-backed provider and hydrate catalog pricing into
 * the persisted modelProfiles. Preset providers (subscription/token-plan and
 * built-in API presets) never pass through the import dialog, so this is the
 * only path that gives them reference pricing. Failures stay silent; the
 * footer keeps its "price unavailable" state for unpriced models.
 */
export async function prefetchCatalogPricing(store: SettingsStoreLike): Promise<void> {
  const settings = await store.load()
  const providers = getModelProviderSettings(settings).providers
  for (const provider of providers) {
    const source = resolveModelProviderPresetSource(provider)
    if (!source) continue
    const pricingByModel = await resolvePricingForProvider(provider, source.preset.id, settings)
    if (!pricingByModel || pricingByModel.size === 0) continue
    await store.update((current) => applyCatalogPricing(current, provider.id, pricingByModel))
  }
}

async function resolvePricingForProvider(
  provider: { id: string; baseUrl: string; models: readonly string[] },
  presetId: string,
  settings: AppSettingsV1
): Promise<Map<string, NonNullable<ModelsDevCatalogModel['pricing']>> | null> {
  const reference = REFERENCE_PRICING_SOURCES[presetId]
  if (reference) {
    const result = await fetchCatalog(reference.catalogProviderId, reference.catalogBaseUrl, settings)
    if (!result) return null
    const pricing = new Map<string, NonNullable<ModelsDevCatalogModel['pricing']>>()
    const catalogById = new Map(
      result.models.map((model) => [model.id.trim().toLowerCase(), model] as const)
    )
    for (const [presetModelId, catalogModelId] of Object.entries(reference.modelIdAliases)) {
      const catalogModel = catalogById.get(catalogModelId.trim().toLowerCase())
      if (catalogModel?.pricing) pricing.set(presetModelId, catalogModel.pricing)
    }
    return pricing
  }
  const result = await fetchCatalog(presetId, provider.baseUrl, settings)
  if (!result) return null
  const pricing = new Map<string, NonNullable<ModelsDevCatalogModel['pricing']>>()
  for (const model of result.models) {
    if (model.pricing) pricing.set(model.id.trim().toLowerCase(), model.pricing)
  }
  return pricing
}

async function fetchCatalog(
  providerId: string,
  baseUrl: string,
  settings: AppSettingsV1
): Promise<Extract<ModelsDevCatalogResult, { status: 'ok' }> | null> {
  const result = await fetchModelsDevCatalog({ providerId, baseUrl }, settings).catch(() => null)
  return result && result.status === 'ok' ? result : null
}

function applyCatalogPricing(
  settings: AppSettingsV1,
  providerId: string,
  pricingByModel: ReadonlyMap<string, NonNullable<ModelsDevCatalogModel['pricing']>>
): AppSettingsV1 {
  const providerSettings = getModelProviderSettings(settings)
  const providerIndex = providerSettings.providers.findIndex((item) => item.id === providerId)
  if (providerIndex < 0) return settings
  const provider = providerSettings.providers[providerIndex]!
  let changed = false
  const modelProfiles: Record<string, ModelProviderModelProfileV1> = { ...provider.modelProfiles }
  for (const modelId of provider.models) {
    const pricing = pricingByModel.get(modelId.trim().toLowerCase())
    if (!pricing) continue
    const profileKey = Object.keys(modelProfiles).find(
      (key) => key.trim().toLowerCase() === modelId.trim().toLowerCase()
    )
    if (!profileKey) continue
    const profile = modelProfiles[profileKey]!
    if (JSON.stringify(profile.pricing) === JSON.stringify(pricing)) continue
    modelProfiles[profileKey] = { ...profile, pricing: { ...pricing } }
    changed = true
  }
  if (!changed) return settings
  const providers = [...providerSettings.providers]
  providers[providerIndex] = { ...provider, modelProfiles }
  return {
    ...settings,
    provider: { ...providerSettings, providers }
  }
}
