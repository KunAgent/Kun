import {
  resolveKunImageGenerationSettings,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import {
  compactWorkspaceRoots,
  normalizePath,
  normalizeWriteSettings,
  withResolvedInlineCompletionSettings
} from './write-workspace-store-helpers'

type WriteSettingsActions = Pick<
  WriteWorkspaceState,
  | 'loadWriteSettings'
  | 'selectWriteWorkspace'
  | 'addWriteWorkspace'
  | 'removeWriteWorkspace'
  | 'setInlineCompletionEnabled'
>

type WriteSettingsActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
}

function applyWriteSettingsState(
  set: WriteWorkspaceSet,
  settings: Awaited<ReturnType<typeof rendererRuntimeClient.getSettings>>
): ReturnType<typeof withResolvedInlineCompletionSettings> {
  const write = withResolvedInlineCompletionSettings(normalizeWriteSettings(settings.write), settings)
  const imageGeneration = resolveKunImageGenerationSettings(settings)
  const runtime = resolveKunRuntimeSettings(settings)
  set({
    defaultWorkspaceRoot: write.defaultWorkspaceRoot,
    workspaceRoots: write.workspaces,
    autoSaveEnabled: write.autoSaveEnabled,
    autoSaveDelayMs: write.autoSaveDelayMs,
    inlineCompletion: write.inlineCompletion,
    selectionAssist: write.selectionAssist,
    agentPresets: write.agentPresets,
    inlineCompletionApiReady: Boolean(resolveWriteInlineCompletionApiKey(settings).trim()),
    imageGenReady: Boolean(
      imageGeneration?.enabled &&
      imageGeneration.baseUrl.trim() &&
      imageGeneration.apiKey.trim() &&
      imageGeneration.model.trim()
    ),
    // Prototype generation rides the primary chat provider, not the image one.
    prototypeReady: Boolean(runtime.apiKey.trim() && runtime.model.trim()),
    settingsError: null
  })
  return write
}

export function createWriteSettingsActions({ set, get }: WriteSettingsActionContext): WriteSettingsActions {
  let settingsRequestGeneration = 0
  let inlineCompletionSettingsWrite: Promise<void> = Promise.resolve()
  let inlineCompletionSettingsRevision = 0
  let pendingInlineCompletionWrites = 0
  let confirmedInlineCompletionEnabled = true
  const nextSettingsRequest = (): number => {
    settingsRequestGeneration += 1
    return settingsRequestGeneration
  }
  const requestIsCurrent = (generation: number): boolean => generation === settingsRequestGeneration
  const applySettingsResponse = (
    settings: Awaited<ReturnType<typeof rendererRuntimeClient.getSettings>>,
    inlineRevisionAtRequest: number,
    inlineWritePendingAtRequest: boolean
  ): ReturnType<typeof withResolvedInlineCompletionSettings> => {
    const latestEnabled = get().inlineCompletion.enabled
    const write = applyWriteSettingsState(set, settings)
    if (
      inlineWritePendingAtRequest ||
      inlineRevisionAtRequest !== inlineCompletionSettingsRevision
    ) {
      set((state) => ({
        inlineCompletion: { ...state.inlineCompletion, enabled: latestEnabled }
      }))
    }
    return write
  }

  return {
    loadWriteSettings: async () => {
      if (get().settingsLoading) return
      const generation = nextSettingsRequest()
      const inlineRevisionAtRequest = inlineCompletionSettingsRevision
      const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
      set({ settingsLoading: true, settingsError: null })
      try {
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        if (!requestIsCurrent(generation)) return
        const write = applySettingsResponse(
          settings,
          inlineRevisionAtRequest,
          inlineWritePendingAtRequest
        )
        await get().initializeWorkspace(write.activeWorkspaceRoot)
        if (!requestIsCurrent(generation)) return
        set({ settingsLoading: false })
      } catch (error) {
        if (!requestIsCurrent(generation)) return
        set({
          settingsLoading: false,
          settingsError: error instanceof Error ? error.message : String(error)
        })
      }
    },

    setInlineCompletionEnabled: async (enabled) => {
      const currentEnabled = get().inlineCompletion.enabled
      if (currentEnabled === enabled) return
      if (pendingInlineCompletionWrites === 0) {
        confirmedInlineCompletionEnabled = currentEnabled
      }
      pendingInlineCompletionWrites += 1
      const revision = ++inlineCompletionSettingsRevision
      set((state) => ({
        inlineCompletion: { ...state.inlineCompletion, enabled },
        settingsError: null
      }))

      const write = inlineCompletionSettingsWrite.then(async () => {
        await rendererRuntimeClient.setSettings({
          write: { inlineCompletion: { enabled } }
        })
        confirmedInlineCompletionEnabled = enabled
      })
      inlineCompletionSettingsWrite = write.catch(() => undefined)

      try {
        await write
        if (revision === inlineCompletionSettingsRevision) {
          set({ settingsError: null })
        }
      } catch (error) {
        if (revision === inlineCompletionSettingsRevision) {
          set((state) => ({
            inlineCompletion: {
              ...state.inlineCompletion,
              enabled: confirmedInlineCompletionEnabled
            },
            settingsError: error instanceof Error ? error.message : String(error)
          }))
        }
      } finally {
        pendingInlineCompletionWrites = Math.max(0, pendingInlineCompletionWrites - 1)
      }
    },

    selectWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const generation = nextSettingsRequest()
      const inlineRevisionAtRequest = inlineCompletionSettingsRevision
      const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
      const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
      set({ workspaceRoots: roots, settingsLoading: false })
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots
          }
        })
        if (!requestIsCurrent(generation)) return
        const write = applySettingsResponse(
          settings,
          inlineRevisionAtRequest,
          inlineWritePendingAtRequest
        )
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      } catch (error) {
        if (!requestIsCurrent(generation)) return
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    },

    addWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const generation = nextSettingsRequest()
      const inlineRevisionAtRequest = inlineCompletionSettingsRevision
      const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
      const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
      set({ settingsLoading: false })
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots
          }
        })
        if (!requestIsCurrent(generation)) return
        const write = applySettingsResponse(
          settings,
          inlineRevisionAtRequest,
          inlineWritePendingAtRequest
        )
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      } catch (error) {
        if (!requestIsCurrent(generation)) return
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    },

    removeWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const generation = nextSettingsRequest()
      const inlineRevisionAtRequest = inlineCompletionSettingsRevision
      const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
      set({ settingsLoading: false })
      const state = get()
      const fallback = state.defaultWorkspaceRoot ||
        state.workspaceRoots.find((item) => item !== normalized) ||
        state.workspaceRoot
      const roots = compactWorkspaceRoots([
        fallback,
        ...state.workspaceRoots.filter((item) => normalizePath(item) !== normalized)
      ])
      const activeWorkspaceRoot = normalizePath(state.workspaceRoot) === normalized
        ? fallback
        : state.workspaceRoot
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot,
            workspaces: roots
          }
        })
        if (!requestIsCurrent(generation)) return
        const write = applySettingsResponse(
          settings,
          inlineRevisionAtRequest,
          inlineWritePendingAtRequest
        )
        if (normalizePath(get().workspaceRoot) === normalized) {
          await get().initializeWorkspace(write.activeWorkspaceRoot)
        }
      } catch (error) {
        if (!requestIsCurrent(generation)) return
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
