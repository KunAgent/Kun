import type { WorkerRecord } from '../contracts/ade.js'
import type {
  HarnessCredentialMode,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'
import type { HarnessCatalog } from '../harness/harness-catalog.js'
import type { WorkerRouteSelection } from './worker-selector.js'

/** Route resolved for a new worker (10 §3): explicit pin, selection, or fallback. */
export type ResolvedWorkerRoute = {
  route: HarnessRoute
  profileId?: string
  selection?: WorkerRecord['selection']
}

/**
 * Resolve the worker route for `worker_create` (09 §4.1, 10 §3.2). An explicit
 * `agent` pin is validated against the harness definition and wins outright;
 * otherwise the injected `select` runs the deterministic selector, and when no
 * selector is wired the manager's own provider/model on the native Kun loop is
 * the fallback.
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
  select?: () => Promise<WorkerRouteSelection | { error: string }>
}): Promise<ResolvedWorkerRoute | { error: string }> {
  const requested = input.agent
  if (requested?.harnessId) {
    const def = input.catalog.get(requested.harnessId as HarnessId)
    if (!def) return { error: `unknown harness ${requested.harnessId}` }
    const model = requested.model?.trim()
    if (def.staticModels.length > 0 && (!model || !def.staticModels.includes(model))) {
      return {
        error: `model ${model || '(missing)'} is not in harness ${def.id}'s model list`
      }
    }
    const credentialMode = requested.credentialMode?.trim()
    if (credentialMode && !def.credentialModes.includes(credentialMode as HarnessCredentialMode)) {
      return {
        error: `credentialMode ${credentialMode} is not supported by harness ${def.id}`
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
        model: model || def.staticModels[0] || fallbackModel || '',
        ...(requested.providerId?.trim() || fallbackProvider
          ? { providerId: requested.providerId?.trim() ?? fallbackProvider }
          : {}),
        credentialMode: (credentialMode as HarnessCredentialMode | undefined)
          ?? def.credentialModes[0]
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
