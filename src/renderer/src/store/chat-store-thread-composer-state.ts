import type { NormalizedThread } from '../agent/types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ChatState } from './chat-store-types'
import type { ComposerPlanMode } from './chat-store-helpers'
import {
  composerModelSelectable,
  composerModeForThread,
  composerReasoningEffortForSelection,
  fallbackComposerModel,
  providerIdForComposerModel,
  providerIdMatchesComposerModel,
  readThreadComposerMode,
  readThreadComposerSelection,
  rememberThreadComposerSelection,
} from './chat-store-helpers'

export type ThreadComposerModelSelection = {
  model: string
  providerId: string
}

export type ThreadComposerState = {
  composerMode: ComposerPlanMode
  composerModel: string
  composerProviderId: string
  composerReasoningEffort: ChatState['composerReasoningEffort']
}

type ThreadLike = Pick<NormalizedThread, 'id' | 'model'> &
  Partial<Pick<NormalizedThread, 'mode' | 'providerId'>>

export type ThreadComposerSelectionOptions = {
  hasUserMessages?: boolean
  runtimeModel?: string
  runtimeDefaultModel?: string
  runtimeDefaultProviderId?: string
  globalComposerModel?: string
  globalStoredModel?: string
  globalStoredProviderId?: string
}

function catalogLoaded(
  pickList: readonly string[],
  modelGroups: readonly ModelProviderModelGroup[]
): boolean {
  return pickList.length > 0 || modelGroups.length > 0
}

function threadComposerModelSelection(
  state: ChatState,
  thread: ThreadLike | null | undefined,
  options: ThreadComposerSelectionOptions = {}
): ThreadComposerModelSelection | null {
  if (!thread) return null
  const pickList = state.composerPickList
  const modelGroups = state.composerModelGroups
  const stored = readThreadComposerSelection(thread.id)
  const storedModel = stored?.model.trim() ?? ''
  const runtimeModel = options.runtimeModel?.trim() || thread.model.trim()
  const runtimeDefaultModel = options.runtimeDefaultModel?.trim() ?? ''
  const runtimeDefaultProviderId = options.runtimeDefaultProviderId?.trim() ?? ''
  const runtimeDefaultSelectable = Boolean(
    runtimeDefaultModel &&
    composerModelSelectable(pickList, modelGroups, runtimeDefaultModel, runtimeDefaultProviderId)
  )
  const hasUserMessages = options.hasUserMessages !== false
  const userSelectionBeforeCatalog = Boolean(
    storedModel &&
    stored?.source === 'user' &&
    !catalogLoaded(pickList, modelGroups)
  )
  const candidates = hasUserMessages || stored?.source === 'user'
    ? [storedModel, runtimeModel, runtimeDefaultSelectable ? runtimeDefaultModel : '']
    : [runtimeDefaultSelectable ? runtimeDefaultModel : '', runtimeModel, storedModel]
  const model = candidates.find((candidate) =>
    candidate && composerModelSelectable(pickList, modelGroups, candidate)
  ) ?? (
    userSelectionBeforeCatalog
      ? storedModel
      : fallbackComposerModel(pickList, runtimeDefaultModel, modelGroups)
  )
  if (!model) return null
  const usesStoredModel = storedModel.toLowerCase() === model.toLowerCase()
  const catalogIsLoaded = catalogLoaded(pickList, modelGroups)
  const storedProviderId =
    stored && usesStoredModel &&
      (!catalogIsLoaded ||
        providerIdMatchesComposerModel(modelGroups, stored.providerId, model))
      ? stored.providerId
      : ''
  const threadProviderId =
    !storedProviderId &&
    thread.providerId?.trim() &&
    providerIdMatchesComposerModel(modelGroups, thread.providerId.trim(), model)
      ? thread.providerId.trim()
      : ''
  const runtimeProviderId =
    runtimeDefaultSelectable &&
    model.toLowerCase() === runtimeDefaultModel.toLowerCase() &&
    providerIdMatchesComposerModel(modelGroups, runtimeDefaultProviderId, model)
      ? runtimeDefaultProviderId
      : ''
  return {
    model,
    providerId:
      storedProviderId ||
      threadProviderId ||
      runtimeProviderId ||
      providerIdForComposerModel(modelGroups, model)
  }
}

export function composerSelectionForThread(
  state: ChatState,
  thread: Pick<NormalizedThread, 'id' | 'model'> | null | undefined,
  options: ThreadComposerSelectionOptions = {}
): ThreadComposerModelSelection | null {
  return threadComposerModelSelection(state, thread, options)
}

