import type { ModelConnectionProfile, ModelConnectionSnapshot } from '../contracts/model-connections.js'
import type { ModelRoutePoolConfig } from '../contracts/model-route-pool.js'

export type GatewayRouteTarget = { providerId: string; modelId: string }
export class GatewayRouteChangedError extends Error {
  constructor() {
    super('Gateway provider configuration changed; retry with the current model configuration.')
    this.name = 'GatewayRouteChangedError'
  }
}
type ProviderExportState = Pick<ModelConnectionProfile, 'kind' | 'authType' | 'configured' | 'credentialStatus'>

/** One policy for public aliases, direct addressing, and delegated gateway grants. */
export function gatewayProviderExportBlockReason(provider: ProviderExportState): string | undefined {
  if (provider.kind !== 'http') return 'native_provider'
  if (provider.authType !== 'api-key') return 'native_authentication'
  if (!provider.configured) return 'not_configured'
  if (provider.credentialStatus !== 'ready') return 'credential_not_ready'
  return undefined
}

/** Native harness subscription access is independent of model API export. */
export function exposableProvider(provider: ProviderExportState): boolean {
  return gatewayProviderExportBlockReason(provider) === undefined
}

export function gatewayTargetExportable(
  providers: readonly ModelConnectionProfile[],
  target: GatewayRouteTarget
): boolean {
  return gatewayTargetExportBlockReason(providers, target) === undefined
}

export function gatewayTargetExportBlockReason(
  providers: readonly ModelConnectionProfile[],
  target: GatewayRouteTarget
): string | undefined {
  const provider = providers.find((candidate) => candidate.id === target.providerId)
  if (!provider) return 'provider_missing'
  const blocked = gatewayProviderExportBlockReason(provider)
  if (blocked) return blocked
  return provider.selectedModel === target.modelId || provider.models.includes(target.modelId)
    ? undefined : 'model_not_configured'
}

export function gatewayPoolTargets(
  providers: readonly ModelConnectionProfile[],
  pool: ModelRoutePoolConfig
): GatewayRouteTarget[] {
  return pool.enabled
    ? uniqueExportableTargets(providers, pool.targets.filter((target) => target.enabled))
    : []
}

/**
 * A direct route may use only its explicitly configured account group and
 * fallback chain. A grant narrows that set further at the caller boundary.
 * Never expand a candidate into another group's fallback chain recursively.
 */
export function gatewayDirectTargets(
  snapshot: Pick<ModelConnectionSnapshot, 'providers' | 'failover'>,
  requested: GatewayRouteTarget,
  allowed?: readonly GatewayRouteTarget[]
): GatewayRouteTarget[] {
  const group = snapshot.failover?.find((candidate) =>
    candidate.members.some((member) => member.providerId === requested.providerId))
  const targets = group
    ? [
        ...group.members.filter((member) => member.enabled &&
          (member.providerId === requested.providerId || member.models.includes(requested.modelId)))
          .map((member) => ({ providerId: member.providerId, modelId: requested.modelId })),
        ...group.fallbackTargets
      ]
    : [requested]
  return uniqueExportableTargets(snapshot.providers, targets).filter((target) =>
    !allowed || allowed.some((route) => gatewayTargetMatches(route, target)))
}

export function gatewayTargetMatches(left: GatewayRouteTarget, right: GatewayRouteTarget): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId
}

function uniqueExportableTargets(
  providers: readonly ModelConnectionProfile[],
  targets: readonly GatewayRouteTarget[]
): GatewayRouteTarget[] {
  return targets.filter((target, index) => gatewayTargetExportable(providers, target) &&
    targets.findIndex((other) => gatewayTargetMatches(other, target)) === index)
    .map(({ providerId, modelId }) => ({ providerId, modelId }))
}
