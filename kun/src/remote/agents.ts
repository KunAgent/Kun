import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { HarnessCredentialMode, HarnessDefinition } from '../contracts/harness.js'
import { providerModelIds } from '../server/routes/model-gateway-core.js'

/**
 * One selectable credential path for a Code Agent. A phone pick pins the
 * Agent, this route and one of its models; `code.create` re-derives the list
 * and accepts only an exact match, so a phone can never invent a route.
 */
export type RemoteAgentRoute = {
  credentialMode?: HarnessCredentialMode
  providerId?: string
  label: string
  models: string[]
  defaultModel?: string
}
export type RemoteCodeAgent = { id: string; name: string; routes: RemoteAgentRoute[] }
export type CodeRouteChoice = {
  harnessId: string
  credentialMode?: HarnessCredentialMode
  providerId?: string
  model: string
}

type Provider = {
  id: string
  name: string
  kind: string
  configured: boolean
  enabled?: boolean
  credentialStatus?: string
  models?: string[]
  selectedModel?: string
}

function usable(provider: Provider) {
  return provider.configured && provider.enabled !== false &&
    (!provider.credentialStatus || provider.credentialStatus === 'ready' || provider.credentialStatus === 'not-required')
}

/** Kun's own loop: one route per configured HTTP model connection. */
async function kunAgent(runtime: ServerRuntime, legacyModels: string[]): Promise<RemoteCodeAgent> {
  const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
  const routes: RemoteAgentRoute[] = (snapshot?.providers ?? [])
    .filter((provider) => provider.kind === 'http' && usable(provider))
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
          : provider.selectedModel ?? models[0]
      }
    })
    .filter((route) => route.models.length > 0)
    .sort((a, b) => Number(b.providerId === snapshot?.defaultProviderId) - Number(a.providerId === snapshot?.defaultProviderId))
  // Without a model-connection registry the runtime's default route is the only one.
  if (routes.length === 0 && legacyModels.length > 0)
    routes.push({ label: 'Kun', models: legacyModels, defaultModel: runtime.defaultModel ?? legacyModels[0] })
  const definition = runtime.harnesses?.catalog.get('kun')
  return { id: 'kun', name: definition?.displayName ?? 'Kun', routes }
}

function nativeModels(runtime: ServerRuntime, definition: HarnessDefinition): string[] {
  if (definition.modelSource === 'static') return [...definition.staticModels]
  if (definition.modelSource === 'provider') {
    const models = new Set<string>()
    for (const provider of Object.values(runtime.providerConfigs?.() ?? {}))
      for (const model of providerModelIds(provider)) models.add(model)
    return [...models].sort()
  }
  // Spawn-free: the freshest cached probe, else the declared fallback list.
  return runtime.harnesses?.probedModels?.(definition) ?? [...definition.staticModels]
}

/** Third-party Agents: only turn-serving engines with a ready, enabled profile. */
async function externalAgents(runtime: ServerRuntime): Promise<RemoteCodeAgent[]> {
  const harnesses = runtime.harnesses
  if (!harnesses?.readiness) return []
  const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
  const providers = new Map((snapshot?.providers ?? []).map((provider) => [provider.id, provider]))
  const agents: RemoteCodeAgent[] = []
  for (const definition of harnesses.catalog.list()) {
    if (definition.id === 'kun' || definition.availability === 'retired') continue
    if (definition.transport === 'native-loop' || definition.transport === 'terminal' || definition.transport === 'application') continue
    if (harnesses.catalog.isDisabled(definition.id)) continue
    const now = Date.now()
    const profiles = (await harnesses.readiness.readyProfiles(definition.id).catch(() => []))
      .filter((profile) => Date.parse(profile.expiresAt) > now && !profile.gatewayBinding)
    const routes: RemoteAgentRoute[] = []
    for (const profile of profiles) {
      const provider = profile.providerId ? providers.get(profile.providerId) : undefined
      if (profile.providerId && (!provider || !usable(provider))) continue
      const models = profile.credentialMode === 'native-login' && !provider
        ? nativeModels(runtime, definition)
        : provider ? providerModelIds(provider) : []
      if (models.length === 0) continue
      routes.push({
        credentialMode: profile.credentialMode,
        ...(profile.providerId ? { providerId: profile.providerId } : {}),
        label: provider?.name ?? definition.displayName,
        models,
        defaultModel: models[0]
      })
    }
    if (routes.length) agents.push({ id: definition.id, name: definition.displayName, routes })
  }
  return agents
}

export async function codeAgents(runtime: ServerRuntime, legacyModels: string[]): Promise<RemoteCodeAgent[]> {
  const kun = await kunAgent(runtime, legacyModels)
  return [...(kun.routes.length ? [kun] : []), ...(await externalAgents(runtime))]
}

/**
 * Validate a phone's pick against the live catalog before any receipt is
 * written. Throws only fixed codes so the mobile link can report a certain,
 * non-applied rejection.
 */
export async function resolveCodeRoute(
  runtime: ServerRuntime,
  pick: { harnessId?: string; credentialMode?: HarnessCredentialMode; providerId?: string; model?: string },
  legacyModels: string[]
): Promise<CodeRouteChoice> {
  if (!pick.harnessId && !pick.credentialMode && !pick.providerId) {
    const model = pick.model ?? runtime.defaultModel
    if (!model || !legacyModels.includes(model)) throw new Error('MODEL_NOT_AVAILABLE')
    return { harnessId: 'kun', model }
  }
  const agent = (await codeAgents(runtime, legacyModels)).find((entry) => entry.id === (pick.harnessId ?? 'kun'))
  if (!agent) throw new Error('AGENT_NOT_AVAILABLE')
  const route = agent.routes.find((entry) =>
    entry.credentialMode === pick.credentialMode && entry.providerId === pick.providerId)
  const model = pick.model ?? route?.defaultModel
  if (!route || !model || !route.models.includes(model)) throw new Error('MODEL_NOT_AVAILABLE')
  return {
    harnessId: agent.id,
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}),
    ...(route.providerId ? { providerId: route.providerId } : {}),
    model
  }
}
