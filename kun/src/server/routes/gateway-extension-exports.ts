import type { GatewayClientPolicy } from '../../contracts/gateway-client-policy.js'
import { clientDirectTargets } from './gateway-client-policy.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Extension providers on the gateway. A provider is exported only when its
 * extension declared `gatewayExport` and the user chose, in gateway
 * settings, the account its requests use. Installing or updating an
 * extension never widens an existing client's authority: client policies
 * still have to name the `provider/model` address.
 */
export type ExtensionGatewayTarget = { providerId: string; modelId: string; accountId: string; displayName: string; providerName: string }

export function extensionGatewayTargets(runtime: ServerRuntime): ExtensionGatewayTarget[] {
  const exports = runtime.modelGateway?.extensionExports?.() ?? []
  if (!exports.length) return []
  const declared = runtime.extensionPlatform?.modelProviders.gatewayExportable() ?? []
  return exports.flatMap((selection) => {
    const provider = declared.find((entry) => entry.providerId === selection.providerId)
    return provider ? provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id,
      accountId: selection.accountId, displayName: model.displayName ?? model.id, providerName: provider.displayName })) : []
  })
}

export function extensionGatewayModels(runtime: ServerRuntime, policy?: GatewayClientPolicy, seen = new Set<string>()) {
  return extensionGatewayTargets(runtime).flatMap((target) => {
    const id = `${target.providerId}/${target.modelId}`
    const direct = { providerId: target.providerId, modelId: target.modelId }
    if (seen.has(id) || !clientDirectTargets(policy, direct, [direct]).length) return []
    seen.add(id)
    return [{ id, object: 'model' as const, created: 0, owned_by: target.providerId, display_name: `${target.displayName} · ${target.providerName}` }]
  })
}

export function resolveExtensionGatewayModel(runtime: ServerRuntime, model: string, policy?: GatewayClientPolicy) {
  const target = extensionGatewayTargets(runtime).find((entry) => `${entry.providerId}/${entry.modelId}` === model)
  if (!target) return null
  const direct = { providerId: target.providerId, modelId: target.modelId }
  const allowedTargets = clientDirectTargets(policy, direct, [direct])
  return allowedTargets.length ? { model: target.modelId, providerId: target.providerId, accountId: target.accountId,
    gatewayRouting: { allowedTargets } } : null
}
