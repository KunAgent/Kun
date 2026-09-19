import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { hashDesignSystem, normalizeDesignTarget } from './design-context'
import { parseProjectDesignMdWithOfficialLint } from './design-md/design-md-adapter'
import { PROJECT_DESIGN_MD_PATH } from './design-md/design-md-paths'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import {
  AI_RAIL_COLLAPSED_KEY,
  ASSISTANT_MODEL_KEY,
  ASSISTANT_PROVIDER_KEY,
  CANVAS_ASSISTANT_OPEN_KEY,
  CANVAS_INSPECTOR_PINNED_KEY,
  CANVAS_VIEW_KEY,
  DESIGN_TARGET_KEY,
  MULTI_PAGE_MODE_KEY,
  VIEWPORT_KEY,
  builtinDesignWorkspaceRoot,
  readPersistedAiRailCollapsed,
  readPersistedAssistantModel,
  readPersistedAssistantProvider,
  readPersistedCanvasAssistantOpen,
  readPersistedCanvasInspectorPinned,
  readPersistedCanvasView,
  readPersistedDesignTarget,
  readPersistedMultiPageMode,
  readPersistedViewport,
  rehydrateDesignWorkspaceArtifacts
} from './design-workspace-store/helpers'
import { prepareDesignHtmlTurn } from './design-workspace-store/html-turn'
import { prepareDesignSvgTurn } from './design-workspace-store/svg-turn'
import { createDesignWorkspaceArtifactActions } from './design-workspace-artifact-actions'
import { createDesignWorkspaceDocumentActions } from './design-workspace-document-actions'
import {
  flushAndReleaseDesignWorkspace,
  normalizeDesignWorkspaceRoot,
  registerDesignPersistenceFailureHandler,
  resetDesignWorkspaceTransientStores
} from './design-workspace-lifecycle'
import { persistDesignWorkspaceIndex } from './design-workspace-index-persistence'

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => {
  let workspaceGeneration = 0
  let settingsLoadGeneration = 0
  registerDesignPersistenceFailureHandler({
    getWorkspaceRoot: () => get().workspaceRoot,
    setFileError: (fileError) => set({ fileError })
  })
  const indexState = (): Pick<
    DesignWorkspaceState,
    'workspaceRoot' | 'documents' | 'activeDocumentId' | 'workspaceFolders'
  > => {
    const state = get()
    if (!state.drawingCreationOpen && !state.drawingCreationDocumentId) return state
    const documents = state.drawingCreationDocumentId
      ? state.documents.filter((document) => document.id !== state.drawingCreationDocumentId)
      : state.documents
    const activeDocumentId =
      state.activeDocumentId !== state.drawingCreationDocumentId &&
      documents.some((document) => document.id === state.activeDocumentId)
        ? state.activeDocumentId
        : state.drawingCreationReturnDocumentId &&
            documents.some((document) => document.id === state.drawingCreationReturnDocumentId)
          ? state.drawingCreationReturnDocumentId
          : documents[0]?.id ?? null
    return {
      workspaceRoot: state.workspaceRoot,
      documents,
      activeDocumentId,
      workspaceFolders: state.workspaceFolders
    }
  }
  const persistIndex = (): void => persistDesignWorkspaceIndex(indexState())
  const persistIndexNow = (): void => persistDesignWorkspaceIndex(indexState(), true)

  return {
    workspaceRoot: '',
    documents: [],
    workspaceFolders: [],
    activeDocumentId: null,
    drawingCreationOpen: false,
    drawingCreationReturnDocumentId: null,
    drawingCreationDocumentId: null,
    drawingCreationSubmitting: false,
    drawingCreationFolderId: null,
    drawingHistoryMutation: null,
    artifacts: [],
    activeArtifactId: null,
    canvasView: readPersistedCanvasView(),
    viewport: readPersistedViewport(),
    devPreviewUrl: '',
    assistantModel: readPersistedAssistantModel(),
    assistantProviderId: readPersistedAssistantProvider(),
    designContext: { designTarget: readPersistedDesignTarget() },
    canvasBackground: 'light',
    liveRefresh: true,
    deviceFrame: true,
    generationPrompt: '',
    reasoningEffort: '',
    implementStackHint: '',
    injectIntoCode: true,
    publishDesignSystem: true,
    settingsLoaded: false,
    fileError: null,
    designSystemHash: '',
    implementOpen: false,
    implementTitle: '',
    aiRailCollapsed: readPersistedAiRailCollapsed(),
    canvasAssistantOpen: readPersistedCanvasAssistantOpen(),
    canvasInspectorPinned: readPersistedCanvasInspectorPinned(),
    designIntentMode: 'generate',
    multiPageMode: readPersistedMultiPageMode(),
    pagesRun: null,
    parallelPageStates: {},

    setWorkspaceRoot: (workspaceRoot) => {
      const normalized = normalizeDesignWorkspaceRoot(workspaceRoot)
      const previous = get().workspaceRoot
      if (normalizeDesignWorkspaceRoot(previous) === normalized) return
      workspaceGeneration += 1
      flushAndReleaseDesignWorkspace(previous)
      resetDesignWorkspaceTransientStores()
      set({
        workspaceRoot: normalized,
        documents: [],
        workspaceFolders: [],
        activeDocumentId: null,
        drawingCreationOpen: false,
        drawingCreationReturnDocumentId: null,
        drawingCreationDocumentId: null,
        drawingCreationSubmitting: false,
        drawingCreationFolderId: null,
        artifacts: [],
        activeArtifactId: null,
        fileError: null,
        designSystemHash: '',
        implementOpen: false,
        implementTitle: '',
        pagesRun: null,
        parallelPageStates: {}
      })
    },

    setCanvasView: (view) => {
      writeBrowserStorageItem(CANVAS_VIEW_KEY, view)
      set({ canvasView: view })
    },

    setViewport: (viewport) => {
      writeBrowserStorageItem(VIEWPORT_KEY, viewport)
      set({ viewport })
    },

    setDevPreviewUrl: (url) => set({ devPreviewUrl: url }),

    setCanvasBackground: (background) => set({ canvasBackground: background }),

    ...createDesignWorkspaceArtifactActions({ get, set, persistIndex, persistIndexNow }),
    ...createDesignWorkspaceDocumentActions({ get, set, persistIndex, persistIndexNow, indexState }),

    setDesignIntentMode: (mode) => set({ designIntentMode: mode }),

    setDesignTarget: (target) => {
      const normalized = normalizeDesignTarget(target)
      writeBrowserStorageItem(DESIGN_TARGET_KEY, normalized)
      set((state) => ({ designContext: { ...state.designContext, designTarget: normalized } }))
    },

    setMultiPageMode: (on) => {
      writeBrowserStorageItem(MULTI_PAGE_MODE_KEY, on ? '1' : '0')
      set({ multiPageMode: on })
    },

    setPagesRun: (state) => set({ pagesRun: state }),

    setParallelPageStates: (states) =>
      set({
        parallelPageStates: Object.fromEntries(
          states.map((state) => [state.artifactId, state])
        )
      }),

    updateParallelPageState: (artifactId, patch) => {
      const id = artifactId.trim()
      if (!id) return
      set((state) => ({
        parallelPageStates: {
          ...state.parallelPageStates,
          [id]: {
            ...state.parallelPageStates[id],
            ...patch,
            artifactId: id,
            status: patch.status ?? state.parallelPageStates[id]?.status ?? 'queued',
            updatedAt: patch.updatedAt ?? new Date().toISOString()
          }
        }
      }))
    },

    clearParallelPageStates: () => set({ parallelPageStates: {} }),

    setFileError: (error) => set({ fileError: error }),

    openImplementPanel: (title) => set({ implementOpen: true, implementTitle: title }),

    closeImplementPanel: () => set({ implementOpen: false }),

    prepareHtmlTurn: (brief, options = {}) =>
      prepareDesignHtmlTurn({ brief, options, get, set, persistIndex }),

    prepareSvgTurn: (brief, options = {}) =>
      prepareDesignSvgTurn({ brief, options, get, set, persistIndex }),

    setAiRailCollapsed: (collapsed) => {
      writeBrowserStorageItem(AI_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0')
      writeBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY, collapsed ? '0' : '1')
      set({ aiRailCollapsed: collapsed, canvasAssistantOpen: !collapsed })
    },

    setCanvasAssistantOpen: (open) => {
      writeBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY, open ? '1' : '0')
      writeBrowserStorageItem(AI_RAIL_COLLAPSED_KEY, open ? '0' : '1')
      set({ canvasAssistantOpen: open, aiRailCollapsed: !open })
    },

    toggleCanvasAssistantOpen: () => {
      get().setCanvasAssistantOpen(!get().canvasAssistantOpen)
    },

    setCanvasInspectorPinned: (pinned) => {
      writeBrowserStorageItem(CANVAS_INSPECTOR_PINNED_KEY, pinned ? '1' : '0')
      set({ canvasInspectorPinned: pinned })
    },

    setAssistantModel: (model, providerId) => {
      const normalized = model.trim()
      const normalizedProvider = (providerId ?? '').trim()
      writeBrowserStorageItem(ASSISTANT_MODEL_KEY, normalized)
      writeBrowserStorageItem(ASSISTANT_PROVIDER_KEY, normalizedProvider)
      set({ assistantModel: normalized, assistantProviderId: normalizedProvider })
    },

    updateDesignContext: (patch) => {
      const nextPatch = { ...patch }
      if (nextPatch.designTarget) {
        nextPatch.designTarget = normalizeDesignTarget(nextPatch.designTarget)
        writeBrowserStorageItem(DESIGN_TARGET_KEY, nextPatch.designTarget)
      }
      set((state) => ({ designContext: { ...state.designContext, ...nextPatch } }))
    },

    loadDesignSettings: async () => {
      settingsLoadGeneration += 1
      const loadGeneration = settingsLoadGeneration
      set({ settingsLoaded: false })
      try {
        try {
          const settings = await rendererRuntimeClient.getSettings()
          if (loadGeneration !== settingsLoadGeneration) return
          const design = settings.design
          const hasStoredViewport = readBrowserStorageItem(VIEWPORT_KEY) !== null
          const hasStoredView = readBrowserStorageItem(CANVAS_VIEW_KEY) !== null
          const resolvedWorkspaceRoot =
            get().workspaceRoot ||
            design.activeWorkspaceRoot ||
            design.defaultWorkspaceRoot ||
            design.workspaces[0] ||
            builtinDesignWorkspaceRoot() ||
            ''
          if (normalizeDesignWorkspaceRoot(get().workspaceRoot) !== normalizeDesignWorkspaceRoot(resolvedWorkspaceRoot)) {
            get().setWorkspaceRoot(resolvedWorkspaceRoot)
          }
          set((state) => ({
            assistantModel: state.assistantModel || design.model,
            assistantProviderId: state.assistantProviderId || design.providerId,
            canvasBackground: design.canvasBackground,
            liveRefresh: design.liveRefresh,
            deviceFrame: design.deviceFrame,
            generationPrompt: design.generationPrompt,
            reasoningEffort: design.reasoningEffort,
            implementStackHint: design.implementStackHint,
            injectIntoCode: design.injectIntoCode,
            publishDesignSystem: design.publishDesignSystem,
            viewport: hasStoredViewport ? state.viewport : design.defaultViewport,
            canvasView: hasStoredView ? state.canvasView : design.defaultCanvasView,
            designContext: {
              ...state.designContext,
              designTarget: state.designContext.designTarget ?? readPersistedDesignTarget(),
              designType: state.designContext.designType ?? (design.designType || undefined),
              designGuidelines: state.designContext.designGuidelines || design.designGuidelines || undefined,
              radius: state.designContext.radius ?? (design.radius || undefined),
              density: state.designContext.density ?? (design.density || undefined),
              fontStyle: state.designContext.fontStyle ?? (design.fontStyle || undefined),
              brandColor: state.designContext.brandColor || design.brandColor || undefined,
              tone:
                state.designContext.tone && state.designContext.tone.length > 0
                  ? state.designContext.tone
                  : design.tone.length > 0
                    ? design.tone
                    : undefined,
              designSystemPreset:
                state.designContext.designSystemPreset ??
                (design.designSystemPreset === 'none' ? undefined : design.designSystemPreset)
            }
          }))
        } catch {
          // Keep local/default state and still let rehydration/fallback below settle the workspace.
        }
        if (loadGeneration !== settingsLoadGeneration) return
        const workspaceRoot = get().workspaceRoot
        await get().rehydrateArtifacts()
        if (
          loadGeneration !== settingsLoadGeneration ||
          normalizeDesignWorkspaceRoot(get().workspaceRoot) !== normalizeDesignWorkspaceRoot(workspaceRoot)
        ) return
        await get().refreshDesignSystemHash()
        if (
          loadGeneration !== settingsLoadGeneration ||
          normalizeDesignWorkspaceRoot(get().workspaceRoot) !== normalizeDesignWorkspaceRoot(workspaceRoot)
        ) return
      } finally {
        if (loadGeneration === settingsLoadGeneration) set({ settingsLoaded: true })
      }
    },

    rehydrateArtifacts: () => {
      const generation = workspaceGeneration
      const workspaceRoot = get().workspaceRoot
      return rehydrateDesignWorkspaceArtifacts({
        get,
        set,
        persistIndex,
        isCurrent: (candidateRoot) =>
          generation === workspaceGeneration &&
          normalizeDesignWorkspaceRoot(candidateRoot) === normalizeDesignWorkspaceRoot(workspaceRoot) &&
          normalizeDesignWorkspaceRoot(get().workspaceRoot) === normalizeDesignWorkspaceRoot(workspaceRoot)
      })
    },

    refreshDesignSystemHash: async () => {
      const { workspaceRoot } = get()
      if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') {
        set({ designSystemHash: '' })
        return
      }
      const res = await window.kunGui
        .readWorkspaceFile({ path: PROJECT_DESIGN_MD_PATH, workspaceRoot })
        .catch(() => null)
      const parsed = res?.ok
        ? await parseProjectDesignMdWithOfficialLint(res.content, { truncated: res.truncated })
        : null
      if (normalizeDesignWorkspaceRoot(get().workspaceRoot) !== normalizeDesignWorkspaceRoot(workspaceRoot)) return
      set({ designSystemHash: parsed?.ok && res?.ok ? hashDesignSystem(res.content) : '' })
    },

    resetWorkspace: () => {
      workspaceGeneration += 1
      const workspaceRoot = get().workspaceRoot
      flushAndReleaseDesignWorkspace(workspaceRoot)
      resetDesignWorkspaceTransientStores()
      set({
        documents: [],
        activeDocumentId: null,
        drawingCreationOpen: false,
        drawingCreationReturnDocumentId: null,
        drawingCreationDocumentId: null,
        drawingCreationSubmitting: false,
        artifacts: [],
        activeArtifactId: null,
        fileError: null,
        designSystemHash: '',
        implementOpen: false,
        pagesRun: null,
        parallelPageStates: {}
      })
    }
  }
})
