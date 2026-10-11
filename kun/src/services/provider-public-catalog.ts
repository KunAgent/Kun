import { resolveProviderCatalogSource, tokenPlanProviderId, type ProviderCatalogSourceInput } from '@kun/provider-catalog'
import { metadataEvidence, MODEL_METADATA_FIELDS } from '../contracts/model-metadata-evidence.js'
import { join } from 'node:path'
import { ModelsDevCatalogService } from './models-dev-catalog.js'
import { parseNativeReasoning, type DiscoveredModelProfile } from './provider-model-descriptors.js'
import type { ModelsDevCatalogModel, ModelsDevCatalogRequest } from '../contracts/public-model-catalog.js'
import { emptyDocument, type ModelConnectionRegistry } from './model-connection-registry-core.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { resolveRegistryProfileProxyUrl } from './model-connection-registry-proxy.js'

const services = new WeakMap<ModelConnectionRegistry, ModelsDevCatalogService>()
export function publicCatalogService(registry: ModelConnectionRegistry): ModelsDevCatalogService {
  let service = services.get(registry)
  if (!service) {
    service = new ModelsDevCatalogService(undefined, undefined, join(registry['options'].dataDir, 'model-catalog', 'public.json'), () => {
      void import('./provider-catalog-operations.js').then(({ refreshPublicCatalogs }) => refreshPublicCatalogs(registry)).catch(() => undefined)
    })
    services.set(registry, service)
  }
  return service
}

export async function fetchPublicModelCatalog(registry: ModelConnectionRegistry, request: ModelsDevCatalogRequest) {
  const document = await registry['file'].read(emptyDocument)
  const saved = document.profiles[request.providerId]
  const effective = saved ? effectiveProviderConfiguration(saved, document.configuration) : undefined
  const profile = effective?.profile
  const proxyUrl = effective?.proxy?.mode === 'proxy' ? effective.proxy.url : profile
    ? resolveRegistryProfileProxyUrl(document, profile) : document.proxy.enabled ? document.proxy.url : ''
  return publicCatalogService(registry).fetch({ ...request,
    providerId: profile ? publicCatalogProviderId(profile) : request.providerId,
    baseUrl: profile?.baseUrl ?? request.baseUrl
  }, { proxyUrl, catalogSources: request.catalogSources })
}

export function publicCatalogProfile(model: ModelsDevCatalogModel, source = 'models.dev'): DiscoveredModelProfile {
  const profile: DiscoveredModelProfile = {}
  for (const key of ['contextWindowTokens', 'maxInputTokens', 'maxOutputTokens', 'parallelTools', 'streaming', 'structuredOutput', 'pricing'] as const) {
    if (model[key] !== undefined) Object.assign(profile, { [key]: model[key] })
  }
  if (model.reasoning !== undefined) profile.supportsReasoning = model.reasoning
  if (model.toolCalling !== undefined) profile.supportsToolCalling = model.toolCalling
  for (const key of ['inputModalities', 'outputModalities'] as const) {
    const values = model[key].filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
    if (values.length) profile[key] = values
  }
  if (model.reasoningOptions) {
    profile.reasoning = parseNativeReasoning(model.reasoningOptions.supportedEfforts, model.reasoningOptions.defaultEffort, 'none')
  }
  profile.evidence = metadataEvidence(profile, 'catalog', model.observedAt)
  const paths: Record<string, string> = { contextWindowTokens: 'limit.context', maxInputTokens: 'limit.input', maxOutputTokens: 'limit.output', reasoning: 'reasoning_options', supportsReasoning: 'reasoning', supportsToolCalling: 'tool_call', pricing: 'cost' }
  for (const field of MODEL_METADATA_FIELDS) if (profile[field] !== undefined) {
    profile.evidence[field] = { ...profile.evidence[field]!, sourceId: `${source}:${model.providerKey ?? 'unknown'}`,
      match: model.matchSpecificity === 'exact' ? 'exact' : 'family', fieldPath: paths[field] ?? field }
  }
  return profile
}

export function publicCatalogProviderId(profile: ProviderCatalogSourceInput & { id: string }): string {
  const source = resolveProviderCatalogSource(profile)
  return source ? source.presetMode === 'token-plan' ? tokenPlanProviderId(source.preset.id) : source.preset.id
    : profile.presetSource ?? profile.id
}
