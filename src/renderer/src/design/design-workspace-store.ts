import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  artifactDesignMdPath,
  artifactDesignMdPathOf,
  artifactDirPath,
  deleteArtifactDir,
  parseArtifactMeta,
  persistArtifactMeta,
  reconstructArtifact,
  serializeArtifactMeta
} from './design-artifact-persistence'
import {
  deleteDocumentDir,
  documentsIndexPath,
  flushDocumentsIndex,
  parseDocumentsIndex,
  persistDocumentsIndex
} from './design-document-persistence'
import {
  migrateRegistryToDoc,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from './design-thread-registry'
import { hashDesignSystem } from './design-context'
import {
  createDesignArtifactId,
  createDesignDocumentId,
  defaultDesignArtifactNode
} from './design-types'
import type {
  DesignArtifact,
  DesignCanvasView,
  DesignDocument,
  DesignViewport
} from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'

const DESIGN_DIR = '.kun-design'

const CANVAS_VIEW_KEY = 'kun.design.canvasView.v1'
const VIEWPORT_KEY = 'kun.design.viewport.v1'
const AI_RAIL_COLLAPSED_KEY = 'kun.design.aiRailCollapsed.v1'
const CANVAS_ASSISTANT_OPEN_KEY = 'kun.design.canvasAssistantOpen.v1'
const CANVAS_INSPECTOR_PINNED_KEY = 'kun.design.canvasInspectorPinned.v1'
const ASSISTANT_MODEL_KEY = 'kun.design.assistantModel.v1'
const ASSISTANT_PROVIDER_KEY = 'kun.design.assistantProvider.v1'
const MULTI_PAGE_MODE_KEY = 'kun.design.multiPageMode.v1'

function builtinDesignWorkspaceRoot(): string {
  const homeDir = typeof window !== 'undefined' ? (window.kunGui?.homeDir ?? '') : ''
  return homeDir ? `${homeDir}/.kun/design-workspace` : ''
}

function defaultDocumentTitle(): string {
  const label = i18n.t('common:designDefaultDocTitle')
  return label && label !== 'designDefaultDocTitle' ? label : 'My design'
}

/**
 * Ids removed this session, filtered out of rehydration so a not-yet-flushed
 * on-disk delete can't resurrect a deleted artifact or 设计稿 on the next mount.
 */
const removedArtifactIds = new Set<string>()
const removedDocumentIds = new Set<string>()

// --- Active-document projection ------------------------------------------------

/** Recompute the flat `artifacts`/`activeArtifactId` projection from the active 设计稿. */
function projectActiveDoc(
  documents: DesignDocument[],
  activeDocumentId: string | null
): Pick<DesignWorkspaceState, 'artifacts' | 'activeArtifactId'> {
  const doc = activeDocumentId ? documents.find((d) => d.id === activeDocumentId) ?? null : null
  return { artifacts: doc?.artifacts ?? [], activeArtifactId: doc?.activeArtifactId ?? null }
}

/**
 * Apply `nextArtifacts` to the active 设计稿's 画布 array (touching updatedAt) and
 * return the merged state slice (documents + reprojection). The single funnel
 * every artifact mutation goes through so the source of truth (`documents`) and
 * the projection (`artifacts`) never drift. No active 设计稿 → no-op.
 */
function applyToActiveDoc(
  state: DesignWorkspaceState,
  nextArtifacts: (artifacts: DesignArtifact[]) => DesignArtifact[],
  nextActiveArtifactId?: string | null
): Partial<DesignWorkspaceState> {
  const idx = state.documents.findIndex((d) => d.id === state.activeDocumentId)
  if (idx === -1) return {}
  const doc = state.documents[idx]
  const artifacts = nextArtifacts(doc.artifacts)
  const nextDoc: DesignDocument = {
    ...doc,
    artifacts,
    activeArtifactId:
      nextActiveArtifactId !== undefined ? nextActiveArtifactId : doc.activeArtifactId,
    updatedAt: new Date().toISOString()
  }
  const documents = state.documents.map((d, i) => (i === idx ? nextDoc : d))
  return { documents, artifacts, activeArtifactId: nextDoc.activeArtifactId }
}

// --- Disk rehydration helpers --------------------------------------------------

function sortArtifacts(items: DesignArtifact[]): DesignArtifact[] {
  return items
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .map((item, index) => ({ ...item, node: item.node ?? defaultDesignArtifactNode(index) }))
}

/** Load one artifact from its on-disk dir (meta.json sidecar, else reconstruct). */
async function loadArtifactDir(
  workspaceRoot: string,
  artifactDir: string,
  artifactId: string
): Promise<DesignArtifact | null> {
  const api = window.kunGui
  if (!api || typeof api.readWorkspaceFile !== 'function' || typeof api.listWorkspaceDirectory !== 'function') {
    return null
  }
  const metaRead = await api.readWorkspaceFile({ path: `${artifactDir}/meta.json`, workspaceRoot }).catch(() => null)
  if (metaRead && metaRead.ok) {
    const parsed = parseArtifactMeta(metaRead.content, artifactId)
    if (parsed) return parsed
  }
  const sub = await api.listWorkspaceDirectory({ path: artifactDir, workspaceRoot }).catch(() => null)
  if (sub && sub.ok) return reconstructArtifact(artifactDir, sub.entries)
  return null
}

/** Load every 画布 in a 设计稿 dir (`.kun-design/<docId>/<artifactId>/`). */
async function loadArtifactsForDoc(workspaceRoot: string, docId: string): Promise<DesignArtifact[]> {
  const api = window.kunGui
  if (!api || typeof api.listWorkspaceDirectory !== 'function') return []
  const sub = await api.listWorkspaceDirectory({ path: `${DESIGN_DIR}/${docId}`, workspaceRoot }).catch(() => null)
  if (!sub || !sub.ok) return []
  const found: DesignArtifact[] = []
  for (const entry of sub.entries) {
    if (entry.type !== 'directory' || removedArtifactIds.has(entry.name)) continue
    const artifact = await loadArtifactDir(workspaceRoot, `${DESIGN_DIR}/${docId}/${entry.name}`, entry.name)
    if (artifact) found.push(artifact)
  }
  return sortArtifacts(found)
}

/** Rewrite an artifact's own + version + DESIGN.md paths from one dir prefix to another. */
function rewriteArtifactPaths(a: DesignArtifact, oldPrefix: string, newPrefix: string): DesignArtifact {
  const swap = (p: string): string => (p.startsWith(oldPrefix) ? newPrefix + p.slice(oldPrefix.length) : p)
  return {
    ...a,
    relativePath: swap(a.relativePath),
    versions: a.versions.map((v) => ({ ...v, relativePath: swap(v.relativePath) })),
    ...(a.designMdPath ? { designMdPath: swap(a.designMdPath) } : {})
  }
}

/**
 * Physically move a legacy flat artifact (`.kun-design/<id>/…`) into the default
 * 设计稿's dir (`.kun-design/<docId>/<id>/…`) so the new model is uniform on disk.
 * Best-effort: any IO failure leaves the artifact at its flat path (still adopted
 * into the 设计稿 — nothing is lost), since relativePath is per-artifact.
 */
async function moveArtifactIntoDoc(
  workspaceRoot: string,
  artifact: DesignArtifact,
  entries: { name: string; type: string }[],
  docId: string
): Promise<DesignArtifact> {
  const api = window.kunGui
  const oldPrefix = `${DESIGN_DIR}/${artifact.id}/`
  if (
    !api ||
    typeof api.readWorkspaceFile !== 'function' ||
    typeof api.writeWorkspaceFile !== 'function' ||
    !artifact.relativePath.startsWith(oldPrefix)
  ) {
    return artifact
  }
  const newPrefix = `${DESIGN_DIR}/${docId}/${artifact.id}/`
  try {
    const files = entries.filter((e) => e.type === 'file' && e.name !== 'meta.json')
    for (const file of files) {
      const read = await api.readWorkspaceFile({ path: `${oldPrefix}${file.name}`, workspaceRoot })
      if (!read || !read.ok) throw new Error('read failed')
      const write = await api.writeWorkspaceFile({ path: `${newPrefix}${file.name}`, workspaceRoot, content: read.content })
      if (!write || !write.ok) throw new Error('write failed')
    }
    const rewritten = rewriteArtifactPaths(artifact, oldPrefix, newPrefix)
    await api
      .writeWorkspaceFile({ path: `${newPrefix}meta.json`, workspaceRoot, content: serializeArtifactMeta(rewritten) })
      .catch(() => undefined)
    if (typeof api.deleteWorkspaceEntry === 'function') {
      await api.deleteWorkspaceEntry({ path: `${DESIGN_DIR}/${artifact.id}`, workspaceRoot }).catch(() => undefined)
    }
    return rewritten
  } catch {
    return artifact
  }
}

/**
 * Legacy → nested upgrade. Wrap all flat `.kun-design/<id>/` artifact dirs into a
 * single default 设计稿 (preserving canvas positions), moving their files under
 * the 设计稿 dir. Returns the default 设计稿 or null when there's nothing legacy.
 */
async function migrateLegacyToDefaultDoc(
  workspaceRoot: string,
  topDirs: { name: string; type: string }[]
): Promise<DesignDocument | null> {
  const api = window.kunGui
  if (!api || typeof api.listWorkspaceDirectory !== 'function' || typeof api.readWorkspaceFile !== 'function') {
    return null
  }
  const legacy: { artifact: DesignArtifact; entries: { name: string; type: string }[] }[] = []
  for (const entry of topDirs) {
    if (removedArtifactIds.has(entry.name)) continue
    const dir = `${DESIGN_DIR}/${entry.name}`
    const sub = await api.listWorkspaceDirectory({ path: dir, workspaceRoot }).catch(() => null)
    if (!sub || !sub.ok) continue
    let artifact: DesignArtifact | null = null
    const metaRead = await api.readWorkspaceFile({ path: `${dir}/meta.json`, workspaceRoot }).catch(() => null)
    if (metaRead && metaRead.ok) artifact = parseArtifactMeta(metaRead.content, entry.name)
    if (!artifact) artifact = reconstructArtifact(dir, sub.entries)
    if (artifact) legacy.push({ artifact, entries: sub.entries })
  }
  if (legacy.length === 0) return null
  const docId = createDesignDocumentId()
  const createdAt = new Date().toISOString()
  const moved: DesignArtifact[] = []
  for (const { artifact, entries } of legacy) {
    moved.push(await moveArtifactIntoDoc(workspaceRoot, artifact, entries, docId))
  }
  const artifacts = sortArtifacts(moved)
  return {
    id: docId,
    title: defaultDocumentTitle(),
    createdAt,
    updatedAt: createdAt,
    order: 0,
    artifacts,
    activeArtifactId: artifacts[0]?.id ?? null
  }
}

// --- Persisted UI prefs --------------------------------------------------------

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

function readPersistedMultiPageMode(): boolean {
  return readBrowserStorageItem(MULTI_PAGE_MODE_KEY) === '1'
}

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => {
  const persistIndex = (): void => {
    const s = get()
    persistDocumentsIndex(s.workspaceRoot, s.documents, s.activeDocumentId)
  }

  // Structural deletes must hit disk immediately — a debounced write can be lost
  // to a reload before it flushes, resurrecting the just-deleted 设计稿/画布.
  const persistIndexNow = (): void => {
    const s = get()
    void flushDocumentsIndex(s.workspaceRoot, s.documents, s.activeDocumentId)
  }

  return {
    workspaceRoot: '',
    documents: [],
    activeDocumentId: null,
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
    multiPageMode: readPersistedMultiPageMode(),
    pagesRun: null,

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

    setActiveArtifact: (artifactId) => {
      set((state) => {
        const idx = state.documents.findIndex((d) => d.id === state.activeDocumentId)
        if (idx === -1) return { activeArtifactId: artifactId, fileError: null }
        const doc = state.documents[idx]
        if (doc.activeArtifactId === artifactId) return { fileError: null }
        const documents = state.documents.map((d, i) => (i === idx ? { ...d, activeArtifactId: artifactId } : d))
        return { documents, activeArtifactId: artifactId, fileError: null }
      })
      persistIndex()
    },

    createDocument: (title) => {
      const id = createDesignDocumentId()
      const createdAt = new Date().toISOString()
      set((state) => {
        const order = state.documents.reduce((max, d) => Math.max(max, d.order), -1) + 1
        const doc: DesignDocument = {
          id,
          title: (title ?? '').trim() || defaultDocumentTitle(),
          createdAt,
          updatedAt: createdAt,
          order,
          artifacts: [],
          activeArtifactId: null
        }
        const documents = [...state.documents, doc]
        return { documents, activeDocumentId: id, ...projectActiveDoc(documents, id), fileError: null }
      })
      persistIndex()
      return id
    },

    renameDocument: (documentId, title) => {
      const trimmed = title.trim()
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === documentId ? { ...d, title: trimmed || d.title, updatedAt: new Date().toISOString() } : d
        )
      }))
      persistIndex()
    },

    removeDocument: (documentId) => {
      removedDocumentIds.add(documentId)
      const workspaceRoot = get().workspaceRoot
      const doc = get().documents.find((d) => d.id === documentId)
      if (doc) {
        for (const artifact of doc.artifacts) {
          removedArtifactIds.add(artifact.id)
          deleteArtifactDir(workspaceRoot, artifact.relativePath)
        }
      }
      deleteDocumentDir(workspaceRoot, documentId)
      set((state) => {
        const documents = state.documents.filter((d) => d.id !== documentId)
        const activeDocumentId =
          state.activeDocumentId === documentId ? documents[0]?.id ?? null : state.activeDocumentId
        return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId), fileError: null }
      })
      persistIndexNow()
    },

    switchActiveDocument: (documentId) => {
      set((state) => {
        if (!state.documents.some((d) => d.id === documentId)) return {}
        return { activeDocumentId: documentId, ...projectActiveDoc(state.documents, documentId), fileError: null }
      })
      persistIndex()
    },

    ensureActiveDocument: () => {
      const state = get()
      if (state.activeDocumentId && state.documents.some((d) => d.id === state.activeDocumentId)) {
        return state.activeDocumentId
      }
      if (state.documents.length > 0) {
        const id = state.documents[0].id
        set({ activeDocumentId: id, ...projectActiveDoc(state.documents, id) })
        persistIndex()
        return id
      }
      return get().createDocument()
    },

    upsertArtifact: (artifact) => {
      get().ensureActiveDocument()
      set((state) =>
        applyToActiveDoc(
          state,
          (artifacts) => {
            const withDefaults =
              artifact.kind === 'html'
                ? { ...artifact, designMdPath: artifact.designMdPath ?? artifactDesignMdPathOf(artifact.relativePath) }
                : artifact
            const nextArtifact = withDefaults.node
              ? withDefaults
              : { ...withDefaults, node: defaultDesignArtifactNode(artifacts.length) }
            return artifacts.some((item) => item.id === artifact.id)
              ? artifacts.map((item) => (item.id === artifact.id ? nextArtifact : item))
              : [nextArtifact, ...artifacts]
          },
          artifact.id
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifact.id)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    addArtifactVersion: (artifactId, version) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) =>
            item.id === artifactId
              ? {
                  ...item,
                  relativePath: version.relativePath,
                  updatedAt: version.createdAt,
                  versions: [version, ...item.versions],
                  ...(item.kind === 'html'
                    ? {
                        designMdPath: item.designMdPath ?? artifactDesignMdPathOf(version.relativePath),
                        previewStatus: 'pending' as const
                      }
                    : {})
                }
              : item
          )
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    markImplemented: (artifactId, threadId, designSystemHash) => {
      set((state) => ({
        ...(designSystemHash ? { designSystemHash } : {}),
        ...applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) =>
            item.id === artifactId
              ? {
                  ...item,
                  implementedAt: new Date().toISOString(),
                  implementedThreadId: threadId,
                  ...(designSystemHash ? { implementedDesignSystemHash: designSystemHash } : {})
                }
              : item
          )
        )
      }))
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    removeArtifact: (artifactId) => {
      removedArtifactIds.add(artifactId)
      const target = get().artifacts.find((item) => item.id === artifactId)
      if (target) deleteArtifactDir(get().workspaceRoot, target.relativePath)
      set((state) => {
        const idx = state.documents.findIndex((d) => d.id === state.activeDocumentId)
        if (idx === -1) return {}
        const doc = state.documents[idx]
        const artifacts = doc.artifacts.filter((item) => item.id !== artifactId)
        const activeArtifactId =
          doc.activeArtifactId === artifactId ? artifacts[0]?.id ?? null : doc.activeArtifactId
        const nextDoc: DesignDocument = { ...doc, artifacts, activeArtifactId, updatedAt: new Date().toISOString() }
        const documents = state.documents.map((d, i) => (i === idx ? nextDoc : d))
        return { documents, artifacts, activeArtifactId }
      })
      persistIndexNow()
    },

    renameArtifact: (artifactId, title) => {
      const trimmed = title.trim()
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => (item.id === artifactId ? { ...item, title: trimmed || item.title } : item))
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    setVersionSummary: (artifactId, versionId, summary) => {
      const trimmed = summary.trim()
      if (!trimmed) return
      let changedAny = false
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => {
            if (item.id !== artifactId) return item
            let changed = false
            const versions = item.versions.map((version) => {
              if (version.id !== versionId || version.summary === trimmed) return version
              changed = true
              return { ...version, summary: trimmed }
            })
            if (changed) changedAny = true
            return changed ? { ...item, versions } : item
          })
        )
      )
      if (!changedAny) return
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    updateArtifactNode: (artifactId, patch) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item, index) => {
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
        )
      )
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
      const docId = get().ensureActiveDocument()
      const createdAt = new Date().toISOString()
      const copyId = createDesignArtifactId()
      const relativePath = `${artifactDirPath(docId, copyId)}/v1.html`
      const designMdPath = artifactDesignMdPath(docId, copyId)
      const write = await window.kunGui
        .writeWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
        .catch(() => null)
      if (!write || !write.ok) return
      const sourceNode =
        source.node ?? defaultDesignArtifactNode(state.artifacts.findIndex((item) => item.id === source.id))
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
        node: { ...sourceNode, x: sourceNode.x + 44, y: sourceNode.y + 44 }
      })
    },

    selectArtifactVersion: (artifactId, versionId) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => {
            if (item.id !== artifactId) return item
            const version = item.versions.find((candidate) => candidate.id === versionId)
            if (!version) return item
            return { ...item, relativePath: version.relativePath, updatedAt: version.createdAt }
          })
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
    },

    setDesignIntentMode: (mode) => set({ designIntentMode: mode }),

    setMultiPageMode: (on) => {
      writeBrowserStorageItem(MULTI_PAGE_MODE_KEY, on ? '1' : '0')
      set({ multiPageMode: on })
    },

    setPagesRun: (state) => set({ pagesRun: state }),

    setFileError: (error) => set({ fileError: error }),

    openImplementPanel: (title) => set({ implementOpen: true, implementTitle: title }),

    closeImplementPanel: () => set({ implementOpen: false }),

    prepareHtmlTurn: (brief, options = {}) => {
      const text = brief.trim()
      const docId = get().ensureActiveDocument()
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
        const dir = activeHtml.relativePath.slice(0, activeHtml.relativePath.lastIndexOf('/'))
        const relativePath = `${dir}/v${versionN}.html`
        const designMdPath = activeHtml.designMdPath ?? `${dir}/DESIGN.md`
        get().addArtifactVersion(activeHtml.id, {
          id: `${activeHtml.id}-v${versionN}`,
          relativePath,
          createdAt,
          summary: text
        })
        if (options.activate !== false) get().setActiveArtifact(activeHtml.id)
        return { artifactId: activeHtml.id, relativePath, basePath: activeHtml.relativePath, designMdPath }
      }

      const artifactId = createDesignArtifactId()
      const relativePath = `${artifactDirPath(docId, artifactId)}/v1.html`
      const designMdPath = artifactDesignMdPath(docId, artifactId)
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
    if (options.activate === false) set({ activeArtifactId: state.activeArtifactId })
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
      // Always land on an active 设计稿 so the canvas has somewhere to render.
      if (get().documents.length === 0) get().createDocument()
    },

    rehydrateArtifacts: async () => {
      const { workspaceRoot } = get()
      const api = window.kunGui
      if (
        !workspaceRoot ||
        !api ||
        typeof api.listWorkspaceDirectory !== 'function' ||
        typeof api.readWorkspaceFile !== 'function'
      ) {
        return
      }

      const indexRead = await api.readWorkspaceFile({ path: documentsIndexPath(), workspaceRoot }).catch(() => null)
      const index = indexRead && indexRead.ok ? parseDocumentsIndex(indexRead.content) : null
      const listing = await api.listWorkspaceDirectory({ path: DESIGN_DIR, workspaceRoot }).catch(() => null)
      if (!listing || !listing.ok) return
      const topDirs = listing.entries.filter((e) => e.type === 'directory')

      if (index) {
        const docIds = new Set(index.documents.map((d) => d.id))
        const loaded: DesignDocument[] = []
        for (const entry of index.documents) {
          if (removedDocumentIds.has(entry.id)) continue
          const artifacts = await loadArtifactsForDoc(workspaceRoot, entry.id)
          const activeArtifactId = artifacts.some((a) => a.id === entry.activeArtifactId)
            ? entry.activeArtifactId
            : artifacts[0]?.id ?? null
          loaded.push({
            id: entry.id,
            title: entry.title,
            order: entry.order,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            artifacts,
            activeArtifactId
          })
        }
        // Adopt orphan top-level artifact dirs (hand-authored / migration fallback).
        const orphans: DesignArtifact[] = []
        for (const entry of topDirs) {
          if (docIds.has(entry.name) || removedArtifactIds.has(entry.name)) continue
          const artifact = await loadArtifactDir(workspaceRoot, `${DESIGN_DIR}/${entry.name}`, entry.name)
          if (artifact) orphans.push(artifact)
        }
        set((state) => {
          if (state.documents.length === 0) {
            let documents = loaded
            if (orphans.length > 0) {
              if (documents.length > 0) {
                documents = documents.map((d, i) =>
                  i === 0 ? { ...d, artifacts: sortArtifacts([...d.artifacts, ...orphans]) } : d
                )
              } else {
                const createdAt = new Date().toISOString()
                const sorted = sortArtifacts(orphans)
                documents = [
                  {
                    id: createDesignDocumentId(),
                    title: defaultDocumentTitle(),
                    createdAt,
                    updatedAt: createdAt,
                    order: 0,
                    artifacts: sorted,
                    activeArtifactId: sorted[0]?.id ?? null
                  }
                ]
              }
            }
            const activeDocumentId = documents.some((d) => d.id === index.activeDocumentId)
              ? index.activeDocumentId
              : documents[0]?.id ?? null
            return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId) }
          }
          // Merge with disk truth. Drop empty stub 设计稿 that an eager pre-rehydrate
          // board-ensure may have auto-created (keep one only if it holds 画布 or
          // exists on disk) so loaded/migrated 设计稿 are never lost or shadowed.
          const loadedById = new Map(loaded.map((d) => [d.id, d]))
          const kept = state.documents
            .filter((doc) => doc.artifacts.length > 0 || loadedById.has(doc.id))
            .map((doc) => {
              const incoming = loadedById.get(doc.id)
              if (!incoming) return doc
              const known = new Set(doc.artifacts.map((a) => a.id))
              const fresh = incoming.artifacts.filter((a) => !known.has(a.id) && !removedArtifactIds.has(a.id))
              return fresh.length > 0 ? { ...doc, artifacts: sortArtifacts([...doc.artifacts, ...fresh]) } : doc
            })
          const keptIds = new Set(kept.map((d) => d.id))
          const documents = [...kept, ...loaded.filter((l) => !keptIds.has(l.id))]
          const activeDocumentId = documents.some((d) => d.id === state.activeDocumentId)
            ? state.activeDocumentId
            : documents.some((d) => d.id === index.activeDocumentId)
              ? index.activeDocumentId
              : documents[0]?.id ?? null
          return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId) }
        })
        persistIndex()
        return
      }

      // No index → legacy upgrade (or fresh workspace).
      const defaultDoc = await migrateLegacyToDefaultDoc(workspaceRoot, topDirs)
      if (!defaultDoc) return
      saveDesignThreadRegistry(migrateRegistryToDoc(readDesignThreadRegistry(), workspaceRoot, defaultDoc.id))
      set((state) => {
        if (state.documents.some((d) => d.id === defaultDoc.id)) return {}
        // Drop empty stub 设计稿 from an eager pre-rehydrate auto-create; the
        // migrated 设计稿 is authoritative for legacy data.
        const withContent = state.documents.filter((d) => d.artifacts.length > 0)
        const documents = [...withContent, defaultDoc]
        const activeDocumentId = documents.some((d) => d.id === state.activeDocumentId)
          ? state.activeDocumentId
          : defaultDoc.id
        return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId) }
      })
      persistIndex()
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
      set({
        documents: [],
        activeDocumentId: null,
        artifacts: [],
        activeArtifactId: null,
        fileError: null,
        designSystemHash: '',
        implementOpen: false,
        pagesRun: null
      })
  }
})
