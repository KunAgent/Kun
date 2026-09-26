import type { HarnessId, HarnessRoute } from '../contracts/harness.js'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResponse
} from '../contracts/provider-quota.js'

/**
 * 60-second quota snapshot wrapper (10 §3.2). The worker selector calls this
 * once per route decision; failures return `null` so quota probing can never
 * block worker creation.
 */
export const QUOTA_SNAPSHOT_TTL_MS = 60_000

export function createQuotaSnapshot(deps: {
  list(): Promise<ProviderQuotaListResponse>
  nowMs?: () => number
  ttlMs?: number
}): () => Promise<ProviderQuotaListResponse | null> {
  const nowMs = deps.nowMs ?? Date.now
  const ttlMs = deps.ttlMs ?? QUOTA_SNAPSHOT_TTL_MS
  let cached: { at: number; value: ProviderQuotaListResponse | null } | undefined
  let inflight: Promise<ProviderQuotaListResponse | null> | undefined
  return async () => {
    if (cached && nowMs() - cached.at < ttlMs) return cached.value
    if (inflight) return inflight
    inflight = deps
      .list()
      .then((value) => value)
      .catch(() => null)
      .then((value) => {
        cached = { at: nowMs(), value }
        inflight = undefined
        return value
      })
    return inflight
  }
}

/**
 * Subscription preset backing a `native-login` credential path. Quota entries
 * are matched by `presetId` first because user-created provider profile ids
 * may differ from the preset id.
 */
const NATIVE_LOGIN_QUOTA_PRESET: Partial<Record<HarnessId, string>> = {
  'claude-code': 'claude-subscription',
  antigravity: 'gemini-subscription',
  'gemini-cli': 'gemini-cli-subscription',
  cursor: 'cursor-subscription',
  codex: 'codex',
  opencode: 'opencode-go'
}

/**
 * The provider/preset id a route bills against (10 §3.2). `native-login`
 * routes map onto their subscription preset; `provider`/`kun-gateway` routes
 * bill the configured provider profile directly.
 */
export function quotaProviderIdFor(route: HarnessRoute): string | undefined {
  if (route.credentialMode === 'native-login') {
    return NATIVE_LOGIN_QUOTA_PRESET[route.harnessId]
  }
  return route.providerId
}

/** Find the quota entry a route bills against (providerId, then presetId). */
export function quotaEntryFor(
  snapshot: ProviderQuotaListResponse,
  route: HarnessRoute
): ProviderQuotaEntry | undefined {
  const id = quotaProviderIdFor(route)
  if (!id) return undefined
  return (
    snapshot.entries.find((entry) => entry.providerId === id) ??
    snapshot.entries.find((entry) => entry.presetId === id)
  )
}

/** Tightest reported utilization of an entry (0-100); undefined when unknown. */
export function quotaUsedPercent(entry: ProviderQuotaEntry): number | undefined {
  const percents = entry.metrics
    .map((metric) => metric.usedPercent)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return percents.length ? Math.max(...percents) : undefined
}
