import type { HarnessCredentialMode, HarnessDefinition } from '../../contracts/harness.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import type { HarnessCatalog } from '../../harness/harness-catalog.js'
import type { HarnessDetector } from '../../harness/harness-detector.js'
import type { HarnessRuntimeMap } from '../../harness/harness-router.js'
import { ADMISSION_RULES } from '../../harness/harness-admission.js'
import { effectiveCapabilitiesForRoute } from '../../harness/effective-capabilities.js'
import { formatGatewayModelId } from '../../harness/gateway-model-id.js'
import { legacyProviderKindFor } from '../../harness/harness-provider-kind.js'

export type HarnessListModel = {
  model: string
  providerId?: string
  credentialMode: HarnessCredentialMode
}

/** A configured provider and the models it advertises (modelConnections). */
export type HarnessProviderModelGroup = {
  providerId: string
  label?: string
  kind?: string
  models: string[]
}

export type HarnessListEntry = {
  harnessId: string
  displayName: string
  ready: boolean
  notReadyReason?: string
  models: HarnessListModel[]
  /** Models omitted by the per-group cap, for the manager to know they exist. */
  modelsTruncated?: number
  admission: { managerWorker: boolean; missing?: string[] }
  /**
   * Terminal-only agent (p4 §3.8): launches inside a Kun terminal tab;
   * dispatch works only through the `kun worker` callback the agent itself
   * chooses to call — never as an automatic worker pick.
   */
  terminalOnly?: boolean
  notes?: string
}

export type HarnessListOutput = {
  agents: HarnessListEntry[]
  profiles: Array<{
    id: string
    name: string
    harnessId?: string
    model?: string
    description?: string
  }>
}

export type HarnessListDeps = {
  catalog: HarnessCatalog
  detector: HarnessDetector
  /** The composition-time runtime map; absent entries mean definition-only. */
  runtimes?: HarnessRuntimeMap
  /** Last successful model probe per harness (spawn-free); statics otherwise. */
  probedModels?: (definition: HarnessDefinition) => string[] | undefined
  /** Configured providers with their model pools, for gateway/provider modes. */
  providers?: () => Promise<HarnessProviderModelGroup[]>
  /** Kun profiles the manager can name in `agent` (10 §2 `profiles`). */
  profiles?: () => Array<{
    name: string
    model?: string
    providerId?: string
    description?: string
  }>
}

/** Per-source cap so the tool result stays bounded (P3-06); overflow is counted. */
const MODELS_PER_GROUP = 8

/**
 * `harness_list` (10 §2): what the manager can dispatch onto. Models are
 * listed per credential mode — native (probe result preferred over the static
 * table) and provider-backed (`kun-gateway` entries in `kun/<p>/<m>` form,
 * `provider` entries bare). Results are a dynamic tool output — never part of
 * the stable system prefix.
 */
export async function listHarnessesForManager(
  deps: HarnessListDeps,
  currentModel?: string
): Promise<HarnessListOutput> {
  const rules = ADMISSION_RULES['manager-worker']
  const runtimeMap = deps.runtimes?.get() ?? {}
  const providers = await deps.providers?.().catch(() => undefined) ?? []
  const agents = await Promise.all(deps.catalog.list().map(async (def) => {
    const terminalOnly = def.transport === 'terminal'
    const status = await deps.detector.status(def.id).catch(() => undefined)
    const ready = def.transport === 'native-loop'
      ? true
      : status?.installed === 'yes' && status.login !== 'signed-out'
    const runtime = runtimeMap[def.transport]
    const effective: HarnessCapabilities = effectiveCapabilitiesForRoute(def, runtime, undefined)
    const missing = rules.required.filter((key) => !effective.statuses[key].supported)
    let truncated = 0
    const cap = (entries: HarnessListModel[]): HarnessListModel[] => {
      if (entries.length <= MODELS_PER_GROUP) return entries
      truncated += entries.length - MODELS_PER_GROUP
      return entries.slice(0, MODELS_PER_GROUP)
    }
    const models: HarnessListModel[] = []
    if (def.credentialModes.includes('native-login')) {
      const probed = def.modelSource === 'probe' ? deps.probedModels?.(def) : undefined
      const native = probed && probed.length > 0 ? probed : def.staticModels
      models.push(...cap(native.map((model) => ({ model, credentialMode: 'native-login' as const }))))
    }
    for (const mode of def.credentialModes) {
      if (mode === 'kun-gateway') {
        for (const group of providers) {
          models.push(...cap(group.models.map((model) => ({
            model: formatGatewayModelId(group.providerId, model),
            providerId: group.providerId,
            credentialMode: 'kun-gateway' as const
          }))))
        }
      } else if (mode === 'provider') {
        const kind = legacyProviderKindFor(def.id)
        for (const group of providers.filter((entry) => !kind || entry.kind === kind)) {
          models.push(...cap(group.models.map((model) => ({
            model,
            providerId: group.providerId,
            credentialMode: 'provider' as const
          }))))
        }
      }
    }
    if (def.id === 'kun' && currentModel && !models.some((entry) => entry.model === currentModel)) {
      models.unshift({ model: currentModel, credentialMode: 'provider' })
    }
    return {
      harnessId: def.id,
      displayName: def.displayName,
      ready,
      ...(ready ? {} : {
        // P4-05: stable code first for the manager; the raw message stays
        // diagnostic detail in parentheses.
        notReadyReason: status?.reasonCode
          ? `${status.reasonCode}${status?.message ? ` (${status.message})` : ''}`
          : status?.message
            ?? (status?.installed === 'no' ? 'not installed'
              : status?.login === 'signed-out' ? 'signed out' : 'not ready')
      }),
      models,
      ...(truncated > 0 ? { modelsTruncated: truncated } : {}),
      admission: {
        managerWorker: !terminalOnly && missing.length === 0,
        ...(missing.length ? { missing } : {})
      },
      ...(terminalOnly
        ? {
            terminalOnly: true,
            notes:
              'terminal only — dispatch goes through the `kun worker` ' +
              'callback the agent chooses to call; never an automatic pick'
          }
        : {})
    } satisfies HarnessListEntry
  }))
  return {
    agents,
    profiles: (deps.profiles?.() ?? []).map((profile) => ({
      id: profile.name,
      name: profile.name,
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.description ? { description: profile.description } : {})
    }))
  }
}
