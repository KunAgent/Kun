import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { ComposerSubscriptionQuotaResponseSchema } from '../../../../kun/src/contracts/composer-subscription-quota'
import { rendererRuntimeClient } from './runtime-client'

/** Selection-scoped, spawn-free quota read. No credentials cross this boundary. */
export async function requestComposerSubscriptionQuota(request: ComposerSubscriptionQuotaRequest): Promise<ComposerSubscriptionQuotaResult> {
  const query = new URLSearchParams()
  if (request.credentialMode) query.set('credential_mode', request.credentialMode)
  if (request.providerId) query.set('provider_id', request.providerId)
  if (request.accountId) query.set('account_id', request.accountId)
  if (request.workspaceRoot) query.set('workspace_root', request.workspaceRoot)
  if (request.gatewayBinding) query.set('gateway_binding', '1')
  if (request.forceRefresh) query.set('refresh', '1')
  const response = await rendererRuntimeClient.runtimeRequest(
    `/v1/harnesses/${encodeURIComponent(request.harnessId)}/subscription-quota?${query}`, 'GET', undefined,
    { priority: 'background' }
  )
  if (!response.ok) throw new Error('Subscription quota is unavailable.')
  return ComposerSubscriptionQuotaResponseSchema.parse(JSON.parse(response.body))
}
