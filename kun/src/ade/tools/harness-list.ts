import type { HarnessCredentialMode } from '../../contracts/harness.js'
import type { HarnessCapabilities } from '../../contracts/harness-capabilities.js'
import type { HarnessCatalog } from '../../harness/harness-catalog.js'
import type { HarnessDetector } from '../../harness/harness-detector.js'
import type { HarnessRuntimeMap } from '../../harness/harness-router.js'
import { ADMISSION_RULES } from '../../harness/harness-admission.js'
import { effectiveCapabilitiesForRoute } from '../../harness/effective-capabilities.js'

export type HarnessListEntry = {
  harnessId: string
  displayName: string
  ready: boolean
  notReadyReason?: string
  models: Array<{ model: string; providerId?: string; credentialMode: HarnessCredentialMode }>
  admission: { managerWorker: boolean; missing?: string[] }
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
  /** Kun profiles the manager can name in `agent` (10 §2 `profiles`). */
  profiles?: () => Array<{
    name: string
    model?: string
    providerId?: string
    description?: string
  }>
}

/**
 * `harness_list` (10 §2): what the manager can dispatch onto. Results are a
 * dynamic tool output — never part of the stable system prefix.
 */
export async function listHarnessesForManager(
  deps: HarnessListDeps,
  currentModel?: string
): Promise<HarnessListOutput> {
  const rules = ADMISSION_RULES['manager-worker']
  const runtimeMap = deps.runtimes?.get() ?? {}
  const agents = await Promise.all(deps.catalog.list().map(async (def) => {
    const status = await deps.detector.status(def.id).catch(() => undefined)
    const ready = def.transport === 'native-loop'
      ? true
      : status?.installed === 'yes' && status.login !== 'signed-out'
    const runtime = runtimeMap[def.transport]
    const effective: HarnessCapabilities = effectiveCapabilitiesForRoute(def, runtime, undefined)
    const missing = rules.required.filter((key) => !effective.statuses[key].supported)
    const models = def.staticModels.map((model) => ({
      model,
      credentialMode: def.credentialModes[0]
    }))
    if (def.id === 'kun' && currentModel && !models.some((entry) => entry.model === currentModel)) {
      models.unshift({ model: currentModel, credentialMode: 'provider' })
    }
    return {
      harnessId: def.id,
      displayName: def.displayName,
      ready,
      ...(ready ? {} : {
        notReadyReason: status?.message
          ?? (status?.installed === 'no' ? 'not installed'
            : status?.login === 'signed-out' ? 'signed out' : 'not ready')
      }),
      models,
      admission: {
        managerWorker: missing.length === 0,
        ...(missing.length ? { missing } : {})
      }
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
