import type { ChatState, QueuedUserMessage } from './chat-store-types'
import type { AdeDraftSendSnapshot } from './chat-store-ade-send-snapshot'
import { activeClawChannel, accountIdForComposerSelection } from './chat-store-helpers'
import { fallbackComposerProviderIdForSend } from './chat-store-thread-action-helpers'
import { resolveSendHarnessSelection } from '../lib/ade-composer-harness'

/** Resolve one direct turn from its captured ADE draft or current thread state. */
export function resolveDirectSendComposerSelection(input: {
  state: ChatState
  queued: QueuedUserMessage | undefined
  overrides: Parameters<ChatState['sendMessage']>[2]
  adeEligible: boolean
  adeDraft: AdeDraftSendSnapshot | undefined
  codeDraftComposer?: AdeDraftSendSnapshot['composer']
}) {
  const { queued, overrides, adeEligible, adeDraft, codeDraftComposer } = input
  const state = adeDraft ? { ...input.state, ...adeDraft.composer }
    : codeDraftComposer ? { ...input.state, ...codeDraftComposer } : input.state
  const clawModel = activeClawChannel(state)?.model
  const overrideModel = overrides?.model?.trim()
  const composerModel = queued ? queued.model ?? '' : overrideModel ??
    (state.route === 'claw' && clawModel ? clawModel : state.composerModel.trim())
  const { harnessId: composerHarnessId, credentialMode: composerCredentialMode } =
    resolveSendHarnessSelection({
      queued, overrides, adeEligible,
      composerHarnessId: state.composerHarnessId,
      composerCredentialMode: state.composerCredentialMode
    })
  const nativeLogin = composerHarnessId !== 'kun' && composerCredentialMode === 'native-login'
  const externalProvider = Boolean(composerHarnessId && composerHarnessId !== 'kun' && !nativeLogin)
  const composerProviderId = nativeLogin ? '' : queued ? queued.providerId ?? '' : overrides?.providerId?.trim() ??
    (externalProvider ? state.composerProviderId.trim() : fallbackComposerProviderIdForSend(state))
  const composerAccountId = nativeLogin ? '' : queued ? queued.accountId ?? '' : overrides?.accountId?.trim() ??
    accountIdForComposerSelection(state.composerModelGroups, composerProviderId, composerModel)
  return { composerModel, composerProviderId, composerAccountId,
    composerHarnessId, composerCredentialMode }
}

export function composerSelectionNeedsProvider(selection: ReturnType<typeof resolveDirectSendComposerSelection>): boolean {
  if (selection.composerHarnessId === 'kun' && !selection.composerModel.trim()) return true
  return Boolean(selection.composerHarnessId && selection.composerHarnessId !== 'kun' &&
    ['provider', 'kun-gateway'].includes(selection.composerCredentialMode) && !selection.composerProviderId)
}
