/**
 * Durable 设计稿 (design document) index. The in-memory `documents` list is
 * mirrored to a single `.kun-design/documents.json` index that records each
 * 设计稿's metadata + ordering + the active pointers. Artifact membership is NOT
 * stored here — it is implied by directory nesting (`.kun-design/<docId>/<id>/`)
 * and recovered by scanning each 设计稿 dir on rehydrate. Presence of this file
 * also marks "the legacy → nested migration has run" (see the store).
 */
import type { DesignDocument, DesignWorkspaceFolder } from './design-types'
import {
  canvasEnginePersistField,
  normalizeCanvasEngine,
  type CanvasEngine
} from '../whiteboard/canvas-engine'
import { normalizeDesignWorkspaceFolders } from './design-workspace-folders'
import {
  deleteDesignWorkspaceEntry,
  flushDesignPersistenceQueue,
  normalizeDesignPersistenceWorkspaceRoot,
  writeDesignWorkspaceFile
} from './design-persistence-coordinator'

const DESIGN_DIR = '.kun-design'

export function documentsIndexPath(): string {
  return `${DESIGN_DIR}/documents.json`
}

export function documentDirPath(docId: string): string {
  return `${DESIGN_DIR}/${docId}`
}

const pendingDocumentDirCreations = new Map<string, Promise<void>>()

function documentDirOperationKey(workspaceRoot: string, docId: string): string {
  return `${normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)}\0${docId.trim()}`
}

/** Best-effort creation of the physical `.kun-design/<docId>/` directory. */
export function ensureDocumentDir(workspaceRoot: string, docId: string): Promise<void> {
  if (!workspaceRoot || !docId || typeof window.kunGui?.createWorkspaceDirectory !== 'function') {
    return Promise.resolve()
  }
  const key = documentDirOperationKey(workspaceRoot, docId)
  const previous = pendingDocumentDirCreations.get(key)
  const task = (previous ?? Promise.resolve()).then(async () => {
    await window.kunGui.createWorkspaceDirectory({ path: DESIGN_DIR, workspaceRoot }).catch(() => null)
    await window.kunGui
      .createWorkspaceDirectory({ path: documentDirPath(docId), workspaceRoot })
      .catch(() => null)
  })
  pendingDocumentDirCreations.set(key, task)
  void task.finally(() => {
    if (pendingDocumentDirCreations.get(key) === task) pendingDocumentDirCreations.delete(key)
  }).catch(() => undefined)
  return task
}

async function flushPendingDocumentDirCreation(workspaceRoot: string, docId: string): Promise<void> {
  for (;;) {
    const pending = pendingDocumentDirCreations.get(documentDirOperationKey(workspaceRoot, docId))
    if (!pending) return
    await pending.catch(() => undefined)
  }
}

/** Persisted per-设计稿 metadata (no artifacts — those live on disk by nesting). */
export type DesignDocumentIndexEntry = {
  id: string
  title: string
  titleOrigin?: 'generated' | 'user'
  order: number
  createdAt: string
  updatedAt: string
  activeArtifactId: string | null
  folderId: string | null
  engine?: CanvasEngine
}

