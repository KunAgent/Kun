import type { ProviderQuotaEntry } from '../contracts/provider-quota.js'
import type { ProviderQuotaService } from './provider-quota-service-core.js'

/** Old-account quota observations become unknown immediately when configuration changes. */
export function createProviderQuotaRoutingLookup(options: {
  service: Pick<ProviderQuotaService, 'list'>; providerIds(): string[]; generation(): number; now?(): number
}) {
  const now = options.now ?? Date.now
  const entries = new Map<string, ProviderQuotaEntry>()
  let generation = options.generation(), fetchedAt = 0, pending: Promise<void> | undefined, failures = 0, stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), Math.min(5 * 60_000 * 2 ** failures, 30 * 60_000))
    timer.unref?.()
  }
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (pending) return pending
    const observedGeneration = options.generation(), providerIds = options.providerIds()
    if (!providerIds.length) { schedule(); return Promise.resolve() }
    pending = options.service.list({ providerIds, includeLocalCosts: false }).then((response) => {
      if (stopped || observedGeneration !== options.generation()) return
      generation = observedGeneration; fetchedAt = now(); entries.clear()
      for (const entry of response.entries) entries.set(entry.providerId.trim().toLowerCase(), entry)
      failures = 0
    }).catch(() => { failures++ }).finally(() => { pending = undefined; schedule() })
    return pending
  }
  void refresh()
  return {
    get(providerId: string): ProviderQuotaEntry | undefined {
      const entry = generation === options.generation() ? entries.get(providerId.trim().toLowerCase()) : undefined
      if ((!entry || now() - fetchedAt > 5 * 60_000) && options.providerIds().length) void refresh()
      return entry
    },
    refresh,
    stop() { stopped = true; clearTimeout(timer); entries.clear() }
  }
}
