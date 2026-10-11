import type { ComposerSubscriptionQuotaRequest } from '@shared/composer-subscription-quota'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { accountIdForComposerSelection } from '../../store/chat-store-helpers'

/** Match send admission; a native-login route never inherits a model-matched HTTP account. */
export function composerSubscriptionSelection(input: {
  enabled: boolean
  harnessId?: string
  credentialMode?: string
  providerId?: string
  model: string
  workspaceRoot?: string
  modelGroups?: readonly ModelProviderModelGroup[]
  gatewayBinding?: ComposerSubscriptionQuotaRequest['gatewayBinding']
}): ComposerSubscriptionQuotaRequest | undefined {
  if (!input.enabled || !['codex', 'claude-code'].includes(input.harnessId ?? '') || input.gatewayBinding) return undefined
  if (input.credentialMode !== 'native-login' && input.credentialMode !== 'provider') return undefined
  const providerId = input.providerId?.trim() ?? ''
  if (input.credentialMode === 'provider' && !providerId) return undefined
  const accountId = input.credentialMode === 'native-login' ? ''
    : accountIdForComposerSelection(input.modelGroups, providerId, input.model)
  return {
    harnessId: input.harnessId!, credentialMode: input.credentialMode,
    providerId: providerId || 'default', ...(accountId ? { accountId } : {}),
    ...(input.workspaceRoot?.trim() ? { workspaceRoot: input.workspaceRoot.trim() } : {})
  }
}
