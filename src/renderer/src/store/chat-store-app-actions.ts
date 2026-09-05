import type i18next from 'i18next'
import type { AppSettingsV1, ModelReasoningEffort } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { extensionWorkbenchClient } from '../extensions/extension-workbench-client'
import {
  effectiveCodeWorkspaceRoot,
  readRemovedCodeWorkspaces
} from '../lib/removed-code-workspaces'
import type { ChatState, ChatStoreGet, ChatStoreSet, InitialSetupMode, PluginHostRoute, SettingsRouteSection } from './chat-store-types'
import type { ComposerPlanMode } from './chat-store-helpers'
import {
  composerReasoningEffortForSelection,
  persistComposerMode,
  persistComposerPersonaId,
  persistComposerProviderId,
  providerIdForComposerModel,
  rememberThreadComposerMode,
  rememberThreadComposerSelection,
  readStoredComposerProviderId
} from './chat-store-helpers'
import {
  rememberCatalogComposerSelection,
  resolveCatalogComposerSelection
} from './chat-store-thread-composer-state'
import { useProjectBoardStore } from '../project-board/project-board-store'
type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  persistComposerModel: (model: string) => void
  persistComposerMode: (mode: ComposerPlanMode) => void
  persistComposerReasoningEffort: (
    modelId: string,
    providerId: string,
    effort: ModelReasoningEffort
  ) => void
  persistComposerFastMode: (enabled: boolean) => void
  rememberThreadComposerMode: (threadId: string, mode: ComposerPlanMode) => void
  readStoredComposerModel: (allowedIds: readonly string[]) => string
  mergeComposerPickList: (upstreamOk: boolean, upstreamIds: string[]) => string[]
  fallbackComposerModel: (
    pickList: readonly string[],
    runtimeDefault: string,
    modelGroups?: readonly ModelProviderModelGroup[]
  ) => string
  getComposerModelLoadPromise: () => Promise<void> | null
  setComposerModelLoadPromise: (promise: Promise<void> | null) => void
  applyTheme: (theme: AppSettingsV1['theme']) => void
  applyUiFontScale: (scale: AppSettingsV1['uiFontScale']) => void
  applyChatContentMaxWidth: (widthPx: AppSettingsV1['chatContentMaxWidthPx']) => void
  applyCursorSpotlight: (enabled: boolean) => void
  applyCursorSpotlightColor: (color: AppSettingsV1['cursorSpotlightColor']) => void
  applyDarkUiColors: (colors: AppSettingsV1['darkUiColors']) => void
  applyWriteTypography: (typography: AppSettingsV1['write']['typography']) => void
  applyDocumentLocale: (locale: AppSettingsV1['locale']) => void
  workspaceLabelFromPath: (workspaceRoot: string) => string
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
}

export function createAppActions(options: CreateAppActionsOptions): Pick<
  ChatState,
  | 'setError'
  | 'setComposerMode'
  | 'setComposerExecutionSettings'
  | 'setComposerOrchestration'
  | 'setComposerModel'
  | 'setComposerReasoningEffort'
  | 'setComposerFastMode'
  | 'setComposerAgentId'
  | 'setComposerPersonaId'
  | 'loadComposerModels'
  | 'setRoute'
  | 'openWrite'
  | 'openSettings'
  | 'closeSettings'
  | 'openPlugins'
  | 'openClaw'
  | 'openBoard'
  | 'openSchedule'
  | 'openWorkflow'
  | 'openDesign'
  | 'openInitialSetup'
  | 'closeInitialSetup'
  | 'selectInspectorItem'
  | 'applyI18nFromSettings'
  | 'reloadUiSettings'
