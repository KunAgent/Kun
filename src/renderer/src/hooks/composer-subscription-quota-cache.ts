import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { requestComposerSubscriptionQuota } from '../agent/composer-subscription-quota-client'

const MAX_SELECTIONS = 16
const cache = new Map<string, Promise<ComposerSubscriptionQuotaResult>>()

export function subscriptionQuotaSelectionKey(request: ComposerSubscriptionQuotaRequest): string {
  return JSON.stringify([request.harnessId, request.credentialMode ?? '', request.providerId ?? '',
    request.accountId ?? '', request.gatewayBinding ?? null, request.workspaceRoot ?? ''])
}

/** Every new read asks the host to resolve account identity; only concurrent reads coalesce. */
export function readComposerSubscriptionQuota(request: ComposerSubscriptionQuotaRequest): Promise<ComposerSubscriptionQuotaResult> {
  const key = subscriptionQuotaSelectionKey(request)
  const existing = cache.get(key)
  if (existing) return existing
  const task = requestComposerSubscriptionQuota(request)
  cache.set(key, task)
  while (cache.size > MAX_SELECTIONS) cache.delete(cache.keys().next().value!)
  const cleanup = (): void => { if (cache.get(key) === task) cache.delete(key) }
  void task.then(cleanup, cleanup)
  return task
}

export function clearComposerSubscriptionQuotaCache(): void { cache.clear() }
