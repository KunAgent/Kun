import { effectiveHarnessId } from '../lib/ade-composer-harness'
import type { ChatState, WorkThreadRoute } from '../store/chat-store-types'
import { resolveDirectSendComposerSelection } from '../store/chat-store-send-composer-selection'

type HarnessState = Pick<ChatState,
  'composerHarnessId' | 'composerProviderId' | 'composerModelGroups' | 'threads' | 'activeThreadId'>

/**
 * The Work assistant is Code's agent with the open document as context: the
 * next turn runs on the composer's pick, else the session's pin, else Kun.
 */
export function workAssistantHarnessId(state: HarnessState): string {
  const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
  const providerKind = (state.composerModelGroups ?? [])
    .find((group) => group.providerId === state.composerProviderId)?.kind
  return effectiveHarnessId(state.composerHarnessId, thread?.harnessId, providerKind)
}

/** Kun-only Work tools (canvas, plan) do not exist on an external Agent. */
export function workAssistantUsesExternalAgent(state: HarnessState): boolean {
  return workAssistantHarnessId(state) !== 'kun'
}

/**
 * The composer's choice a new Work session starts with, as a new Code task
 * does: an external Agent is pinned on the thread, and the Agent/model are
 * remembered for the session so selecting it keeps what the draft showed.
 */
export function workAssistantThreadRoute(state: ChatState): WorkThreadRoute {
  const selection = resolveDirectSendComposerSelection({
    state,
    queued: undefined,
    overrides: { useComposerAgent: true },
    adeEligible: true,
    adeDraft: undefined
  })
  const harnessId = selection.composerHarnessId.trim()
  return {
    ...(harnessId ? { harnessId } : {}),
    ...(harnessId && selection.composerCredentialMode ? { credentialMode: selection.composerCredentialMode } : {}),
    ...(selection.composerGatewayBinding ? { gatewayBinding: selection.composerGatewayBinding } : {}),
    ...(selection.composerModel ? { model: selection.composerModel } : {}),
    ...(selection.composerProviderId ? { providerId: selection.composerProviderId } : {}),
    ...(selection.composerAccountId ? { accountId: selection.composerAccountId } : {})
  }
}