export type DesignDocumentsIndex = {
  version: 1 | 2
  activeDocumentId: string | null
  folders: DesignWorkspaceFolder[]
  documents: DesignDocumentIndexEntry[]
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function toIndexEntry(doc: DesignDocument): DesignDocumentIndexEntry {
  return {
    id: doc.id,
    title: doc.title,
    ...(doc.titleOrigin ? { titleOrigin: doc.titleOrigin } : {}),
    order: doc.order,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    activeArtifactId: doc.activeArtifactId,
    folderId: doc.folderId?.trim() || null,
    ...canvasEnginePersistField(doc.engine)
  }
}

export function serializeDocumentsIndex(
  documents: readonly DesignDocument[],
  activeDocumentId: string | null,
  folders: readonly DesignWorkspaceFolder[] = []
): string {
  const normalizedFolders = normalizeDesignWorkspaceFolders(folders)
  const entries = documents.map(toIndexEntry)
  // Keep an untouched root-only index in its legacy representation. This lets
  // existing workspaces upgrade lazily: the first folder or non-root move is
  // the structural change that introduces version 2.
  const index = normalizedFolders.length > 0 || entries.some((entry) => entry.folderId)
    ? {
        version: 2,
        activeDocumentId,
        folders: normalizedFolders,
        documents: entries
      }
    : {
        version: 1,
        activeDocumentId,
        documents: entries.map(({ folderId: _folderId, ...entry }) => entry)
      }
  return `${JSON.stringify(index, null, 2)}\n`
}

/** Tolerant parse of documents.json; returns null when nothing usable parses. */
export function parseDocumentsIndex(raw: string): DesignDocumentsIndex | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const source = parsed as Record<string, unknown>
  if (!Array.isArray(source.documents)) return null
  const folders = normalizeDesignWorkspaceFolders(source.folders)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const documents: DesignDocumentIndexEntry[] = []
  source.documents.forEach((value, fallbackOrder) => {
    if (!value || typeof value !== 'object') return
    const o = value as Record<string, unknown>
    if (!isStr(o.id) || !o.id) return
    const createdAt = isStr(o.createdAt) ? o.createdAt : new Date(0).toISOString()
    documents.push({
      id: o.id,
      title: isStr(o.title) ? o.title : o.id,
      ...(o.titleOrigin === 'generated' || o.titleOrigin === 'user'
        ? { titleOrigin: o.titleOrigin }
        : {}),
      order: isNum(o.order) ? o.order : fallbackOrder,
      createdAt,
      updatedAt: isStr(o.updatedAt) ? o.updatedAt : createdAt,
      activeArtifactId: isStr(o.activeArtifactId) ? o.activeArtifactId : null,
      folderId: isStr(o.folderId) && folderIds.has(o.folderId) ? o.folderId : null,
      ...canvasEnginePersistField(normalizeCanvasEngine(o.engine))
    })
  })
  const activeDocumentId =
    isStr(source.activeDocumentId) && documents.some((d) => d.id === source.activeDocumentId)
      ? source.activeDocumentId
      : documents[0]?.id ?? null
  return { version: source.version === 1 ? 1 : 2, activeDocumentId, folders, documents }
}

/** Read only the lightweight Design navigation index for a workspace. */
export async function readDesignDocumentsIndex(workspaceRoot: string): Promise<DesignDocumentsIndex> {
  const normalizedRoot = normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  if (!normalizedRoot || typeof window === 'undefined' || !window.kunGui?.readWorkspaceFile) {
    return { version: 2, activeDocumentId: null, folders: [], documents: [] }
  }
  const read = await window.kunGui.readWorkspaceFile({
    path: documentsIndexPath(),
    workspaceRoot: normalizedRoot
  }).catch(() => null)
  const parsed = read?.ok ? parseDocumentsIndex(read.content) : null
  return parsed ?? { version: 2, activeDocumentId: null, folders: [], documents: [] }
}

type PendingDocumentsIndex = {
  content: string
  timer: ReturnType<typeof setTimeout> | null
}

const pendingDocumentsIndexes = new Map<string, PendingDocumentsIndex>()

function writeDocumentsIndex(workspaceRoot: string, content: string): Promise<void> {
  return writeDesignWorkspaceFile({ path: documentsIndexPath(), workspaceRoot, content })
    .then(() => undefined)
}

function flushPendingDocumentsIndex(workspaceRoot: string): Promise<void> {
  const pending = pendingDocumentsIndexes.get(workspaceRoot)
  if (!pending) return Promise.resolve()
  if (pending.timer) clearTimeout(pending.timer)
  pendingDocumentsIndexes.delete(workspaceRoot)
  return writeDocumentsIndex(workspaceRoot, pending.content)
}

/** Fire-and-forget, debounced write of the documents index (one hot file). */
export function persistDocumentsIndex(
  workspaceRoot: string,
  documents: readonly DesignDocument[],
  activeDocumentId: string | null,
  folders: readonly DesignWorkspaceFolder[] = []
): void {
  workspaceRoot = normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  if (!workspaceRoot) return
  const content = serializeDocumentsIndex(documents, activeDocumentId, folders)
  const existing = pendingDocumentsIndexes.get(workspaceRoot)
  if (existing?.timer) clearTimeout(existing.timer)
  const pending: PendingDocumentsIndex = { content, timer: null }
  pending.timer = setTimeout(() => {
    pending.timer = null
    void flushPendingDocumentsIndex(workspaceRoot)
  }, 400)
  pendingDocumentsIndexes.set(workspaceRoot, pending)
}

/**
 * Immediate, non-debounced write of the documents index. Cancels any pending
 * debounced write so a structural change (e.g. deleting a 设计稿) lands on disk
 * right away and can't be resurrected by a reload that reads a stale index
 * before the 400ms debounce flushes.
 */
