import { jsonResponse, type JsonResponse } from '../response.js'
import type { ProviderQuotaService } from '../../services/provider-quota-service.js'

export async function listProviderQuotas(
  service: Pick<ProviderQuotaService, 'list'>,
  request: Request
): Promise<JsonResponse> {
  // `?refresh=1` is the manual GUI refresh path: it bypasses the shared TTL
  // cache; plain polls reuse cached entries.
  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1'
  return jsonResponse(await service.list(forceRefresh ? { forceRefresh: true } : undefined))
}
