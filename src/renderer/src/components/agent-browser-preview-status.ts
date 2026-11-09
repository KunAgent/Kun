import type { BrowserUseViewState } from '@shared/browser-use'

export function browserPreviewStatusKey(state: BrowserUseViewState, operationError?: string) {
  if (operationError || state.lifecycle === 'error' || state.capabilityStatus === 'unavailable' || state.capabilityStatus === 'disabled') return 'browserUsePreviewError'
  if (state.lifecycle === 'stopped') return 'browserUseStopped'
  if (state.pendingOriginConsent || state.pendingActionConsent) return 'browserUseNeedsAttention'
  if (state.controlOwner === 'manual') return 'browserUseManualPaused'
  if (state.lifecycle === 'loading') return 'browserUseStartingTitle'
  return 'browserUseAgentControl'
}
