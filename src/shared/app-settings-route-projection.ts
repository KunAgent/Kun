import {
  NESTED_ROUTE_PROVIDER_ID,
  type ModelProviderProfileV1,
  type ModelProviderSettingsV1,
  type ModelRoutePoolV1,
  type ModelRouteTargetResolutionV1,
  type ModelRouteTargetV1
} from './app-settings-types'
import { normalizeModelProviderId } from './app-settings-provider-capabilities'
import { normalizeRouteClassifier, normalizeRouteRules } from './app-settings-route-rules'

/** Route pool fields beyond targets and policies: manual pick, rules, classifier and overflow behavior. */
export function routePoolExtras(raw: Partial<ModelRoutePoolV1>, targetIds: ReadonlySet<string>): Partial<ModelRoutePoolV1> {
  const rules = normalizeRouteRules(raw.rules, targetIds)
  const classifier = normalizeRouteClassifier(raw.classifier)
  const pick = typeof raw.pick === 'string' && targetIds.has(raw.pick) ? raw.pick : undefined
  return {
    ...(pick ? { pick } : {}),
    ...(rules?.length ? { rules } : {}),
    ...(classifier ? { classifier } : {}),
    ...(typeof raw.overflowMove === 'boolean' ? { overflowMove: raw.overflowMove } : {})
  }
}

export function resolveModelRouteTargetReference(
  target: Pick<ModelRouteTargetV1, 'providerId' | 'modelId'>,
  providers: readonly ModelProviderProfileV1[]
): ModelRouteTargetResolutionV1 {
  const providerId = normalizeModelProviderId(target.providerId)
  const provider = providers.find((candidate) => candidate.id.toLowerCase() === providerId)
  if (!provider) return { status: 'provider-missing' }
  const requestedModel = target.modelId.trim().toLowerCase()
  const modelId = provider.models.find((candidate) => candidate.trim().toLowerCase() === requestedModel)
  if (!modelId) return { status: 'model-missing', provider }
  return { status: 'valid', provider, modelId }
}

/**
 * Projects durable user intent into the concrete configuration Kun may run.
 * Missing references remain in settings but never reach the Runtime.
 */
export function projectExecutableModelRoutePools(
  settings: Pick<ModelProviderSettingsV1, 'providers' | 'routePools'>
): ModelRoutePoolV1[] {
  return settings.routePools.map((pool) => {
    const targets = pool.targets.flatMap((target) => {
      // A nested alias is valid while the route it names exists; the runtime flattens it.
      if (target.providerId === NESTED_ROUTE_PROVIDER_ID) {
        return settings.routePools.some((candidate) => candidate.id !== pool.id &&
          candidate.modelId.toLowerCase() === target.modelId.toLowerCase()) ? [target] : []
      }
      const resolved = resolveModelRouteTargetReference(target, settings.providers)
      if (resolved.status !== 'valid' || !resolved.provider || !resolved.modelId) return []
      return [{
        ...target,
        providerId: resolved.provider.id,
        modelId: resolved.modelId
      }]
    })
    return {
      ...pool,
      enabled: pool.enabled && targets.some((target) => target.enabled),
      targets
    }
  })
}

