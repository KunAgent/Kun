import { createHash } from 'node:crypto'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { HarnessCredentialMode, HarnessDefinition } from '../../contracts/harness.js'
import type { HarnessGatewayBinding } from '../../contracts/harness-gateway-binding.js'
import type { HarnessEnabledProfile } from '../../config/kun-config-harnesses.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import { freezeHarnessGatewayAliases } from '../../harness/gateway-alias-binding.js'
import { harnessProfileKey } from '../../harness/harness-readiness-profile.js'
import { providerModelIds } from '../../server/routes/model-gateway-core.js'
import { kunAgent, usableProvider } from './kun-routes.js'
import { settleNativeModels } from './native-models.js'
import type { TurnReasoningEffort } from '../../contracts/turn-reasoning.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { allowsEffort, checkedProfiles, modelProfile, probedModelInfo, routeProfiles, type ModelProfiles } from './model-profiles.js'
import { checkedModelInfo, nativeModelInfo, providerModelInfo, routeModelInfo, type ModelInfoMap } from './model-info.js'

/**
 * One selectable credential path for a Code Agent. A phone pick pins the
 * Agent, this route and one of its models; `code.create` re-derives the list
 * and accepts only an exact match, so a phone can never invent a route.
 */
export type RemoteAgentRoute = {
  credentialMode?: HarnessCredentialMode
  providerId?: string
  /** Opaque name for a gateway route; the binding it stands for never leaves the desktop. */
  routeKey?: string
  label: string
  models: string[]
  defaultModel?: string
  profiles?: ModelProfiles
  /** Names, vision and Fast per listed model (remote protocol 0.18, `code.modelInfo`). */
  modelInfo?: ModelInfoMap
}
export type RemoteCodeAgent = { id: string; name: string; routes: RemoteAgentRoute[] }
export type CodeRouteChoice = {
  harnessId: string
  credentialMode?: HarnessCredentialMode
  providerId?: string
  /** Desktop-only: the reviewed gateway binding a keyed route stands for. */
  gatewayBinding?: HarnessGatewayBinding
  model: string
  reasoningEffort?: TurnReasoningEffort
}
/** A route pick as a phone sends it; `routeKey` only ever echoes one the catalog listed. */
export type CodeRoutePick = {
  harnessId?: string
  credentialMode?: HarnessCredentialMode
  providerId?: string
  routeKey?: string
  model?: string
  reasoningEffort?: TurnReasoningEffort
}
/** The phone catalog plus, per keyed route, the binding only this desktop may use. */
type CodeCatalog = { agents: RemoteCodeAgent[]; bindings: Map<string, HarnessGatewayBinding> }

/** A stable, bounded stand-in for a gateway profile, so the route id and approved connections stay here. */
export function gatewayRouteKey(profile: Pick<HarnessEnabledProfile, 'harnessId' | 'credentialMode' | 'gatewayBinding'>): string {
  return 'alias-v1:' + createHash('sha256').update(harnessProfileKey(profile)).digest('hex')
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

/** How long the phone's catalog waits for Agent checks it started, within the desktop Agent list's own 30 s window. */
export const READINESS_WAIT_MS = 3_000

/**
 * The desktop Code picker lists Agents only after `GET /v1/harnesses` warms every
 * enabled profile. The phone must do the same, or an Agent whose proof expired
 * since the desktop last showed its list (Claude Code, Codex…) silently drops out.
 */
async function settleReadiness(runtime: ServerRuntime, ids: string[]): Promise<void> {
  const readiness = runtime.harnesses?.readiness
  if (!readiness || ids.length === 0) return
  for (const id of ids) readiness.warmProfiles(id)
  const deadline = Date.now() + READINESS_WAIT_MS
  while (ids.some((id) => readiness.checking(id)) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100))
}

/**
 * The desktop Code picker's "Kun 网关 · <route>" entry: offered only while the next turn's admission could
 * freeze it, i.e. the route is enabled and one of its exportable targets is still an approved connection.
 */
function gatewayRoute(snapshot: ModelConnectionSnapshot | undefined, profile: HarnessEnabledProfile, bindings: CodeCatalog['bindings']): RemoteAgentRoute | undefined {
  const binding = profile.gatewayBinding
  if (!binding || profile.credentialMode !== 'kun-gateway' || !snapshot) return undefined
  try { freezeHarnessGatewayAliases(snapshot, binding) } catch { return undefined }
  const pool = snapshot.routePools.find((entry) => entry.id === binding.main.routeId && entry.enabled)
  if (!pool) return undefined
  const routeKey = gatewayRouteKey(profile)
  bindings.set(routeKey, structuredClone(binding))
  return { credentialMode: 'kun-gateway', routeKey, label: pool.name, models: [pool.modelId], defaultModel: pool.modelId }
}

