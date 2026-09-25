import {
  resolveKunImageGenerationSettings,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { prepareActiveWriteFileForNavigation } from './write-workspace-file-action-helpers'
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
    documentEditorV2: write.documentEditorV2,
    inlineCompletion: write.inlineCompletion,
    selectionAssist: write.selectionAssist,
    agentPresets: write.agentPresets,
    paperReading: write.paperReading,
    paperMode: write.paperMode,
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

  // A load requested while one is in flight must not be dropped: the paper
  // mode toggle writes settings and then reloads, and a sidebar-mount load
  // started a moment earlier would otherwise swallow the surface switch.
  // Every waiter shares one follow-up load that re-reads fresh settings.
  let inflightLoad: Promise<void> | null = null
  let queuedLoad: Promise<void> | null = null

  const runLoadWriteSettings = async (): Promise<void> => {
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
      // Paper mode re-roots the workspace at the active library; a same-root
      // surface switch must force a full reinit so the papers-namespaced
      // layout replaces the docs one (and vice versa).
      const targetSurface = write.paperMode.enabled ? 'papers' : 'docs'
      const surfaceChanged = get().workSurface !== targetSurface
      if (surfaceChanged && get().workspaceRoot) {
        // Settle the outgoing surface BEFORE flipping the layout namespace:
        // if the user keeps unsaved edits, stay put and roll the persisted
        // flag back instead of mounting the new surface over the old root.
        const canLeave = await prepareActiveWriteFileForNavigation(get, get().workspaceRoot)
        if (!requestIsCurrent(generation)) return
        if (!canLeave) {
          const rolledBack = await rendererRuntimeClient.setSettings({
            write: { paperMode: { enabled: get().workSurface === 'papers' } }
          })
          if (!requestIsCurrent(generation)) return
          applySettingsResponse(rolledBack, inlineRevisionAtRequest, inlineWritePendingAtRequest)
          set({ settingsLoading: false })
          return
        }
      }
      if (surfaceChanged) get().setWorkSurface(targetSurface)
      const root = targetSurface === 'papers'
        ? write.paperMode.activeLibrary
        : write.activeWorkspaceRoot
      await get().initializeWorkspace(root, { force: surfaceChanged })
      if (!requestIsCurrent(generation)) return
      set({ settingsLoading: false })
    } catch (error) {
      if (!requestIsCurrent(generation)) return
      set({
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    loadWriteSettings: () => {
      if (inflightLoad) {
        queuedLoad ??= inflightLoad.then(() => {
          queuedLoad = null
          return get().loadWriteSettings()
        })
        return queuedLoad
      }
      inflightLoad = runLoadWriteSettings().finally(() => {
        inflightLoad = null
      })
      return inflightLoad
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
        // Workspace switching is a docs-surface operation; on the papers
        // surface the library root stays mounted until the toggle flips back.
        if (get().workSurface === 'docs') {
          await get().initializeWorkspace(write.activeWorkspaceRoot)
        }
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
        if (get().workSurface === 'docs') {
          await get().initializeWorkspace(write.activeWorkspaceRoot)
        }
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
        if (
          get().workSurface === 'docs' &&
          normalizePath(get().workspaceRoot) === normalized
        ) {
          await get().initializeWorkspace(write.activeWorkspaceRoot)
        }
      } catch (error) {
        if (!requestIsCurrent(generation)) return
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
