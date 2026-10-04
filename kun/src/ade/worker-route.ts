import type { WorkerRecord } from '../contracts/ade.js'
import type {
  HarnessCredentialMode,
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'
import type { HarnessDefaultsEntry } from '../config/kun-config-application.js'
import type { HarnessCatalog } from '../harness/harness-catalog.js'
import {
  formatGatewayModelId,
  parseGatewayModelId
} from '../harness/gateway-model-id.js'
import { legacyProviderKindFor } from '../harness/harness-provider-kind.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'
import type { WorkerCreateInput } from './manager-worker-inputs.js'
import {
  NoEligibleWorkerError,
  selectWorkerRoute,
  type WorkerRouteSelection
} from './worker-selector.js'

/** Route resolved for a new worker (10 §3): explicit pin, selection, or fallback. */
export type ResolvedWorkerRoute = {
  route: HarnessRoute
  profileId?: string
  selection?: WorkerRecord['selection']
}

/**
 * A configured provider's model pool entry (modelConnections snapshot). `kind`
 * is the connection kind (`http`, `cursor-sdk`, ...) used by provider-mode
 * harnesses that only accept their own connection type.
 */
export type WorkerProviderPoolEntry = {
  kind?: string
  models: string[]
  gatewayExportable?: boolean
}

/**
 * Resolve the worker route for `worker_create` (09 §4.1, 10 §3.2). An explicit
 * `agent` pin is validated against the harness definition and wins outright;
 * otherwise the injected `select` runs the deterministic selector, and when no
 * selector is wired the manager's own provider/model on the native Kun loop is
 * the fallback.
 *
 * Model validation follows the credential mode (P3-06): `kun-gateway` and
 * `provider` modes check the configured provider pool instead of the harness's
 * static list; `native-login` on a `probe` harness uses the last cached probe
 * result and falls back to the static list when none is cached.
 */
export async function resolveWorkerRoute(input: {
  catalog: Pick<HarnessCatalog, 'get'>
  /** Manager thread's own model/provider; default for provider-sourced routes. */
  managerModel?: string
  managerProviderId?: string
  agent?: {
    harnessId?: string
    model?: string
    providerId?: string
    credentialMode?: string
  }
  /**
   * Configured provider pool lookup. Returns `undefined` for an unknown
   * provider id; when the dep itself is absent no pool validation runs.
   */
  providerPool?: (providerId: string) => Promise<WorkerProviderPoolEntry | undefined>
  /**
   * Last successful model-probe result for the harness (spawn-free cache
   * read). `undefined` falls back to the definition's static list.
   */
  probedModels?: (definition: HarnessDefinition) => string[] | undefined
  /**
   * `agents.kun.harnesses.defaults` lookup (p4 §3.6): fields the caller did
   * not pin explicitly fall back to the configured per-harness defaults.
   */
  harnessDefaults?: (harnessId: HarnessId) => HarnessDefaultsEntry | undefined
  select?: () => Promise<WorkerRouteSelection | { error: string }>
}): Promise<ResolvedWorkerRoute | { error: string }> {
  const requested = input.agent
  if (requested?.harnessId) {
    const def = input.catalog.get(requested.harnessId as HarnessId)
    if (!def) return { error: `unknown harness ${requested.harnessId}` }
    const defaults = input.harnessDefaults?.(def.id)
    const credentialMode = requested.credentialMode?.trim() || defaults?.credentialMode
    if (credentialMode && !def.credentialModes.includes(credentialMode as HarnessCredentialMode)) {
      return {
        error: `credentialMode ${credentialMode} is not supported by harness ${def.id}`
      }
    }
    const effectiveMode =
      (credentialMode as HarnessCredentialMode | undefined) ?? def.credentialModes[0]
    const model = requested.model?.trim() || defaults?.model?.trim()
    if (effectiveMode === 'kun-gateway' || effectiveMode === 'provider') {
      return providerRoute(input, def, effectiveMode, model, defaults)
    }
    // Native-login modes validate against the harness's own list: the last
    // cached probe result when the modelSource probes, else the static table.
    const probed = def.modelSource === 'probe' ? input.probedModels?.(def) : undefined
    const known = probed && probed.length > 0 ? probed : def.staticModels
    if (known.length > 0 && (!model || !known.includes(model))) {
      return {
        error: `model ${model || '(missing)'} is not in harness ${def.id}'s model list`
      }
    }
    // Provider-sourced harnesses share the manager's provider pool; probed
    // harnesses keep their own default when no model was requested.
    const fallbackModel = def.modelSource === 'provider' ? input.managerModel?.trim() : ''
    const fallbackProvider = def.modelSource === 'provider'
      ? input.managerProviderId?.trim()
      : undefined
    return {
      route: {
        harnessId: def.id,
        model: model || known[0] || fallbackModel || '',
        ...(requested.providerId?.trim() || defaults?.providerId || fallbackProvider
          ? { providerId: requested.providerId?.trim() ?? defaults?.providerId ?? fallbackProvider }
          : {}),
        credentialMode: effectiveMode
      }
    }
  }
  if (input.select) {
    const selected = await input.select()
    if ('error' in selected) return selected
    return {
      route: selected.route,
      ...(selected.profileId ? { profileId: selected.profileId } : {}),
      selection: {
        reason: selected.reason,
        score: selected.score,
        alternatives: selected.alternatives.map((candidate) => ({
          route: candidate.route,
          ...(candidate.profileId ? { profileId: candidate.profileId } : {}),
          label: candidate.label.slice(0, 128),
          score: candidate.score
        }))
      }
    }
  }
  return {
    route: {
      harnessId: 'kun' as HarnessRoute['harnessId'],
      model: input.managerModel?.trim() || '',
      ...(input.managerProviderId?.trim()
        ? { providerId: input.managerProviderId.trim() }
        : {}),
      credentialMode: 'provider' as HarnessCredentialMode
    }
  }
}

/**
 * Manager-side route resolution for `worker_create` (09 §4.1): loads the
 * manager thread for provider/model fallback, then runs the deterministic
 * selector (10 §3.2) when no explicit `agent` pin was given.
 */
export async function resolveManagerWorkerRoute(
  deps: Pick<
    ManagerRuntimeDeps,
    | 'threads' | 'catalog' | 'detector' | 'capabilitiesForRoute' | 'selector'
    | 'providerPool' | 'probedModels' | 'allowUnattendedFullAccess' | 'language'
    | 'harnessDefaults'
  >,
  ctx: ManagerToolContext,
  input: WorkerCreateInput,
  isolated: boolean,
  recentFailures: (teamId: string, harnessId: HarnessId) => Promise<number>
): Promise<ResolvedWorkerRoute | { error: string }> {
  const managerThread = await deps.threads.get(ctx.threadId).catch(() => null)
  const selector = deps.selector
  return resolveWorkerRoute({
    catalog: deps.catalog,
    managerModel: managerThread?.model,
    managerProviderId: managerThread?.providerId,
    agent: input.agent,
    providerPool: deps.providerPool,
    probedModels: deps.probedModels,
    harnessDefaults: deps.harnessDefaults,
    ...(selector
      ? {
          select: () =>
            selectWorkerRoute(
              {
                catalog: deps.catalog,
                detector: deps.detector,
                capabilitiesForRoute: (route) => deps.capabilitiesForRoute(route),
                ...selector,
                isolated,
                unattended: !ctx.authority.interactive,
                allowUnattendedFullAccess:
                  deps.allowUnattendedFullAccess?.() === true,
                managerRoute: () => ({
                  model: managerThread?.model?.trim() || undefined,
                  providerId: managerThread?.providerId?.trim() || undefined
                }),
                recentFailures: (teamId, harnessId) =>
                  recentFailures(teamId, harnessId),
                language: deps.language
              },
              {
                task: `${input.label}\n${input.task}`,
                ...(input.role ? { role: input.role } : {}),
                teamId: ctx.threadId,
                workspace: ctx.workspace
              }
            ).catch((error) => {
              if (error instanceof NoEligibleWorkerError) {
                return { error: error.message }
              }
              throw error
            })
        }
      : {})
  })
}

/**
 * `provider`/`kun-gateway` route (P3-06): the model addresses a configured
 * provider — `kun/<provider>/<model>` or a bare model plus providerId (the
 * manager's own provider when neither is pinned). The provider must be a
 * configured model connection, and when its model list is known the requested
 * model must be offered. Gateway routes are normalized to the `kun/` form the
 * grant and the child env consume.
 */
async function providerRoute(
  input: {
    managerModel?: string
    managerProviderId?: string
    agent?: { providerId?: string }
    providerPool?: (providerId: string) => Promise<WorkerProviderPoolEntry | undefined>
  },
  def: HarnessDefinition,
  mode: 'kun-gateway' | 'provider',
  model: string | undefined,
  defaults?: HarnessDefaultsEntry
): Promise<ResolvedWorkerRoute | { error: string }> {
  const direct = parseGatewayModelId(model)
  const managerProviderId = input.managerProviderId?.trim()
  const providerId = direct?.providerId ?? input.agent?.providerId?.trim()
    ?? defaults?.providerId ?? managerProviderId
  const chosen = direct?.model ?? model
    ?? (providerId === managerProviderId ? input.managerModel?.trim() : undefined)
  // A gateway turn cannot form its kun/<provider>/<model> address without a
  // provider, so kun-gateway must resolve one. `provider` mode tolerates a
  // providerless route — the runtime falls back to the default connection.
  if (!providerId) {
    if (mode === 'provider' && (chosen || input.managerModel?.trim())) {
      return {
        route: {
          harnessId: def.id,
          model: chosen ?? input.managerModel?.trim() ?? '',
          credentialMode: mode
        }
      }
    }
    return {
      error: `credential mode ${mode} for harness ${def.id} needs a provider — ` +
        'pass model as kun/<provider>/<model> or set providerId'
    }
  }
  if (!chosen) {
    return {
      error: `credential mode ${mode} for harness ${def.id} needs a model — ` +
        'pass model or kun/<provider>/<model>'
    }
  }
  if (mode === 'kun-gateway' && !input.providerPool) {
    return { error: 'Gateway provider eligibility is unavailable' }
  }
  if (input.providerPool) {
    const pool = await input.providerPool(providerId).catch(() => undefined)
    if (!pool) {
      return { error: `provider "${providerId}" is not a configured Kun model connection` }
    }
    if (mode === 'kun-gateway' && pool.gatewayExportable !== true) {
      return { error: `provider "${providerId}" is not eligible for model gateway export` }
    }
    const requiredKind = mode === 'provider' ? legacyProviderKindFor(def.id) : undefined
    if (requiredKind && pool.kind && pool.kind !== requiredKind) {
      return {
        error: `provider "${providerId}" is a ${pool.kind} connection ` +
          `and cannot serve harness ${def.id}`
      }
    }
    if ((mode === 'kun-gateway' || pool.models.length > 0) && !pool.models.includes(chosen)) {
      return { error: `provider "${providerId}" does not offer model "${chosen}"` }
    }
  }
  return {
    route: {
      harnessId: def.id,
      model: mode === 'kun-gateway' ? formatGatewayModelId(providerId, chosen) : chosen,
      providerId,
      credentialMode: mode
    }
  }
}
