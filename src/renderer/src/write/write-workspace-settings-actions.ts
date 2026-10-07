import {
  resolveKunImageGenerationSettings,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey
} from '@shared/app-settings'
import type { PaperWorkspaceEnsureResult } from '@shared/paper/paper-workspace-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { resetPaperWorkspaceContent, usePaperWorkspaceBootstrapStore } from '../paper/paper-workspace-bootstrap'
import { invalidatePaperLibraryIndex } from '../paper/paper-library-index'
import { mobileDocumentsWorkspaceRoot } from '../mobile/work/mobile-documents-workspace'
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

  const runLoadWriteSettings = async (mobile = false): Promise<void> => {
    const generation = nextSettingsRequest()
    const inlineRevisionAtRequest = inlineCompletionSettingsRevision
    const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
    set({ settingsLoading: true, settingsError: null })
    let loadingPaperWorkspace = false
    try {
      const previousPaperMode = get().paperMode
      const previousPapersDir = get().paperReading.papersDir
      let settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (!requestIsCurrent(generation)) return
      // Initialization is desktop-only and uses main-process filesystem/settings
      // admission. A phone never creates a host workspace as a side effect.
      if (!mobile && settings.write?.paperMode?.enabled) {
        loadingPaperWorkspace = true
        const keepReady = usePaperWorkspaceBootstrapStore.getState().status === 'ready'
          && get().workSurface === 'papers'
          && normalizePath(get().workspaceRoot) === normalizePath(settings.write.paperMode.activeLibrary)
        if (!keepReady) usePaperWorkspaceBootstrapStore.setState({ status: 'loading', error: null })
        if (typeof window.kunGui?.paperWorkspaceEnsure === 'function') {
          while (settings.write.paperMode.enabled && requestIsCurrent(generation)) {
            const before = settings.write.paperMode
            const selectionBefore = JSON.stringify([before.activeLibrary, before.libraries])
            let result: PaperWorkspaceEnsureResult
            try {
              result = await window.kunGui.paperWorkspaceEnsure()
            } catch (error) {
              result = { ok: false, code: 'io',
                message: error instanceof Error ? error.message : String(error),
                defaultWorkspaceRoot: usePaperWorkspaceBootstrapStore.getState().defaultWorkspaceRoot }
            }
            if (!requestIsCurrent(generation)) return
            // Bind admission to the selection that will actually be mounted.
            // A newer explicit choice after the IPC result needs its own check.
            settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
            if (!requestIsCurrent(generation)) return
            const latest = settings.write.paperMode
            const sameAdmission = result.ok
              ? normalizePath(result.workspaceRoot) === normalizePath(latest.activeLibrary)
              : selectionBefore === JSON.stringify([latest.activeLibrary, latest.libraries])
            if (!sameAdmission && latest.enabled) continue
            usePaperWorkspaceBootstrapStore.setState({
              defaultWorkspaceRoot: result.defaultWorkspaceRoot,
              status: result.ok
                ? (keepReady && normalizePath(get().workspaceRoot) === normalizePath(latest.activeLibrary) ? 'ready' : 'loading')
                : 'error',
              error: result.ok ? null : result.message
            })
            break
          }
        } else if (!settings.write.paperMode.activeLibrary) {
          usePaperWorkspaceBootstrapStore.setState({
            status: 'error', error: 'Paper workspace initialization is unavailable. Restart Kun or choose a folder.'
          })
        }
      }
      if (!requestIsCurrent(generation)) return
      const write = applySettingsResponse(
        settings,
        inlineRevisionAtRequest,
        inlineWritePendingAtRequest
      )
      // The Remote phone owns its Work/Papers navigation locally. Never
      // apply the host's persisted paper surface switch to that browser.
      if (mobile) {
        const root = mobileDocumentsWorkspaceRoot({
          workspaces: write.workspaces,
          activeWorkspaceRoot: write.activeWorkspaceRoot,
          defaultWorkspaceRoot: write.defaultWorkspaceRoot,
          paperModeEnabled: write.paperMode.enabled
        })
        await get().initializeWorkspace(root)
        if (requestIsCurrent(generation)) set({ settingsLoading: false })
        return
      }
      // Paper mode re-roots the workspace at the active library; a same-root
      // surface switch must force a full reinit so the papers-namespaced
      // layout replaces the docs one (and vice versa).
      const targetSurface = write.paperMode.enabled ? 'papers' : 'docs'
      const surfaceChanged = get().workSurface !== targetSurface
      const root = targetSurface === 'papers'
        ? write.paperMode.activeLibrary
        : write.activeWorkspaceRoot
      const rootChanged = normalizePath(get().workspaceRoot) !== normalizePath(root)
      const readinessError = targetSurface === 'papers' ? usePaperWorkspaceBootstrapStore.getState().error : null
      const unavailable = targetSurface === 'papers' && usePaperWorkspaceBootstrapStore.getState().status === 'error'
      const navigationPrepared = Boolean((surfaceChanged || rootChanged || unavailable) && get().workspaceRoot)
      if (navigationPrepared) {
        // Settle the outgoing surface BEFORE flipping the layout namespace:
        // if the user keeps unsaved edits, stay put and roll the persisted
        // flag back instead of mounting the new surface over the old root.
        const canLeave = await prepareActiveWriteFileForNavigation(get, get().workspaceRoot)
        if (!requestIsCurrent(generation)) return
        if (!canLeave) {
          const rolledBack = await rendererRuntimeClient.setSettings({
            write: { paperMode: {
              ...(get().workSurface === 'papers' ? {
                libraries: previousPaperMode.libraries,
                activeLibrary: previousPaperMode.activeLibrary
              } : {}),
              enabled: get().workSurface === 'papers'
            } }
          })
          if (!requestIsCurrent(generation)) return
          applySettingsResponse(rolledBack, inlineRevisionAtRequest, inlineWritePendingAtRequest)
          const failedCurrentRoot = unavailable && !surfaceChanged && !rootChanged
          usePaperWorkspaceBootstrapStore.setState({
            status: failedCurrentRoot ? 'error' : 'ready',
            error: failedCurrentRoot ? readinessError : null
          })
          set({ settingsLoading: false, ...(readinessError ? { fileError: readinessError } : {}) })
          return
        }
      }
      if (surfaceChanged) get().setWorkSurface(targetSurface)
      const paperDirectoryChanged = previousPapersDir !== write.paperReading.papersDir
      if (paperDirectoryChanged) invalidatePaperLibraryIndex()
      if (surfaceChanged || rootChanged || unavailable || paperDirectoryChanged) {
        if (get().workspaceRoot) invalidatePaperLibraryIndex(get().workspaceRoot)
        resetPaperWorkspaceContent()
        get().setPaperResearch({ sessionId: null })
      }
      await get().initializeWorkspace(unavailable ? '' : root, {
        force: surfaceChanged,
        ...(navigationPrepared ? { navigationPrepared: true } : {})
      })
      if (!requestIsCurrent(generation)) return
      if (targetSurface === 'papers' && !unavailable) {
        const mounted = get()
        const initializationError = mounted.treeError || (!mounted.rootDirectory
          ? 'The paper workspace could not be opened. Restore access or choose another folder.' : null)
        usePaperWorkspaceBootstrapStore.setState({
          status: initializationError ? 'error' : 'ready', error: initializationError
        })
      }
      set({ settingsLoading: false })
    } catch (error) {
      if (!requestIsCurrent(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      if (!mobile && (loadingPaperWorkspace || get().paperMode.enabled)) {
        usePaperWorkspaceBootstrapStore.setState({ status: 'error', error: message })
      }
      set({ settingsLoading: false, settingsError: message })
    }
  }

  return {
    loadWriteSettings: (options) => {
      if (inflightLoad) {
        queuedLoad ??= inflightLoad.then(() => {
          queuedLoad = null
          return get().loadWriteSettings(options)
        })
        return queuedLoad
      }
      inflightLoad = runLoadWriteSettings(options?.mobile === true).finally(() => {
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
      // A work space is a documents-surface root: choosing one while a paper
      // library is mounted leaves the papers surface through the settings load.
      const leavePapers = get().workSurface === 'papers'
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots,
            ...(leavePapers ? { paperMode: { enabled: false } } : {})
          }
        })
        if (!requestIsCurrent(generation)) return
        if (leavePapers) {
          await get().loadWriteSettings()
          return
        }
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

    addWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const generation = nextSettingsRequest()
      const inlineRevisionAtRequest = inlineCompletionSettingsRevision
      const inlineWritePendingAtRequest = pendingInlineCompletionWrites > 0
      const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
      set({ settingsLoading: false })
      const leavePapers = get().workSurface === 'papers'
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots,
            ...(leavePapers ? { paperMode: { enabled: false } } : {})
          }
        })
        if (!requestIsCurrent(generation)) return
        if (leavePapers) {
          await get().loadWriteSettings()
          return
        }
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
