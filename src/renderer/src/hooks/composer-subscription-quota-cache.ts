import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { requestComposerSubscriptionQuota } from '../agent/composer-subscription-quota-client'
import { QuotaCache } from '../lib/quota-cache'

/** One answer per exact composer selection, shared by every composer that shows it. */
export const composerSubscriptionQuotaCache = new QuotaCache<ComposerSubscriptionQuotaResult>()

export function subscriptionQuotaSelectionKey(request: ComposerSubscriptionQuotaRequest): string {
  return JSON.stringify([request.harnessId, request.credentialMode ?? '', request.providerId ?? '',
    request.accountId ?? '', request.gatewayBinding ?? null, request.workspaceRoot ?? ''])
}

/**
 * Served from the shared cache while fresh. A later read re-asks the host,
 * which resolves the account identity again; `force` also bypasses Kun's cache.
 */
export function readComposerSubscriptionQuota(
  request: ComposerSubscriptionQuotaRequest,
  { force = false }: { force?: boolean } = {}
): Promise<ComposerSubscriptionQuotaResult> {
  return composerSubscriptionQuotaCache.load(
    subscriptionQuotaSelectionKey(request),
    () => requestComposerSubscriptionQuota(force ? { ...request, forceRefresh: true } : request),
    force
  )
}

export function clearComposerSubscriptionQuotaCache(): void { composerSubscriptionQuotaCache.clear() }
