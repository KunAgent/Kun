import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  getKunRuntimeSettings
} from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  composerModelSelectable,
  providerIdForComposerModel,
  providerIdMatchesComposerModel,
  readThreadComposerSelection
} from './chat-store-helpers'

export function fallbackComposerProviderIdForSend(state: ChatState): string {
  return state.route === 'claw' ? '' : state.composerProviderId.trim()
}

export async function ensureRuntimeProviderForSend(input: {
  providerId?: string
  model?: string
  set: ChatStoreSet
  get: ChatStoreGet
}): Promise<void> {
  const providerId = input.providerId?.trim()
  const model = input.model?.trim()
  if (!providerId || !model || model.toLowerCase() === 'auto') return
  const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
  const runtime = getKunRuntimeSettings(settings)
  const activeProviderId = runtime.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  if (activeProviderId === providerId) return
  input.set({ runtimeConnection: 'checking', error: null, runtimeErrorDetail: null })
  try {
    await window.kunGui.saveSettingsSilent({ agents: { kun: { providerId, model } } })
    rendererRuntimeClient.invalidateSettings()
    await rendererRuntimeClient.restartRuntime()
    await getProvider().connect()
    input.set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
    void input.get().loadComposerModels()
  } catch (error) {
    input.set({ runtimeConnection: 'offline' })
    throw error
  }
}

export function composerSelectionForThread(
  state: ChatState,
  thread: Pick<NormalizedThread, 'id' | 'model'> | null | undefined
): { model: string; providerId: string } | null {
  if (!thread) return null
  const pickList = state.composerPickList
  const stored = readThreadComposerSelection(thread.id)
  const storedModel = stored?.model.trim() ?? ''
  const threadModel = thread.model.trim()
  const model = composerModelSelectable(pickList, state.composerModelGroups, storedModel)
    ? storedModel
    : composerModelSelectable(pickList, state.composerModelGroups, threadModel)
      ? threadModel
      : ''
  if (!model) return null
  const storedProviderId =
    stored && providerIdMatchesComposerModel(state.composerModelGroups, stored.providerId, model)
      ? stored.providerId
      : ''
  return {
    model,
    providerId: storedProviderId || providerIdForComposerModel(state.composerModelGroups, model)
  }
}

export function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  void provider.subscribeThreadEvents(threadId, sinceSeq, sink, signal)
    .catch(() => undefined)
    .then(() => {
      if (signal.aborted) return
      const state = get()
      if (state.activeThreadId !== threadId || !state.busy) return
      void state.recoverActiveTurn()
    })
}
