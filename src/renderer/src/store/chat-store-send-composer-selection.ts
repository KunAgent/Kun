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
}) {
  const { queued, overrides, adeEligible, adeDraft } = input
  const state = adeDraft ? { ...input.state, ...adeDraft.composer } : input.state
  const clawModel = activeClawChannel(state)?.model
  const overrideModel = overrides?.model?.trim()
  const composerModel = queued?.model ?? overrideModel ??
    (state.route === 'claw' && clawModel ? clawModel : state.composerModel.trim())
  const composerProviderId = queued?.providerId ?? overrides?.providerId?.trim() ??
    fallbackComposerProviderIdForSend(state)
  const composerAccountId = queued?.accountId ?? overrides?.accountId?.trim() ??
    accountIdForComposerSelection(state.composerModelGroups, composerProviderId, composerModel)
  const { harnessId: composerHarnessId, credentialMode: composerCredentialMode } =
    resolveSendHarnessSelection({
      queued, overrides, adeEligible,
      composerHarnessId: state.composerHarnessId,
      composerCredentialMode: state.composerCredentialMode
    })
  return { composerModel, composerProviderId, composerAccountId,
    composerHarnessId, composerCredentialMode }
}