/** Third-party Agents: only turn-serving engines with a ready, enabled profile. */
async function externalAgents(runtime: ServerRuntime, bindings: CodeCatalog['bindings']): Promise<RemoteCodeAgent[]> {
  const harnesses = runtime.harnesses
  if (!harnesses?.readiness) return []
  // Installing, enabling or revoking an extension changes its declared Agents.
  await harnesses.extensionAgents?.refresh().catch(() => undefined)
  const candidates = harnesses.catalog.list().filter((definition) => definition.id !== 'kun' && definition.availability !== 'retired' &&
    definition.transport !== 'native-loop' && definition.transport !== 'terminal' && definition.transport !== 'application' &&
    !harnesses.catalog.isDisabled(definition.id))
  await settleReadiness(runtime, candidates.map((definition) => definition.id))
  const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
  const providers = new Map((snapshot?.providers ?? []).map((provider) => [provider.id, provider]))
  const now = Date.now()
  const ready = await Promise.all(candidates.map(async (definition) => ({ definition,
    profiles: (await harnesses.readiness!.readyProfiles(definition.id).catch(() => []))
      .filter((profile) => Date.parse(profile.expiresAt) > now) })))
  const signedIn = (profile: HarnessEnabledProfile) => profile.credentialMode === 'native-login' && !profile.gatewayBinding &&
    !(profile.providerId && providers.has(profile.providerId))
  await settleNativeModels(runtime, ready.filter((entry) => entry.profiles.some(signedIn)).map((entry) => entry.definition))
  const agents: RemoteCodeAgent[] = []
  for (const { definition, profiles } of ready) {
    const routes: RemoteAgentRoute[] = []
    const info = new Map((probedModelInfo(runtime, definition) ?? []).map((entry) => [entry.id, entry]))
    for (const profile of profiles) {
      if (profile.gatewayBinding) {
        const route = gatewayRoute(snapshot, profile, bindings)
        if (route && !routes.some((entry) => entry.routeKey === route.routeKey)) routes.push(route)
        continue
      }
      const provider = profile.providerId ? providers.get(profile.providerId) : undefined
      if (profile.providerId && (!provider || !usableProvider(provider))) continue
      const native = profile.credentialMode === 'native-login' && !provider
      const models = native ? nativeModels(runtime, definition) : provider ? providerModelIds(provider) : []
      if (models.length === 0) continue
      routes.push(checkedModelInfo(checkedProfiles({
        credentialMode: profile.credentialMode,
        ...(profile.providerId ? { providerId: profile.providerId } : {}),
        label: provider?.name ?? definition.displayName,
        models,
        // The Agent's own recommended model, as the desktop picker preselects it.
        defaultModel: (native ? models.find((model) => info.get(model)?.isDefault) : undefined) ?? models[0],
        // Native catalog facts describe only the Agent's own login.
        ...(native ? routeProfiles(models, (model) => {
          const entry = info.get(model)
          return modelProfile(entry?.reasoningEfforts, entry?.defaultReasoningEffort)
        }) : {}),
        // The Agent's own names and inputs for its login; a Kun connection's inputs otherwise (Fast is Kun's loop only).
        ...routeModelInfo(models, (model) => native ? nativeModelInfo(model, info.get(model))
          : provider ? providerModelInfo(provider, model, false) : undefined)
      })))
    }
    if (routes.length) agents.push({ id: definition.id, name: definition.displayName, routes })
  }
  return agents
}

async function codeCatalog(runtime: ServerRuntime, legacyModels: string[]): Promise<CodeCatalog> {
  const kun = await kunAgent(runtime, legacyModels), bindings: CodeCatalog['bindings'] = new Map()
  return { agents: [...(kun.routes.length ? [kun] : []), ...(await externalAgents(runtime, bindings))], bindings }
}

export async function codeAgents(runtime: ServerRuntime, legacyModels: string[]): Promise<RemoteCodeAgent[]> {
  return (await codeCatalog(runtime, legacyModels)).agents
}

/**
 * Validate a phone's pick against the live catalog before any receipt is
 * written. Throws only fixed codes so the mobile link can report a certain,
 * non-applied rejection.
 */
export async function resolveCodeRoute(
  runtime: ServerRuntime,
  pick: CodeRoutePick,
  legacyModels: string[]
): Promise<CodeRouteChoice> {
  if (!pick.harnessId && !pick.credentialMode && !pick.providerId && !pick.routeKey) {
    const model = pick.model ?? runtime.defaultModel
    // A depth is checked against an exact route's profile, which a legacy model-only pick does not name.
    if (!model || !legacyModels.includes(model) || pick.reasoningEffort) throw new RemoteNoEffect('MODEL_NOT_AVAILABLE')
    return { harnessId: 'kun', model }
  }
  const catalog = await codeCatalog(runtime, legacyModels)
  const agent = catalog.agents.find((entry) => entry.id === (pick.harnessId ?? 'kun'))
  if (!agent) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
  // A keyed route answers only to its own key, so a phone without keys keeps its old, exact matches.
  const route = agent.routes.find((entry) => entry.routeKey === pick.routeKey &&
    entry.credentialMode === pick.credentialMode && entry.providerId === pick.providerId)
  const gatewayBinding = route?.routeKey ? catalog.bindings.get(route.routeKey) : undefined
  const model = pick.model ?? route?.defaultModel
  if (!route || !model || !route.models.includes(model) || !allowsEffort(route, model, pick.reasoningEffort) ||
    (route.routeKey && !gatewayBinding))
    throw new RemoteNoEffect('MODEL_NOT_AVAILABLE')
  return {
    harnessId: agent.id,
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}),
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(gatewayBinding ? { gatewayBinding } : {}),
    model,
    ...(pick.reasoningEffort ? { reasoningEffort: pick.reasoningEffort } : {})
  }
}
