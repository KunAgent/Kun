import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import type { DesignCanvasView, DesignViewport } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'

const CANVAS_VIEW_KEY = 'kun.design.canvasView.v1'
const VIEWPORT_KEY = 'kun.design.viewport.v1'
const AGENT_PANEL_KEY = 'kun.design.agentPanelOpen.v1'

function readPersistedCanvasView(): DesignCanvasView {
  return readBrowserStorageItem(CANVAS_VIEW_KEY) === 'code' ? 'code' : 'preview'
}

function readPersistedViewport(): DesignViewport {
  const value = readBrowserStorageItem(VIEWPORT_KEY)
  return value === 'mobile' || value === 'tablet' ? value : 'desktop'
}

function readPersistedAgentPanelOpen(): boolean {
  return readBrowserStorageItem(AGENT_PANEL_KEY) !== '0'
}

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set) => ({
  workspaceRoot: '',
  artifacts: [],
  activeArtifactId: null,
  canvasView: readPersistedCanvasView(),
  viewport: readPersistedViewport(),
  devPreviewUrl: '',
  agentPanelOpen: readPersistedAgentPanelOpen(),
  assistantModel: '',
  assistantProviderId: '',
  designContext: {},
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

  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),

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

  setActiveArtifact: (artifactId) => set({ activeArtifactId: artifactId }),

  upsertArtifact: (artifact) =>
    set((state) => {
      const exists = state.artifacts.some((item) => item.id === artifact.id)
      const artifacts = exists
        ? state.artifacts.map((item) => (item.id === artifact.id ? artifact : item))
        : [artifact, ...state.artifacts]
      return { artifacts, activeArtifactId: artifact.id }
    }),

  addArtifactVersion: (artifactId, version) =>
    set((state) => ({
      artifacts: state.artifacts.map((item) =>
        item.id === artifactId
          ? {
              ...item,
              relativePath: version.relativePath,
              updatedAt: version.createdAt,
              versions: [version, ...item.versions]
            }
          : item
      )
    })),

  markImplemented: (artifactId, threadId) =>
    set((state) => ({
      artifacts: state.artifacts.map((item) =>
        item.id === artifactId
          ? { ...item, implementedAt: new Date().toISOString(), implementedThreadId: threadId }
          : item
      )
    })),

  removeArtifact: (artifactId) =>
    set((state) => {
      const artifacts = state.artifacts.filter((item) => item.id !== artifactId)
      const activeArtifactId =
        state.activeArtifactId === artifactId ? artifacts[0]?.id ?? null : state.activeArtifactId
      return { artifacts, activeArtifactId }
    }),

  setAgentPanelOpen: (open) => {
    writeBrowserStorageItem(AGENT_PANEL_KEY, open ? '1' : '0')
    set({ agentPanelOpen: open })
  },

  setAssistantModel: (model, providerId) =>
    set({ assistantModel: model, assistantProviderId: providerId ?? '' }),

  updateDesignContext: (patch) =>
    set((state) => ({ designContext: { ...state.designContext, ...patch } })),

  loadDesignSettings: async () => {
    try {
      const settings = await rendererRuntimeClient.getSettings()
      const design = settings.design
      const hasStoredViewport = readBrowserStorageItem(VIEWPORT_KEY) !== null
      const hasStoredView = readBrowserStorageItem(CANVAS_VIEW_KEY) !== null
      set((state) => ({
        settingsLoaded: true,
        workspaceRoot: state.workspaceRoot || design.defaultWorkspaceRoot || settings.workspaceRoot || '',
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
      set({ settingsLoaded: true })
    }
  },

  resetWorkspace: () => set({ artifacts: [], activeArtifactId: null, fileError: null })
}))
