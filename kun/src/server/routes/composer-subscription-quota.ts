import { ComposerSubscriptionQuotaQuerySchema, ComposerSubscriptionQuotaResponseSchema } from '../../contracts/composer-subscription-quota.js'
import { nativeComposerSubscriptionProfile } from '../../services/native-composer-subscription-quota.js'
import type { ServerRuntime } from './server-runtime.js'
import { ERRORS } from './runtime-error.js'
import { jsonResponse, type JsonResponse } from '../response.js'

export async function readComposerSubscriptionQuota(runtime: ServerRuntime, request: Request, params: Record<string, string>): Promise<JsonResponse> {
  if (!runtime.providerQuotaService?.subscription) return ERRORS.unavailable('Subscription quota is unavailable')
  const query = new URL(request.url).searchParams
  const parsed = ComposerSubscriptionQuotaQuerySchema.safeParse({
    harnessId: params.id,
    ...(query.has('credential_mode') ? { credentialMode: query.get('credential_mode') } : {}),
    ...(query.has('provider_id') ? { providerId: query.get('provider_id') } : {}),
    ...(query.has('account_id') ? { accountId: query.get('account_id') } : {}),
    ...(query.has('workspace_root') ? { workspaceRoot: query.get('workspace_root') } : {}),
    gatewayBinding: query.get('gateway_binding') === '1', forceRefresh: query.get('refresh') === '1'
  })
  if (!parsed.success) return jsonResponse({ code: 'invalid_request', message: 'Invalid subscription quota selection' }, 400)
  const result = await runtime.providerQuotaService.subscription(parsed.data, async (id) => {
    const definition = runtime.harnesses?.catalog.get(id)
    if (!definition || !definition.credentialModes.includes('native-login')) return undefined
    return nativeComposerSubscriptionProfile({ definition, workspaceRoot: parsed.data.workspaceRoot,
      resolveSecretEnv: runtime.harnesses?.resolveSecretEnv })
  })
  return jsonResponse(ComposerSubscriptionQuotaResponseSchema.parse(result))
}
