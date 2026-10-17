import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import { PROVIDER_MODULES } from '../../harness/providers/registry.js'
import { providerModelIds } from '../../server/routes/model-gateway-core.js'
import { checkedProfiles, modelProfile, routeProfiles } from './model-profiles.js'
import { checkedModelInfo, providerModelInfo, routeModelInfo } from './model-info.js'
import type { RemoteAgentRoute, RemoteCodeAgent } from './model-catalog.js'

type Provider = ModelConnectionSnapshot['providers'][number]

/** The desktop's own name for the route-pool group in the Code model picker. */
export const ROUTE_POOL_LABEL = 'Kun API'

export function usableProvider(provider: Pick<Provider, 'configured' | 'enabled' | 'credentialStatus'>) {
  return provider.configured && provider.enabled !== false &&
    (!provider.credentialStatus || provider.credentialStatus === 'ready' || provider.credentialStatus === 'not-required')
}

/**
 * A connection kind that carries another engine's account (agent-sdk → Claude Code) belongs to that Agent;
 * every other kind (HTTP, Gemini CLI, Gemini Code Assist…) is a model client for Kun's own loop, exactly as
 * turn admission and the desktop Code picker decide.
 */
function runsOnKun(provider: Pick<Provider, 'kind'>) {
  return !PROVIDER_MODULES.some((module) => module.nativeAccount?.kind === provider.kind)
}

/**
 * The desktop picker's "Kun API" group: each enabled route pool whose model one of its enabled targets can still
 * serve. Kun's loop resolves these through the local gateway id, so the phone sends that id like the desktop does.
 */
function routePoolRoute(snapshot: ModelConnectionSnapshot): RemoteAgentRoute | undefined {
  const providers = new Map(snapshot.providers.map((provider) => [provider.id.toLowerCase(), provider]))
  const served = (target: { providerId: string; modelId: string; enabled?: boolean }) => {
    const provider = providers.get(target.providerId.toLowerCase())
    return target.enabled !== false && Boolean(provider) && usableProvider(provider!) && runsOnKun(provider!) &&
      providerModelIds(provider!).some((model) => model.toLowerCase() === target.modelId.toLowerCase())
  }
  const models = [...new Set((snapshot.routePools ?? [])
    .filter((pool) => pool.enabled && pool.targets.some(served))
    .map((pool) => pool.modelId))]
  if (models.length === 0) return undefined
  const isDefault = snapshot.defaultProviderId === LOCAL_MODEL_GATEWAY_PROVIDER_ID && snapshot.defaultModel && models.includes(snapshot.defaultModel)
  return { credentialMode: 'provider', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID, label: ROUTE_POOL_LABEL, models,
    defaultModel: isDefault ? snapshot.defaultModel : models[0] }
}

/** Kun's own loop: one route per usable model connection it can drive, plus the route pools, default first. */
export async function kunAgent(runtime: ServerRuntime, legacyModels: string[]): Promise<RemoteCodeAgent> {
  const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
  const routes: RemoteAgentRoute[] = (snapshot?.providers ?? [])
    .filter((provider) => runsOnKun(provider) && usableProvider(provider))
    .map((provider) => {
      const models = providerModelIds(provider)
      const isDefault = provider.id === snapshot?.defaultProviderId
      return {
        credentialMode: 'provider' as const,
        providerId: provider.id,
        label: provider.name,
        models,
        defaultModel: isDefault && snapshot?.defaultModel && models.includes(snapshot.defaultModel)
          ? snapshot.defaultModel
          : provider.selectedModel ?? models[0],
        // The provider's declared reasoning metadata is what Kun's own loop sends.
        ...routeProfiles(models, (model) => {
          const reasoning = provider.modelCapabilities?.[model]?.reasoning
          return modelProfile(reasoning?.supportedEfforts, reasoning?.defaultEffort)
        }),
        // Vision and Fast exactly as the desktop Code picker shows them for this connection.
        ...routeModelInfo(models, (model) => providerModelInfo(provider, model))
      }
    })
    .filter((route) => route.models.length > 0)
  const pools = snapshot ? routePoolRoute(snapshot) : undefined
  if (pools) routes.push(pools)
  routes.sort((a, b) => Number(b.providerId === snapshot?.defaultProviderId) - Number(a.providerId === snapshot?.defaultProviderId))
  // Without a model-connection registry the runtime's default route is the only one.
  if (routes.length === 0 && legacyModels.length > 0)
    routes.push({ label: 'Kun', models: legacyModels, defaultModel: runtime.defaultModel ?? legacyModels[0] })
  const definition = runtime.harnesses?.catalog.get('kun')
  return { id: 'kun', name: definition?.displayName ?? 'Kun', routes: routes.map((route) => checkedModelInfo(checkedProfiles(route))) }
}
