/**
 * Graph planning harness summary: one line
 * per ready harness — display name, what it is suited for, and quota state —
 * injected into the planning turn's dynamic context (never the stable
 * prefix). Both the native loop and delegated runtimes call the same builder
 * so the planner sees an identical routing menu everywhere.
 */
import type {
  HarnessDefinition,
  HarnessId,
  HarnessStatus,
  HarnessTransport
} from '../contracts/harness.js'
import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import { defaultCredentialMode } from '../harness/resolve-turn-harness.js'
import {
  quotaEntryFor,
  quotaUsedPercent
} from './quota-snapshot.js'

const SUITABILITY: Record<HarnessTransport, string> = {
  'native-loop': 'Kun agent loop with full Kun tools and host sandboxing',
  'agent-sdk': 'delegated agent loop; runs its own tools in its own sandbox',
  'cursor-sdk': 'delegated agent loop; runs its own tools in its own sandbox',
  'antigravity-cli': 'one-shot CLI tasks; no mid-turn steering or streaming',
  acp: 'external CLI agent over ACP; runs its own tools',
  'codex-app-server': 'native codex app-server session; steer/fork/approvals',
  'pi-rpc': 'pi agent over RPC; runs its own tools',
  terminal: 'interactive terminal agent',
  application: 'external application; starts through its configured launcher'
}

export type GraphHarnessSummaryDeps = {
  catalog: {
    list(): HarnessDefinition[]
    isDisabled?(id: HarnessId): boolean
  }
  detector: {
    cachedStatus(id: HarnessId): HarnessStatus | undefined
    /** Settled verdict kept past its TTL; see HarnessDetector.lastKnownStatus. */
    lastKnownStatus?(id: HarnessId): HarnessStatus | undefined
    status(id: HarnessId): Promise<HarnessStatus>
  }
  readiness?: Pick<import('../harness/harness-readiness.js').HarnessReadinessService, 'readyProfiles' | 'warmProfiles'>
  quota(): Promise<ProviderQuotaListResponse | null>
}

/**
 * The menu re-renders on every model step and lands in the model context only
 * when its text changes, so it must not track probe timing: an expired
 * detector entry keeps its last verdict while a refresh runs, a failed quota
 * read keeps the last snapshot, and quota shows in ten-point bands.
 */
export function createGraphHarnessSummary(
  deps: GraphHarnessSummaryDeps
): () => Promise<string | undefined> {
  let lastSnapshot: ProviderQuotaListResponse | null = null
  return async () => {
    const definitions = deps.catalog
      .list()
      .filter((definition) => !deps.catalog.isDisabled?.(definition.id))
    const snapshot = (await deps.quota().catch(() => null)) ?? lastSnapshot
    if (snapshot) lastSnapshot = snapshot
    const lines: string[] = []
    for (const definition of definitions) {
      if (definition.id !== 'kun' && deps.readiness) {
        deps.readiness.warmProfiles(definition.id)
        if ((await deps.readiness.readyProfiles(definition.id)).length === 0) continue
      }
      const status = readiness(deps, definition)
      if (status === undefined) continue
      lines.push(
        `- ${definition.id} (${definition.displayName}) — ` +
        `${SUITABILITY[definition.transport]}; ` +
        `${status}${quotaState(snapshot, definition)}`
      )
    }
    if (!lines.length) return undefined
    return [
      'Graph worker harnesses: set a task\'s harnessId to pin its worker ' +
        'runtime; omit it for the default Kun loop.',
      ...lines
    ].join('\n')
  }
}

/**
 * Native loop is always ready. External harnesses gate on the cached
 * detector status so planning never blocks on a probe; a missing cache
 * entry triggers a background refresh exactly like the HarnessRouter, and the
 * last settled verdict stands in until that refresh lands.
 */
function readiness(
  deps: GraphHarnessSummaryDeps,
  definition: HarnessDefinition
): string | undefined {
  if (definition.transport === 'native-loop') return ''
  let status = deps.detector.cachedStatus(definition.id)
  if (!status) {
    void deps.detector.status(definition.id).catch(() => undefined)
    status = deps.detector.lastKnownStatus?.(definition.id)
    if (!status) return undefined
  }
  if (status.installed !== 'yes') return undefined
  return status.login === 'signed-out' ? 'installed, not logged in; ' : ''
}

function quotaState(
  snapshot: ProviderQuotaListResponse | null,
  definition: HarnessDefinition
): string {
  if (!snapshot) return 'quota: unknown'
  const entry = quotaEntryFor(snapshot, {
    harnessId: definition.id,
    model: 'graph-worker',
    credentialMode: defaultCredentialMode(definition.id, definition)
  })
  const used = entry ? quotaUsedPercent(entry) : undefined
  if (used === undefined) return 'quota: unknown'
  if (used >= 100) return 'quota: 100% used'
  const band = Math.max(0, Math.floor(used / 10) * 10)
  return `quota: ${band}-${band + 9}% used`
}
