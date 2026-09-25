import { ProviderQuotaListResponseSchema } from '../../kun/src/contracts/provider-quota.js'
import type { RuntimeRequestResult } from '../shared/kun-gui-api'
import type { ProviderQuotaListResult } from '../shared/provider-quota'

type ProviderQuotaRuntimeRequest = (
  path: string,
  method?: string
) => Promise<RuntimeRequestResult>

export async function requestRuntimeProviderQuotas(
  runtimeRequest: ProviderQuotaRuntimeRequest,
  forceRefresh = false
): Promise<ProviderQuotaListResult> {
  const response = await runtimeRequest(
    forceRefresh ? '/v1/provider-quotas?refresh=1' : '/v1/provider-quotas',
    'GET'
  )
  let payload: unknown
  try {
    payload = JSON.parse(response.body)
  } catch {
    throw new Error('Kun returned malformed provider quota data.')
  }
  if (!response.ok) {
    const message = runtimeErrorMessage(payload)
    throw new Error(message || `Kun provider quota request failed (HTTP ${response.status}).`)
  }
  const parsed = ProviderQuotaListResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Kun returned invalid provider quota data.')
  }
  return parsed.data
}

function runtimeErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string') return record.message.trim()
  const error = record.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return ''
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' ? message.trim() : ''
}