export function flushDocumentsIndex(
  workspaceRoot: string,
  documents: readonly DesignDocument[],
  activeDocumentId: string | null,
  folders: readonly DesignWorkspaceFolder[] = []
): Promise<void> {
  workspaceRoot = normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  if (!workspaceRoot) return Promise.resolve()
  const existing = pendingDocumentsIndexes.get(workspaceRoot)
  if (existing?.timer) clearTimeout(existing.timer)
  pendingDocumentsIndexes.set(workspaceRoot, {
    content: serializeDocumentsIndex(documents, activeDocumentId, folders),
    timer: null
  })
  return flushPendingDocumentsIndex(workspaceRoot)
}

export async function flushPendingDocumentsIndexes(workspaceRoot?: string): Promise<void> {
  const normalizedRoot = workspaceRoot === undefined
    ? null
    : normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  for (;;) {
    const roots = [...pendingDocumentsIndexes.keys()]
      .filter((root) => normalizedRoot === null || normalizeDesignPersistenceWorkspaceRoot(root) === normalizedRoot)
    if (roots.length === 0) return
    await Promise.all(roots.map(flushPendingDocumentsIndex))
  }
}

/**
 * Finish deleting a drawing after the renderer has already navigated to a
 * different Design workspace. The current on-disk index is re-read after all
 * pending writes drain, so an async delete can never mutate the newly active
 * workspace or overwrite newer metadata with a stale in-memory snapshot.
 */
export async function removePersistedDesignDocument(input: {
  workspaceRoot: string
  documentId: string
  fallbackDocuments: readonly DesignDocument[]
  fallbackActiveDocumentId: string | null
  fallbackFolders?: readonly DesignWorkspaceFolder[]
}): Promise<boolean> {
  const workspaceRoot = normalizeDesignPersistenceWorkspaceRoot(input.workspaceRoot)
  const documentId = input.documentId.trim()
  if (!workspaceRoot || !documentId) return false

  // A first-prompt rollback can race the fire-and-forget directory creation.
  // Drain it first so a late mkdir cannot recreate the drawing after deletion.
  await flushPendingDocumentDirCreation(workspaceRoot, documentId)
  await flushPendingDocumentsIndexes(workspaceRoot)
  await flushDesignPersistenceQueue(workspaceRoot)

  let documents = input.fallbackDocuments.slice()
  let activeDocumentId = input.fallbackActiveDocumentId
  let folders = normalizeDesignWorkspaceFolders(input.fallbackFolders ?? [])
  if (
    typeof window !== 'undefined' &&
    typeof window.kunGui?.readWorkspaceFile === 'function'
  ) {
    const read = await window.kunGui.readWorkspaceFile({
      path: documentsIndexPath(),
      workspaceRoot
    }).catch(() => null)
    const parsed = read?.ok ? parseDocumentsIndex(read.content) : null
    if (parsed) {
      documents = parsed.documents.map((entry) => ({ ...entry, artifacts: [] }))
      activeDocumentId = parsed.activeDocumentId
      folders = parsed.folders
    }
  }

  const remaining = documents.filter((document) => document.id !== documentId)
  const originalActiveDocumentId = documents.some(
    (document) => document.id === activeDocumentId
  )
    ? activeDocumentId
    : documents[0]?.id ?? null
  const nextActiveDocumentId = activeDocumentId === documentId
    ? remaining[0]?.id ?? null
    : remaining.some((document) => document.id === activeDocumentId)
      ? activeDocumentId
      : remaining[0]?.id ?? null
  const written = await writeDesignWorkspaceFile({
    path: documentsIndexPath(),
    workspaceRoot,
    content: serializeDocumentsIndex(remaining, nextActiveDocumentId, folders)
  })
  if (!written.ok) return false

  const deleted = await deleteDesignWorkspaceEntry({
    path: documentDirPath(documentId),
    workspaceRoot
  })
  if (deleted.ok) return true
  if (/(?:enoent|no such file|not found)/i.test(deleted.message)) return true

  // Keep the drawing discoverable for retry if its directory could not be
  // removed after the index write succeeded.
  await writeDesignWorkspaceFile({
    path: documentsIndexPath(),
    workspaceRoot,
    content: serializeDocumentsIndex(documents, originalActiveDocumentId, folders)
  })
  return false
}

/** Fire-and-forget delete of a 设计稿's whole on-disk dir (and all its 画布). */
export function deleteDocumentDir(workspaceRoot: string, docId: string): Promise<void> {
  if (!workspaceRoot) return Promise.resolve()
  return deleteDesignWorkspaceEntry({ path: documentDirPath(docId), workspaceRoot })
    .then(() => undefined)
}
