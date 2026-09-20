import i18n from '../../i18n'
import { readBrowserStorageItem } from '../../lib/browser-storage'
import {
  artifactDesignMdPathOf,
  deleteArtifactDir,
  inferSvgArtifactNode,
  parseArtifactMeta,
  reconstructArtifact,
  serializeArtifactMeta
} from '../design-artifact-persistence'
import { deleteDocumentDir, documentsIndexPath, parseDocumentsIndex } from '../design-document-persistence'
import { migrateRegistryToDoc, readDesignThreadRegistry, saveDesignThreadRegistry } from '../design-thread-registry'
import { hydrateDesignChatMetaForDoc } from '../design-chat-transcript'
import { normalizeDesignTarget } from '../design-context'
import { createDesignDocumentId, defaultDesignArtifactNode } from '../design-types'
import type { DesignArtifact, DesignCanvasView, DesignDocument, DesignViewport } from '../design-types'
import type { DesignWorkspaceState } from '../design-workspace-store-types'
import {
  wasDesignArtifactRemoved,
  wasDesignDocumentRemoved,
  wasDesignDocumentUserCreated
} from '../design-workspace-registry'
import {
  deleteDesignWorkspaceEntry,
  writeDesignWorkspaceFile
} from '../design-persistence-coordinator'

const DESIGN_DIR = '.kun-design'

export const CANVAS_VIEW_KEY = 'kun.design.canvasView.v1'
export const VIEWPORT_KEY = 'kun.design.viewport.v1'
export const AI_RAIL_COLLAPSED_KEY = 'kun.design.aiRailCollapsed.v1'
export const CANVAS_ASSISTANT_OPEN_KEY = 'kun.design.canvasAssistantOpen.v1'
export const CANVAS_INSPECTOR_PINNED_KEY = 'kun.design.canvasInspectorPinned.v1'
export const ASSISTANT_MODEL_KEY = 'kun.design.assistantModel.v1'
export const ASSISTANT_PROVIDER_KEY = 'kun.design.assistantProvider.v1'
export const MULTI_PAGE_MODE_KEY = 'kun.design.multiPageMode.v1'
export const DESIGN_TARGET_KEY = 'kun.design.target.v1'

export function builtinDesignWorkspaceRoot(): string {
  const homeDir = typeof window !== 'undefined' ? (window.kunGui?.homeDir ?? '') : ''
  return homeDir ? `${homeDir}/.kun/design-workspace` : ''
}

export function defaultDocumentTitle(): string {
  const label = i18n.t('common:designDefaultDocTitle')
  return label && label !== 'designDefaultDocTitle' ? label : 'My design'
}

// --- Active-document projection ------------------------------------------------

