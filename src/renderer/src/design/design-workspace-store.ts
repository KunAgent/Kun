import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  artifactDesignMdPath,
  artifactMetaPath,
  deleteArtifactDir,
  parseArtifactMeta,
  persistArtifactMeta,
  reconstructArtifact
} from './design-artifact-persistence'
import { hashDesignSystem } from './design-context'
import { createDesignArtifactId, defaultDesignArtifactNode } from './design-types'
import type { DesignArtifact, DesignCanvasView, DesignViewport } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'

const CANVAS_VIEW_KEY = 'kun.design.canvasView.v1'
const VIEWPORT_KEY = 'kun.design.viewport.v1'
const AI_RAIL_COLLAPSED_KEY = 'kun.design.aiRailCollapsed.v1'
const CANVAS_ASSISTANT_OPEN_KEY = 'kun.design.canvasAssistantOpen.v1'
const CANVAS_INSPECTOR_PINNED_KEY = 'kun.design.canvasInspectorPinned.v1'
const ASSISTANT_MODEL_KEY = 'kun.design.assistantModel.v1'
const ASSISTANT_PROVIDER_KEY = 'kun.design.assistantProvider.v1'

function builtinDesignWorkspaceRoot(): string {
  const homeDir = typeof window !== 'undefined' ? (window.kunGui?.homeDir ?? '') : ''
  return homeDir ? `${homeDir}/.kun/design-workspace` : ''
}

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

function readPersistedCanvasAssistantOpen(): boolean {
  const value = readBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY)
  if (value === '1') return true
  if (value === '0') return false
  return !readPersistedAiRailCollapsed()
}

function readPersistedCanvasInspectorPinned(): boolean {
  return readBrowserStorageItem(CANVAS_INSPECTOR_PINNED_KEY) === '1'
}

function readPersistedAssistantModel(): string {
  return readBrowserStorageItem(ASSISTANT_MODEL_KEY)?.trim() ?? ''
}

