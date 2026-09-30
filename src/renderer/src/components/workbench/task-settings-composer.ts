import type { AdeTaskSettingsResponse } from '@shared/ade-task-settings'
import type { ChatState } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'

type Selection = Pick<ChatState, 'activeThreadId' | 'composerHarnessId' | 'composerCredentialMode' | 'composerProviderId' | 'composerModel'>
export function captureTaskComposerSelection(): Selection {
  const { activeThreadId, composerHarnessId, composerCredentialMode, composerProviderId, composerModel } = useChatStore.getState()
  return { activeThreadId, composerHarnessId, composerCredentialMode, composerProviderId, composerModel }
}

/** Keep the next input aligned with a saved route without touching admitted turns. */
export function applySavedTaskRoute(threadId: string, before: Selection, result: AdeTaskSettingsResponse): void {
  const state = useChatStore.getState()
  if (before.activeThreadId !== threadId || state.activeThreadId !== threadId ||
    Object.entries(before).some(([key, value]) => state[key as keyof Selection] !== value)) return
  const route = (result.pending ?? result.current).route
  state.setComposerHarness(route.harnessId ?? '', route.credentialMode ?? '')
  state.setComposerModel(route.model, route.credentialMode === 'native-login' ? '' : route.providerId ?? '')
}