/** Recompute the flat `artifacts`/`activeArtifactId` projection from the active 设计稿. */
export function projectActiveDoc(
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
export function applyToActiveDoc(
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

async function inferMissingSvgNode(
  artifact: DesignArtifact,
  workspaceRoot: string,
  api: NonNullable<typeof window.kunGui>
): Promise<DesignArtifact> {
  if (artifact.kind !== 'svg' || artifact.node) return artifact
  const svgRead = await api.readWorkspaceFile({ path: artifact.relativePath, workspaceRoot }).catch(() => null)
  return svgRead?.ok && !svgRead.truncated
    ? { ...artifact, node: inferSvgArtifactNode(svgRead.content) }
    : artifact
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
    const parsed = parseArtifactMeta(metaRead.content, artifactId, artifactDir)
    if (parsed) return inferMissingSvgNode(parsed, workspaceRoot, api)
  }
  const sub = await api.listWorkspaceDirectory({ path: artifactDir, workspaceRoot }).catch(() => null)
  if (sub && sub.ok) {
    const reconstructed = reconstructArtifact(artifactDir, sub.entries)
    if (reconstructed?.kind !== 'svg') return reconstructed
    const svgRead = await api.readWorkspaceFile({
      path: reconstructed.relativePath,
      workspaceRoot
    }).catch(() => null)
    return svgRead?.ok && !svgRead.truncated
      ? { ...reconstructed, node: inferSvgArtifactNode(svgRead.content) }
      : reconstructed
  }
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
    if (entry.type !== 'directory' || wasDesignArtifactRemoved(workspaceRoot, entry.name)) continue
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
      const write = await writeDesignWorkspaceFile({
        path: `${newPrefix}${file.name}`,
        workspaceRoot,
        content: read.content
      }, api)
      if (!write || !write.ok) throw new Error('write failed')
    }
    const rewritten = rewriteArtifactPaths(artifact, oldPrefix, newPrefix)
    const metaWrite = await writeDesignWorkspaceFile({
      path: `${newPrefix}meta.json`,
      workspaceRoot,
      content: serializeArtifactMeta(rewritten)
    }, api)
    if (!metaWrite.ok) throw new Error('meta write failed')
    if (typeof api.deleteWorkspaceEntry === 'function') {
      const deleted = await deleteDesignWorkspaceEntry({
        path: `${DESIGN_DIR}/${artifact.id}`,
        workspaceRoot
      }, api)
      if (!deleted.ok) throw new Error('delete failed')
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
    if (wasDesignArtifactRemoved(workspaceRoot, entry.name)) continue
    const dir = `${DESIGN_DIR}/${entry.name}`
    const sub = await api.listWorkspaceDirectory({ path: dir, workspaceRoot }).catch(() => null)
    if (!sub || !sub.ok) continue
    let artifact: DesignArtifact | null = null
    const metaRead = await api.readWorkspaceFile({ path: `${dir}/meta.json`, workspaceRoot }).catch(() => null)
    if (metaRead && metaRead.ok) {
      const parsed = parseArtifactMeta(metaRead.content, entry.name, dir)
      artifact = parsed ? await inferMissingSvgNode(parsed, workspaceRoot, api) : null
    }
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

export function readPersistedCanvasView(): DesignCanvasView {
  return readBrowserStorageItem(CANVAS_VIEW_KEY) === 'code' ? 'code' : 'preview'
}

export function readPersistedViewport(): DesignViewport {
  const value = readBrowserStorageItem(VIEWPORT_KEY)
  return value === 'mobile' || value === 'tablet' ? value : 'desktop'
}

export function readPersistedDesignTarget(): ReturnType<typeof normalizeDesignTarget> {
  return normalizeDesignTarget(readBrowserStorageItem(DESIGN_TARGET_KEY))
}

export function readPersistedAiRailCollapsed(): boolean {
  return readBrowserStorageItem(AI_RAIL_COLLAPSED_KEY) === '1'
}

export function readPersistedCanvasAssistantOpen(): boolean {
  const value = readBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY)
  if (value === '1') return true
  if (value === '0') return false
  return true
}

export function readPersistedCanvasInspectorPinned(): boolean {
  return readBrowserStorageItem(CANVAS_INSPECTOR_PINNED_KEY) === '1'
}

export function readPersistedAssistantModel(): string {
  return readBrowserStorageItem(ASSISTANT_MODEL_KEY)?.trim() ?? ''
}

export function readPersistedAssistantProvider(): string {
  return readBrowserStorageItem(ASSISTANT_PROVIDER_KEY)?.trim() ?? ''
}

export function readPersistedMultiPageMode(): boolean {
  return readBrowserStorageItem(MULTI_PAGE_MODE_KEY) === '1'
}

type StoreSet = (
  partial:
    | Partial<DesignWorkspaceState>
    | ((state: DesignWorkspaceState) => Partial<DesignWorkspaceState>)
) => void

type RehydrateDesignWorkspaceArtifactsOptions = {
  get: () => DesignWorkspaceState
  set: StoreSet
  persistIndex: () => void
  isCurrent?: (workspaceRoot: string) => boolean
}

export async function rehydrateDesignWorkspaceArtifacts({
  get,
  set,
  persistIndex,
  isCurrent
}: RehydrateDesignWorkspaceArtifactsOptions): Promise<void> {
  const { workspaceRoot } = get()
  const hydrationIsCurrent = (): boolean =>
    (isCurrent ? isCurrent(workspaceRoot) : get().workspaceRoot === workspaceRoot)
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
  if (!hydrationIsCurrent()) return
  const index = indexRead && indexRead.ok ? parseDocumentsIndex(indexRead.content) : null
  const listing = await api.listWorkspaceDirectory({ path: DESIGN_DIR, workspaceRoot }).catch(() => null)
  if (!hydrationIsCurrent()) return
  if (!listing || !listing.ok) return
  const topDirs = listing.entries.filter((e) => e.type === 'directory')
  
  if (index) {
    const docIds = new Set(index.documents.map((d) => d.id))
    const loaded: DesignDocument[] = []
    for (const entry of index.documents) {
      if (!hydrationIsCurrent()) return
      if (wasDesignDocumentRemoved(workspaceRoot, entry.id)) continue
      const artifacts = await loadArtifactsForDoc(workspaceRoot, entry.id)
      if (!hydrationIsCurrent()) return
      const activeArtifactId = artifacts.some((a) => a.id === entry.activeArtifactId)
        ? entry.activeArtifactId
        : artifacts[0]?.id ?? null
      loaded.push({
        id: entry.id,
        title: entry.title,
        ...(entry.titleOrigin ? { titleOrigin: entry.titleOrigin } : {}),
        order: entry.order,
        folderId: entry.folderId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        artifacts,
        activeArtifactId,
        ...(entry.engine ? { engine: entry.engine } : {})
      })
    }
    await Promise.all(
      loaded.map((doc) => hydrateDesignChatMetaForDoc({ workspaceRoot, docId: doc.id }))
    )
    if (!hydrationIsCurrent()) return
    // Adopt orphan top-level artifact dirs (hand-authored / migration fallback).
    const orphans: DesignArtifact[] = []
    for (const entry of topDirs) {
      if (!hydrationIsCurrent()) return
      if (docIds.has(entry.name) || wasDesignArtifactRemoved(workspaceRoot, entry.name)) continue
      const artifact = await loadArtifactDir(workspaceRoot, `${DESIGN_DIR}/${entry.name}`, entry.name)
      if (!hydrationIsCurrent()) return
      if (artifact) orphans.push(artifact)
    }
    set((state) => {
      if (!hydrationIsCurrent()) return {}
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
        return {
          documents,
          workspaceFolders: index.folders,
          activeDocumentId,
          ...projectActiveDoc(documents, activeDocumentId)
        }
      }
      // Merge with disk truth. Drop only the single empty stub 设计稿 that an
      // eager pre-rehydrate board-ensure may have auto-created. User-created
      // empty 设计稿 are real projects and must survive a stale index read.
      const loadedById = new Map(loaded.map((d) => [d.id, d]))
      const kept = state.documents
        .filter((doc) => {
          if (doc.artifacts.length > 0 || loadedById.has(doc.id) || wasDesignDocumentUserCreated(workspaceRoot, doc.id)) {
            return true
          }
          return !(state.documents.length === 1 && loaded.length > 0)
        })
        .map((doc) => {
          const incoming = loadedById.get(doc.id)
          if (!incoming) return doc
          const known = new Set(doc.artifacts.map((a) => a.id))
          const fresh = incoming.artifacts.filter((a) => !known.has(a.id) && !wasDesignArtifactRemoved(workspaceRoot, a.id))
          return fresh.length > 0 ? { ...doc, artifacts: sortArtifacts([...doc.artifacts, ...fresh]) } : doc
        })
      const keptIds = new Set(kept.map((d) => d.id))
      const documents = [...kept, ...loaded.filter((l) => !keptIds.has(l.id))]
      const activeDocumentId = documents.some((d) => d.id === state.activeDocumentId)
        ? state.activeDocumentId
        : documents.some((d) => d.id === index.activeDocumentId)
          ? index.activeDocumentId
          : documents[0]?.id ?? null
      return {
        documents,
        workspaceFolders: index.folders,
        activeDocumentId,
        ...projectActiveDoc(documents, activeDocumentId)
      }
    })
    if (!hydrationIsCurrent()) return
    persistIndex()
    return
  }
  
  // No index → legacy upgrade (or fresh workspace).
  const defaultDoc = await migrateLegacyToDefaultDoc(workspaceRoot, topDirs)
  if (!hydrationIsCurrent()) return
  if (!defaultDoc) return
  saveDesignThreadRegistry(migrateRegistryToDoc(readDesignThreadRegistry(), workspaceRoot, defaultDoc.id))
  set((state) => {
    if (!hydrationIsCurrent()) return {}
    if (state.documents.some((d) => d.id === defaultDoc.id)) return {}
    // Drop empty stub 设计稿 from an eager pre-rehydrate auto-create; the
    // migrated 设计稿 is authoritative for legacy data.
    const withContent = state.documents.filter((d) => d.artifacts.length > 0 || wasDesignDocumentUserCreated(workspaceRoot, d.id))
    const documents = [...withContent, defaultDoc]
    const activeDocumentId = documents.some((d) => d.id === state.activeDocumentId)
      ? state.activeDocumentId
      : defaultDoc.id
    return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId) }
  })
  if (!hydrationIsCurrent()) return
  persistIndex()
}
