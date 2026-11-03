import type { HarnessGatewayBinding } from '../../kun/src/contracts/harness-gateway-binding'
import type { ProviderQuotaEntry } from './provider-quota'

export type ComposerSubscriptionQuotaRequest = {
  harnessId: string
  credentialMode?: string
  providerId?: string
  accountId?: string
  workspaceRoot?: string
  gatewayBinding?: HarnessGatewayBinding
  forceRefresh?: boolean
}
export type ComposerSubscriptionQuotaResult = {
  entry: ProviderQuotaEntry | null
  refreshedAt: string
  scopeKey?: string
}
