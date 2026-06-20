import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  artifactMetaPath,
  deleteArtifactDir,
  parseArtifactMeta,
  persistArtifactMeta,
  reconstructArtifact
} from './design-artifact-persistence'
import { hashDesignSystem } from './design-context'
import type { DesignArtifact, DesignCanvasView, DesignViewport } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'

const CANVAS_VIEW_KEY = 'kun.design.canvasView.v1'
const VIEWPORT_KEY = 'kun.design.viewport.v1'
const AI_RAIL_COLLAPSED_KEY = 'kun.design.aiRailCollapsed.v1'

/**
 * Ids removed this session, filtered out of rehydration so a not-yet-flushed
 * on-disk delete can't resurrect a deleted artifact on the next mount.
 */
const removedArtifactIds = new Set<string>()

function readPersistedCanvasView(): DesignCanvasView {
  return readBrowserStorageItem(CANVAS_VIEW_KEY) === 'code' ? 'code' : 'preview'
}

function readPersistedViewport(): DesignViewport {
  const value = readBrowserStorageItem(VIEWPORT_KEY)
  return value === 'mobile' || value === 'tablet' ? value : 'desktop'
}

function readPersistedAiRailCollapsed(): boolean {
  return readBrowserStorageItem(AI_RAIL_COLLAPSED_KEY) === '1'
}

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => ({
  workspaceRoot: '',
  artifacts: [],
  activeArtifactId: null,
  canvasView: readPersistedCanvasView(),
  viewport: readPersistedViewport(),
  devPreviewUrl: '',
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
  designSystemHash: '',
  implementOpen: false,
  implementTitle: '',
  aiRailCollapsed: readPersistedAiRailCollapsed(),

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

  upsertArtifact: (artifact) => {
    set((state) => {
      const exists = state.artifacts.some((item) => item.id === artifact.id)
      const artifacts = exists
        ? state.artifacts.map((item) => (item.id === artifact.id ? artifact : item))
        : [artifact, ...state.artifacts]
      return { artifacts, activeArtifactId: artifact.id }
    })
    persistArtifactMeta(get().workspaceRoot, artifact)
  },

  addArtifactVersion: (artifactId, version) => {
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
    }))
    const updated = get().artifacts.find((item) => item.id === artifactId)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  markImplemented: (artifactId, threadId, designSystemHash) => {
    set((state) => ({
      ...(designSystemHash ? { designSystemHash } : {}),
      artifacts: state.artifacts.map((item) =>
        item.id === artifactId
          ? {
              ...item,
              implementedAt: new Date().toISOString(),
              implementedThreadId: threadId,
              ...(designSystemHash ? { implementedDesignSystemHash: designSystemHash } : {})
            }
          : item
      )
    }))
    const updated = get().artifacts.find((item) => item.id === artifactId)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  removeArtifact: (artifactId) => {
    removedArtifactIds.add(artifactId)
    deleteArtifactDir(get().workspaceRoot, artifactId)
    set((state) => {
      const artifacts = state.artifacts.filter((item) => item.id !== artifactId)
      const activeArtifactId =
        state.activeArtifactId === artifactId ? artifacts[0]?.id ?? null : state.activeArtifactId
      return { artifacts, activeArtifactId }
    })
  },

  renameArtifact: (artifactId, title) => {
    const trimmed = title.trim()
    set((state) => ({
      artifacts: state.artifacts.map((item) =>
        item.id === artifactId ? { ...item, title: trimmed || item.title } : item
      )
    }))
    const updated = get().artifacts.find((item) => item.id === artifactId)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  setFileError: (error) => set({ fileError: error }),

  openImplementPanel: (title) => set({ implementOpen: true, implementTitle: title }),

  closeImplementPanel: () => set({ implementOpen: false }),

  setAiRailCollapsed: (collapsed) => {
    writeBrowserStorageItem(AI_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0')
    set({ aiRailCollapsed: collapsed })
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
    await get().rehydrateArtifacts()
    await get().refreshDesignSystemHash()
  },

  rehydrateArtifacts: async () => {
    const { workspaceRoot } = get()
    if (!workspaceRoot || typeof window.kunGui?.listWorkspaceDirectory !== 'function') return
    const listing = await window.kunGui
      .listWorkspaceDirectory({ path: '.kun-design', workspaceRoot })
      .catch(() => null)
    if (!listing || !listing.ok) return
    const found: DesignArtifact[] = []
    for (const entry of listing.entries) {
      if (entry.type !== 'directory') continue
      let artifact: DesignArtifact | null = null
      const meta = await window.kunGui
        .readWorkspaceFile({ path: artifactMetaPath(entry.name), workspaceRoot })
        .catch(() => null)
      if (meta && meta.ok) artifact = parseArtifactMeta(meta.content, entry.name)
      if (!artifact) {
        const sub = await window.kunGui
          .listWorkspaceDirectory({ path: `.kun-design/${entry.name}`, workspaceRoot })
          .catch(() => null)
        if (sub && sub.ok) artifact = reconstructArtifact(entry.name, sub.entries)
      }
      if (artifact) found.push(artifact)
    }
    if (found.length === 0) return
    set((state) => {
      const known = new Set(state.artifacts.map((item) => item.id))
      const fresh = found.filter((item) => !known.has(item.id) && !removedArtifactIds.has(item.id))
      if (fresh.length === 0) return {}
      const artifacts = [...state.artifacts, ...fresh].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
      )
      return { artifacts }
    })
  },

  refreshDesignSystemHash: async () => {
    const { workspaceRoot } = get()
    if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') {
      set({ designSystemHash: '' })
      return
    }
    const res = await window.kunGui
      .readWorkspaceFile({ path: '.kun-design/DESIGN_SYSTEM.md', workspaceRoot })
      .catch(() => null)
    set({ designSystemHash: res && res.ok ? hashDesignSystem(res.content) : '' })
  },

  resetWorkspace: () =>
    set({ artifacts: [], activeArtifactId: null, fileError: null, designSystemHash: '', implementOpen: false })
}))