export function resolveThreadComposerState(
  state: ChatState,
  thread: ThreadLike | null | undefined,
  options: ThreadComposerSelectionOptions = {}
): ThreadComposerState {
  const selection = threadComposerModelSelection(state, thread, options)
  const model = selection?.model ?? ''
  const providerId = selection?.providerId ?? ''
  return {
    composerMode: composerModeForThread(
      thread && thread.mode !== undefined
        ? { id: thread.id, mode: thread.mode }
        : null,
      readThreadComposerMode(thread?.id ?? '')
    ),
    composerModel: model,
    composerProviderId: providerId,
    composerReasoningEffort: composerReasoningEffortForSelection(
      state.composerModelGroups,
      model,
      providerId
    )
  }
}

export function resolveCatalogComposerSelection(
  state: ChatState,
  options: ThreadComposerSelectionOptions = {}
): ThreadComposerModelSelection {
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
    : null
  if (activeThread) {
    const composerState = resolveThreadComposerState(state, activeThread, {
      ...options,
      hasUserMessages: state.blocks.some((block) => block.kind === 'user')
    })
    return {
      model: composerState.composerModel,
      providerId: composerState.composerProviderId
    }
  }
  const pickList = state.composerPickList
  const modelGroups = state.composerModelGroups
  const runtimeDefaultModel = options.runtimeDefaultModel?.trim() ?? ''
  const runtimeDefaultProviderId = options.runtimeDefaultProviderId?.trim() ?? ''
  const globalComposerModel = options.globalComposerModel?.trim() ?? ''
  const globalStoredModel = options.globalStoredModel?.trim() ?? ''
  const model = [
    composerModelSelectable(pickList, modelGroups, runtimeDefaultModel, runtimeDefaultProviderId)
      ? runtimeDefaultModel
      : '',
    globalComposerModel,
    globalStoredModel
  ].find((candidate) => composerModelSelectable(pickList, modelGroups, candidate)) ??
    fallbackComposerModel(pickList, runtimeDefaultModel, modelGroups)
  const globalStoredProviderId = options.globalStoredProviderId?.trim() ?? ''
  const runtimeProviderId =
    runtimeDefaultModel &&
    model.toLowerCase() === runtimeDefaultModel.toLowerCase() &&
    providerIdMatchesComposerModel(modelGroups, runtimeDefaultProviderId, model)
      ? runtimeDefaultProviderId
      : ''
  const storedProviderId =
    globalStoredProviderId &&
    providerIdMatchesComposerModel(modelGroups, globalStoredProviderId, model)
      ? globalStoredProviderId
      : ''
  return {
    model,
    providerId:
      runtimeProviderId ||
      storedProviderId ||
      providerIdForComposerModel(modelGroups, model)
  }
}

export function rememberCatalogComposerSelection(
  state: ChatState,
  selection: ThreadComposerModelSelection
): void {
  const activeThreadId = state.activeThreadId
  if (!activeThreadId) return
  const threadSelection = readThreadComposerSelection(activeThreadId)
  const storedProviderId = threadSelection?.providerId.trim() ?? ''
  const selectedProviderId = selection.providerId.trim()
  const downgradeOfUserSelection =
    threadSelection?.source === 'user' &&
    (threadSelection.model.trim().toLowerCase() !== selection.model.trim().toLowerCase() ||
      (Boolean(storedProviderId) &&
        storedProviderId.toLowerCase() !== selectedProviderId.toLowerCase()))
  const sameModelProviderFallback =
    Boolean(threadSelection) &&
    Boolean(storedProviderId) &&
    threadSelection?.model.trim().toLowerCase() === selection.model.trim().toLowerCase() &&
    storedProviderId.toLowerCase() !== selectedProviderId.toLowerCase()
  const activeThread = state.threads.find((thread) => thread.id === activeThreadId)
  const threadProviderId = activeThread?.providerId?.trim() ?? ''
  const storedProviderConflictsThread =
    Boolean(storedProviderId) &&
    Boolean(threadProviderId) &&
    storedProviderId.toLowerCase() !== threadProviderId.toLowerCase()
  const threadProviderConflictsFallback =
    Boolean(activeThread) &&
    Boolean(threadProviderId) &&
    activeThread?.model.trim().toLowerCase() === selection.model.trim().toLowerCase() &&
    threadProviderId.toLowerCase() !== selectedProviderId.toLowerCase()
  if (
    !downgradeOfUserSelection &&
    !sameModelProviderFallback &&
    !storedProviderConflictsThread &&
    !threadProviderConflictsFallback &&
    (!threadSelection ||
      threadSelection.model !== selection.model ||
      threadSelection.providerId !== selection.providerId) &&
    composerModelSelectable(
      state.composerPickList,
      state.composerModelGroups,
      selection.model,
      selection.providerId
    )
  ) {
    rememberThreadComposerSelection(
      activeThreadId,
      selection.model,
      selection.providerId,
      'default'
    )
  }
}