> {
  const {
    set,
    get,
    i18n,
    persistComposerModel,
    persistComposerMode,
    persistComposerReasoningEffort,
    persistComposerFastMode,
    rememberThreadComposerMode,
    readStoredComposerModel,
    mergeComposerPickList,
    fallbackComposerModel,
    getComposerModelLoadPromise,
    setComposerModelLoadPromise,
    applyTheme,
    applyUiFontScale,
    applyChatContentMaxWidth,
    applyCursorSpotlight,
    applyCursorSpotlightColor,
    applyDarkUiColors,
    applyWriteTypography,
    applyDocumentLocale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot
  } = options
  // Settings may finish saving while the startup model read is still in
  // flight. Keep one follow-up read so the composer does not retain the
  // stale provider list returned by that earlier request.
  let queuedComposerModelReload: Promise<void> | null = null

  return {
    setError: (message) => set({ error: message }),

    setComposerMode: (mode) => {
      const activeThreadId = get().activeThreadId
      if (activeThreadId) {
        rememberThreadComposerMode(activeThreadId, mode)
      } else {
        persistComposerMode(mode)
      }
      set({ composerMode: mode })
    },

    setComposerOrchestration: (mode) => {
      set({ composerOrchestration: mode })
    },

    setComposerExecutionSettings: (settings) => {
      set({ composerExecutionSettings: settings })
    },

    setComposerModel: (modelId, providerId) => {
      const nextProviderId = providerId?.trim() || providerIdForComposerModel(get().composerModelGroups, modelId)
      const state = get()
      const activeThreadId = state.activeThreadId
      if (activeThreadId) {
        rememberThreadComposerSelection(activeThreadId, modelId, nextProviderId)
      } else {
        persistComposerModel(modelId)
        persistComposerProviderId(nextProviderId)
      }
      set({
        composerModel: modelId,
        composerProviderId: nextProviderId,
        composerReasoningEffort: composerReasoningEffortForSelection(
          state.composerModelGroups,
          modelId,
          nextProviderId
        )
      })
      const trimmed = modelId.trim()
      const extensionProvider = state.composerModelGroups.find(
        (group) => group.providerId === nextProviderId
      )?.extensionProvider
      if (
        !activeThreadId &&
        !extensionProvider &&
        trimmed &&
        trimmed.toLowerCase() !== 'auto' &&
        typeof window.kunGui !== 'undefined'
      ) {
        void window.kunGui.saveSettingsSilent({
          agents: { kun: { model: trimmed, providerId: nextProviderId } }
        })
      }
    },

    setComposerReasoningEffort: (effort) => {
      const state = get()
      persistComposerReasoningEffort(
        state.composerModel,
        state.composerProviderId,
        effort
      )
      set({ composerReasoningEffort: effort })
    },

    setComposerFastMode: (enabled) => {
      persistComposerFastMode(enabled)
      set({ composerFastMode: enabled })
    },

    setComposerAgentId: (agentId) => {
      set({ composerAgentId: agentId.trim() })
    },

    setComposerPersonaId: (presetId) => {
      const normalized = presetId.trim()
      set({ composerPersonaId: normalized })
      persistComposerPersonaId(normalized)
    },

    loadComposerModels: async () => {
      const existingLoad = getComposerModelLoadPromise()
      if (existingLoad) {
        if (!queuedComposerModelReload) {
          queuedComposerModelReload = existingLoad
            .catch(() => undefined)
            .then(() => get().loadComposerModels())
            .finally(() => {
              queuedComposerModelReload = null
            })
        }
        return queuedComposerModelReload
      }
      if (typeof window.kunGui === 'undefined') return
      const task = (async () => {
        const [res, extensionProviders] = await Promise.all([
          window.kunGui.fetchUpstreamModels(),
          extensionWorkbenchClient.listModelProviders(get().workspaceRoot || undefined).catch(() => [])
        ])
        const extensionGroups: ModelProviderModelGroup[] = extensionProviders.flatMap((provider) => {
          if (!provider.binding?.valid) return []
          const model = provider.models.find((candidate) => candidate.id === provider.binding?.modelId)
          if (!model) return []
          const inputModalities = [
            'text' as const,
            ...(model.capabilities.input.includes('image') ? ['image' as const] : [])
          ]
          return [{
            providerId: provider.providerId,
            label: `${provider.displayName} · ${provider.extensionDisplayName}`,
            modelIds: [model.id],
            accountId: provider.binding.accountId,
            extensionProvider: {
              extensionId: provider.extensionId,
              extensionVersion: provider.extensionVersion,
              localProviderId: provider.localProviderId
            },
            modelProfiles: {
              [model.id]: {
                inputModalities,
                outputModalities: ['text'],
                supportsToolCalling: model.capabilities.tools,
                messageParts: model.capabilities.input.includes('image')
                  ? ['text', 'image_url', 'input_image']
                  : ['text'],
                ...(model.capabilities.maxContextTokens
                  ? { contextWindowTokens: model.capabilities.maxContextTokens }
                  : {}),
                ...(model.capabilities.maxOutputTokens
                  ? { maxOutputTokens: model.capabilities.maxOutputTokens }
                  : {}),
                ...(model.capabilities.reasoning ? {
                  reasoning: {
                    supportedEfforts: ['low', 'medium', 'high'],
                    defaultEffort: 'medium',
                    requestProtocol: 'none'
                  }
                } : {})
              }
            }
          }]
        })
        const upstreamGroups = res.ok ? res.modelGroups ?? [] : []
        const groups = [...upstreamGroups, ...extensionGroups]
        const pick = mergeComposerPickList(
          res.ok || extensionGroups.length > 0,
          [...(res.ok ? res.modelIds : []), ...extensionGroups.flatMap((group) => group.modelIds)]
        )
        const runtimeDefault = res.ok
          ? res.defaultModel?.modelId.trim() || res.defaultModelId?.trim() || ''
          : ''
        const runtimeDefaultProviderId = res.ok
          ? res.defaultModel?.providerId.trim() ?? ''
          : ''
        set((state) => {
          const catalogState = {
            ...state,
            composerPickList: pick,
            composerModelGroups: groups
          }
          const selection = resolveCatalogComposerSelection(catalogState, {
            runtimeDefaultModel: runtimeDefault,
            runtimeDefaultProviderId,
            globalComposerModel: state.composerModel,
            globalStoredModel: readStoredComposerModel(pick),
            globalStoredProviderId: readStoredComposerProviderId(
              groups,
              readStoredComposerModel(pick)
            )
          })
          if (!state.activeThreadId && selection.providerId !== state.composerProviderId) {
            persistComposerProviderId(selection.providerId)
          }
          rememberCatalogComposerSelection(catalogState, selection)
          return {
            composerPickList: pick,
            composerModel: selection.model,
            composerProviderId: selection.providerId,
            composerReasoningEffort: composerReasoningEffortForSelection(
              groups,
              selection.model,
              selection.providerId
            ),
            composerModelGroups: groups
          }
        })
      })().finally(() => {
        setComposerModelLoadPromise(null)
      })
      setComposerModelLoadPromise(task)
      return task
    },

    setRoute: (route) => set({ route: route === 'design' ? 'chat' : route }),

    openWrite: async () => {
      set({ route: 'write' })
    },

    openSettings: (section: SettingsRouteSection = 'general') =>
      set((state) => ({
        route: 'settings',
        settingsSection: section,
        settingsReturnRoute: state.route === 'settings'
          ? state.settingsReturnRoute === 'design' ? 'chat' : state.settingsReturnRoute
          : state.route === 'design' ? 'chat' : state.route
      })),

    closeSettings: () =>
      set((state) => ({
        route: state.settingsReturnRoute === 'design' ? 'chat' : state.settingsReturnRoute
      })),

    openPlugins: (host?: PluginHostRoute) =>
      set((state) => ({
        route: 'plugins',
        pluginHostRoute: host ?? (state.route === 'claw' ? 'claw' : 'chat')
      })),

    openClaw: () => {
      set({ route: 'claw' })
      void get().refreshClawChannels()
    },

    openBoard: (workspaceRoot?: string) => {
      const target = normalizeWorkspaceRoot(workspaceRoot || get().workspaceRoot)
      if (target) useProjectBoardStore.getState().selectWorkspace(target)
      set({ route: 'board' })
    },

    openSchedule: () => {
      set({ route: 'schedule' })
    },

    openWorkflow: () => {
      set({ route: 'workflow' })
    },
    openDesign: () => {
      set({ route: 'chat' })
    },

    openInitialSetup: (mode: InitialSetupMode = 'required') =>
      set({ initialSetupOpen: true, initialSetupMode: mode }),

    closeInitialSetup: () => set({ initialSetupOpen: false, initialSetupMode: 'required' }),

    selectInspectorItem: (id) => set({ inspectorSelectedId: id }),

    applyI18nFromSettings: async (locale) => {
      await i18n.changeLanguage(locale)
      applyDocumentLocale(locale)
    },

    reloadUiSettings: async () => {
      if (typeof window.kunGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const removedRegistry = readRemovedCodeWorkspaces()
      const workspaceRoot = effectiveCodeWorkspaceRoot(settings.workspaceRoot, removedRegistry)
      applyTheme(settings.theme)
      applyUiFontScale(settings.uiFontScale)
      applyChatContentMaxWidth(settings.chatContentMaxWidthPx)
      applyCursorSpotlight(settings.cursorSpotlight !== false)
      applyCursorSpotlightColor(settings.cursorSpotlightColor)
      applyDarkUiColors(settings.darkUiColors)
      if (settings.write?.typography) applyWriteTypography(settings.write.typography)
      set({
        workspaceRoot,
        removedCodeWorkspaces: removedRegistry,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        conversationWorkspaceRoot: settings.conversationWorkspaceRoot || '',
        disabledSkillIds: settings.disabledSkillIds,
        codeAgentPresets: settings.codeAgentPresets,
        composerPersonaEnabled: settings.codeAgentPersonaEnabled !== false,
        graphEnabled: settings.agents.kun.graph?.enabled === true,
        composerOrchestration:
          settings.agents.kun.graph?.enabled === true && get().composerOrchestration === 'graph'
            ? 'graph'
            : 'direct',
        clawChannels: settings.claw.channels,
        activeClawChannelId: settings.claw.channels.some(
          (channel) => channel.id === get().activeClawChannelId && channel.enabled
        )
          ? get().activeClawChannelId
          : settings.claw.channels.find((channel) => channel.enabled)?.id ?? ''
      })
      await get().applyI18nFromSettings(settings.locale)
      if (get().runtimeConnection === 'ready') {
        void get().refreshThreads()
      }
      void get().loadComposerModels()
    }
  }
}