function readPersistedAssistantProvider(): string {
  return readBrowserStorageItem(ASSISTANT_PROVIDER_KEY)?.trim() ?? ''
}

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => ({
  workspaceRoot: '',
  artifacts: [],
  activeArtifactId: null,
  canvasView: readPersistedCanvasView(),
  viewport: readPersistedViewport(),
  devPreviewUrl: '',
  assistantModel: readPersistedAssistantModel(),
  assistantProviderId: readPersistedAssistantProvider(),
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
  canvasAssistantOpen: readPersistedCanvasAssistantOpen(),
  canvasInspectorPinned: readPersistedCanvasInspectorPinned(),
  designIntentMode: 'generate',

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

  setActiveArtifact: (artifactId) => set({ activeArtifactId: artifactId, fileError: null }),

  upsertArtifact: (artifact) => {
    set((state) => {
      const exists = state.artifacts.some((item) => item.id === artifact.id)
      const artifactWithDefaults =
        artifact.kind === 'html'
          ? { ...artifact, designMdPath: artifact.designMdPath ?? artifactDesignMdPath(artifact.id) }
          : artifact
      const nextArtifact = artifactWithDefaults.node
        ? artifactWithDefaults
        : { ...artifactWithDefaults, node: defaultDesignArtifactNode(state.artifacts.length) }
      const artifacts = exists
        ? state.artifacts.map((item) => (item.id === artifact.id ? nextArtifact : item))
        : [nextArtifact, ...state.artifacts]
      return { artifacts, activeArtifactId: nextArtifact.id }
    })
    const updated = get().artifacts.find((item) => item.id === artifact.id)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  addArtifactVersion: (artifactId, version) => {
    set((state) => ({
      artifacts: state.artifacts.map((item) =>
        item.id === artifactId
          ? {
              ...item,
              relativePath: version.relativePath,
              updatedAt: version.createdAt,
              versions: [version, ...item.versions],
              ...(item.kind === 'html'
                ? { designMdPath: item.designMdPath ?? artifactDesignMdPath(item.id), previewStatus: 'pending' as const }
                : {})
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

  updateArtifactNode: (artifactId, patch) => {
    set((state) => ({
      artifacts: state.artifacts.map((item, index) => {
        if (item.id !== artifactId) return item
        const current = item.node ?? defaultDesignArtifactNode(index)
        return {
          ...item,
          node: {
            ...current,
            ...patch,
            width: Math.max(240, patch.width ?? current.width),
            height: Math.max(180, patch.height ?? current.height)
          }
        }
      })
    }))
    const updated = get().artifacts.find((item) => item.id === artifactId)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  duplicateArtifact: async (artifactId) => {
    const state = get()
    const source = state.artifacts.find((item) => item.id === artifactId)
    const workspaceRoot = state.workspaceRoot
    if (
      !source ||
      source.kind !== 'html' ||
      !workspaceRoot ||
      typeof window.kunGui?.readWorkspaceFile !== 'function' ||
      typeof window.kunGui?.writeWorkspaceFile !== 'function'
    ) {
      return
    }
    const read = await window.kunGui
      .readWorkspaceFile({ path: source.relativePath, workspaceRoot })
      .catch(() => null)
    if (!read || !read.ok) return
    const createdAt = new Date().toISOString()
    const copyId = createDesignArtifactId()
    const relativePath = `.kun-design/${copyId}/v1.html`
    const designMdPath = artifactDesignMdPath(copyId)
    const write = await window.kunGui
      .writeWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
      .catch(() => null)
    if (!write || !write.ok) return
    const sourceNode = source.node ?? defaultDesignArtifactNode(state.artifacts.findIndex((item) => item.id === source.id))
    get().upsertArtifact({
      id: copyId,
      kind: 'html',
      title: `${source.title} copy`,
      relativePath,
      createdAt,
      updatedAt: createdAt,
      versions: [{ id: `${copyId}-v1`, relativePath, createdAt, summary: source.versions[0]?.summary ?? '' }],
      designMdPath,
      previewStatus: 'ready',
      node: {
        ...sourceNode,
        x: sourceNode.x + 44,
        y: sourceNode.y + 44
      }
    })
  },

  selectArtifactVersion: (artifactId, versionId) => {
    set((state) => ({
      artifacts: state.artifacts.map((item) => {
        if (item.id !== artifactId) return item
        const version = item.versions.find((candidate) => candidate.id === versionId)
        if (!version) return item
        return {
          ...item,
          relativePath: version.relativePath,
          updatedAt: version.createdAt
        }
      })
    }))
    const updated = get().artifacts.find((item) => item.id === artifactId)
    if (updated) persistArtifactMeta(get().workspaceRoot, updated)
  },

  setDesignIntentMode: (mode) => set({ designIntentMode: mode }),

  setFileError: (error) => set({ fileError: error }),

  openImplementPanel: (title) => set({ implementOpen: true, implementTitle: title }),

  closeImplementPanel: () => set({ implementOpen: false }),

  prepareHtmlTurn: (brief, options = {}) => {
    const text = brief.trim()
    const state = get()
    const active = state.artifacts.find((item) => item.id === state.activeArtifactId) ?? null
    const target = options.artifactId
      ? state.artifacts.find((item) => item.id === options.artifactId) ?? null
      : active
    // Only HTML artifacts can be iterated; a canvas/other active artifact starts a fresh draft.
    const activeHtml = !options.forceNew && target?.kind === 'html' ? target : null
    const createdAt = new Date().toISOString()

    if (activeHtml) {
      const versionN = activeHtml.versions.length + 1
      const relativePath = `.kun-design/${activeHtml.id}/v${versionN}.html`
      const designMdPath = activeHtml.designMdPath ?? artifactDesignMdPath(activeHtml.id)
      get().addArtifactVersion(activeHtml.id, {
        id: `${activeHtml.id}-v${versionN}`,
        relativePath,
        createdAt,
        summary: text
      })
      if (options.activate !== false) set({ activeArtifactId: activeHtml.id })
      return { artifactId: activeHtml.id, relativePath, basePath: activeHtml.relativePath, designMdPath }
    }

    const artifactId = createDesignArtifactId()
    const relativePath = `.kun-design/${artifactId}/v1.html`
    const designMdPath = artifactDesignMdPath(artifactId)
    const title = text.length > 48 ? `${text.slice(0, 48)}…` : text || 'Untitled design'
    get().upsertArtifact({
      id: artifactId,
      kind: 'html',
      title,
      relativePath,
      createdAt,
      updatedAt: createdAt,
      versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: text }],
      designMdPath,
      previewStatus: 'pending',
      node: defaultDesignArtifactNode(state.artifacts.length)
    })
    return { artifactId, relativePath, designMdPath }
  },

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
        workspaceRoot: state.workspaceRoot || design.defaultWorkspaceRoot || builtinDesignWorkspaceRoot() || '',
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
      ).map((item, index) => ({
        ...item,
        node: item.node ?? defaultDesignArtifactNode(index)
      }))
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
