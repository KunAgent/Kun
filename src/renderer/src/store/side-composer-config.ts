import { kunToolPermissionModeSettings } from '@shared/app-settings'
import { effectiveHarnessId } from '../lib/ade-composer-harness'
import type { ChatState, SideComposerConfigPatch, SideConversation } from './chat-store-types'

export type SideCredentialMode = NonNullable<SideConversation['credentialMode']>
export type SideComposerConfig = Pick<SideConversation,
  'harnessId' | 'credentialMode' | 'gatewayBinding' | 'model' | 'providerId' |
  'reasoningEffort' | 'fastMode' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
>

export function sideCredentialMode(value: string | undefined): SideCredentialMode | undefined {
  return ['native-login', 'provider', 'kun-gateway'].find((mode) => mode === value?.trim()) as SideCredentialMode | undefined
}

/** Freeze an effective policy, including while the global settings are loading. */
export function defaultSideAgentConfig(state: ChatState, parentId: string) {
  const parent = state.threads.find((thread) => thread.id === parentId)
  const route = parent?.executionConfig?.route
  const providerId = route?.providerId ?? parent?.providerId ?? state.composerProviderId
  const kind = state.composerModelGroups?.find((group) => group.providerId === providerId)?.kind
  const harnessId = effectiveHarnessId(state.composerHarnessId ?? '', route?.harnessId ?? parent?.harnessId, kind)
  const parentHarness = route?.harnessId ?? parent?.harnessId ?? 'kun'
  const useParent = harnessId === parentHarness
  const credentialMode = harnessId === 'kun' ? undefined
    : sideCredentialMode(useParent ? route?.credentialMode ?? state.composerCredentialMode : state.composerCredentialMode)
  const binding = useParent ? route?.gatewayBinding ?? state.composerGatewayBinding : state.composerGatewayBinding
  const fallback = state.composerExecutionSettings ?? kunToolPermissionModeSettings('ask-for-approval')
  return {
    harnessId,
    credentialMode,
    gatewayBinding: credentialMode === 'kun-gateway' && binding ? structuredClone(binding) : undefined,
    approvalPolicy: parent?.approvalPolicy ?? fallback.approvalPolicy,
    sandboxMode: parent?.sandboxMode ?? fallback.sandboxMode,
    approvalReviewer: parent?.approvalReviewer ?? fallback.approvalReviewer
  }
}

/** Explicit undefined clears optional route fields; omitted fields preserve them. */
export function mergeSideComposerConfig<T extends SideComposerConfig>(current: T, patch: SideComposerConfigPatch): T {
  const changed = patch.harnessId !== undefined && patch.harnessId !== current.harnessId
  const next = { ...current, ...(changed ? { credentialMode: undefined, gatewayBinding: undefined } : {}), ...patch }
  next.harnessId = next.harnessId.trim() || current.harnessId
  next.providerId = next.providerId.trim()
  if (next.harnessId === 'kun') next.credentialMode = undefined
  if (next.credentialMode !== 'kun-gateway') next.gatewayBinding = undefined
  if (next.gatewayBinding) next.gatewayBinding = structuredClone(next.gatewayBinding)
  return next
}
