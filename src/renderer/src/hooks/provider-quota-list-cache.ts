import type { ProviderQuotaListResult } from '@shared/provider-quota'
import { QuotaCache } from '../lib/quota-cache'

/** Every provider's allowance, as the right panel lists them: one answer for the whole workbench. */
export const providerQuotaListCache = new QuotaCache<ProviderQuotaListResult>()
export const PROVIDER_QUOTA_LIST_KEY = 'all'

/** Served from the shared cache while fresh; `force` asks the vendors again. */
export function readProviderQuotaList({ force = false }: { force?: boolean } = {}): Promise<ProviderQuotaListResult> {
  return providerQuotaListCache.load(PROVIDER_QUOTA_LIST_KEY, async () => {
    const next = await window.kunGui.listProviderQuotas(force ? { forceRefresh: true } : undefined)
    if (!next) throw new Error('')
    return next
  }, force)
}

export function clearProviderQuotaListCache(): void { providerQuotaListCache.clear() }
