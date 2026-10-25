import { useCallback, useEffect, useState } from 'react'
import { useChatStore } from '../../store/chat-store'
import type { SideComposerConfigPatch, SideConversation } from '../../store/chat-store-types'
import { defaultSideModel, defaultSideProviderId } from '../../store/chat-store-side-runtime'
import { defaultSideAgentConfig, mergeSideComposerConfig, type SideComposerConfig } from '../../store/side-composer-config'

export type { SideComposerConfig } from '../../store/side-composer-config'

function seedConfig(parentThreadId: string | null): SideComposerConfig {
  const state = useChatStore.getState()
  const parentId = parentThreadId ?? ''
  const agent = defaultSideAgentConfig(state, parentId)
  const parent = state.threads.find((thread) => thread.id === parentId)
  const parentHarness = parent?.executionConfig?.route.harnessId ?? parent?.harnessId ?? 'kun'
  // An explicit main-composer engine override must carry its own model/provider pair.
  const useParent = agent.harnessId === parentHarness
  const model = useParent ? defaultSideModel(state, parentId) : state.composerModel
  return {
    ...agent,
    model,
    providerId: useParent ? defaultSideProviderId(state, parentId, model) : state.composerProviderId,
    reasoningEffort: state.composerReasoningEffort || 'auto',
    fastMode: state.composerFastMode ?? false
  }
}

/** Both draft and persisted branch changes are scoped away from the main composer. */
export function useSideConversationComposerConfig({ parentThreadId, activeSide }: {
  parentThreadId: string | null
  activeSide: SideConversation | null
}) {
  const setSideComposerConfig = useChatStore((state) => state.setSideComposerConfig)
  const [draft, setDraft] = useState(() => seedConfig(parentThreadId))
  const resetDraft = useCallback(() => setDraft(seedConfig(parentThreadId)), [parentThreadId])
  useEffect(() => { resetDraft() }, [resetDraft])
  const apply = useCallback((patch: SideComposerConfigPatch) => {
    if (activeSide) setSideComposerConfig(activeSide.threadId, patch)
    else setDraft((current) => mergeSideComposerConfig(current, patch))
  }, [activeSide, setSideComposerConfig])
  const source = activeSide ?? draft
  const { harnessId, credentialMode, gatewayBinding, model, providerId, reasoningEffort,
    fastMode, approvalPolicy, sandboxMode, approvalReviewer } = source
  return {
    config: { harnessId, credentialMode, gatewayBinding, model, providerId, reasoningEffort,
      fastMode, approvalPolicy, sandboxMode, approvalReviewer },
    editable: !activeSide?.busy && !activeSide?.submitting,
    apply,
    resetDraft
  }
}
