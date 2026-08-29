import {
  artifactDesignMdPath,
  artifactDirPath
} from './design-artifact-persistence'
import { defaultDesignArtifactNode, createDesignArtifactId } from './design-types'
import { writeDesignWorkspaceFile } from './design-persistence-coordinator'
import { normalizeDesignWorkspaceRoot } from './design-workspace-lifecycle'
import { useDesignWorkspaceStore } from './design-workspace-store'

export type ConversationHtmlCanvasImportSource = {
  status: string
  title: string
  relativePath: string
  viewport: { width: number; height: number }
}

export type ConversationHtmlCanvasImportResult = {
  artifactId: string
  relativePath: string
  documentId: string
  /** True when this source HTML was imported previously and only re-activated. */
  reused: boolean
}

type ConversationHtmlCanvasImportOptions = {
  workspaceRoot: string
  source: ConversationHtmlCanvasImportSource
  allowedPath: RegExp
}

const MIN_HTML_WIDTH = 280
const MAX_HTML_WIDTH = 1_200
const MIN_HTML_HEIGHT = 240
const MAX_HTML_HEIGHT = 900

export function safeConversationHtmlPath(path: string, allowedPath: RegExp): string | null {
  const normalized = path.trim().replaceAll('\\', '/')
  if (normalized.split('/').includes('..') || !allowedPath.test(normalized)) return null
  return normalized
}

function sameWorkspaceRoot(left: string, right: string): boolean {
  return normalizeDesignWorkspaceRoot(left) === normalizeDesignWorkspaceRoot(right)
}

function clampViewport(source: ConversationHtmlCanvasImportSource): { width: number; height: number } {
  return {
    width: Math.min(MAX_HTML_WIDTH, Math.max(MIN_HTML_WIDTH, Math.round(source.viewport.width))),
    height: Math.min(MAX_HTML_HEIGHT, Math.max(MIN_HTML_HEIGHT, Math.round(source.viewport.height)))
  }
}

function ensurePersistentDocument(): string {
  const state = useDesignWorkspaceStore.getState()
  if (state.activeDocumentId && state.documents.some((document) => document.id === state.activeDocumentId)) {
    return state.activeDocumentId
  }
  if (state.documents.length > 0) {
    const documentId = state.documents[0].id
    state.switchActiveDocument(documentId)
    return documentId
  }
  return state.createDocument()
}

/** Imports authorized conversation HTML as a durable Design artifact. */
export async function importConversationHtmlToDesignCanvas(
  options: ConversationHtmlCanvasImportOptions
): Promise<ConversationHtmlCanvasImportResult | null> {
  const workspaceRoot = options.workspaceRoot.trim()
  const sourcePath = safeConversationHtmlPath(options.source.relativePath, options.allowedPath)
  if (!workspaceRoot || !sourcePath || options.source.status !== 'completed') return null
  if (typeof window.kunGui?.readWorkspaceFile !== 'function') return null

  // Read before changing the active Design workspace. Missing or unauthorized
  // conversation output must not create documents or switch workspace state.
  const read = await window.kunGui
    .readWorkspaceFile({ path: sourcePath, workspaceRoot })
    .catch(() => null)
  if (!read?.ok || !read.content) return null

  const store = useDesignWorkspaceStore.getState()
  if (!sameWorkspaceRoot(store.workspaceRoot, workspaceRoot)) {
    store.setWorkspaceRoot(workspaceRoot)
    useDesignWorkspaceStore.setState({ settingsLoaded: false })
  }
  try {
    await useDesignWorkspaceStore.getState().loadDesignSettings()
  } catch {
    // Explicit workspace root remains authoritative when settings are unavailable.
  }
  const afterSettings = useDesignWorkspaceStore.getState()
  if (!sameWorkspaceRoot(afterSettings.workspaceRoot, workspaceRoot)) afterSettings.setWorkspaceRoot(workspaceRoot)
  await useDesignWorkspaceStore.getState().rehydrateArtifacts().catch(() => undefined)

  const hydrated = useDesignWorkspaceStore.getState()
  for (const document of hydrated.documents) {
    const existing = document.artifacts.find((artifact) => artifact.importedFromPath === sourcePath)
    if (!existing) continue
    if (document.id !== hydrated.activeDocumentId) hydrated.switchActiveDocument(document.id)
    useDesignWorkspaceStore.getState().setActiveArtifact(existing.id)
    return {
      artifactId: existing.id,
      relativePath: existing.relativePath,
      documentId: document.id,
      reused: true
    }
  }

  const documentId = ensurePersistentDocument()
  const artifactId = createDesignArtifactId()
  const relativePath = `${artifactDirPath(documentId, artifactId)}/v1.html`
  const designMdPath = artifactDesignMdPath(documentId, artifactId)
  const write = await writeDesignWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
  if (!write.ok) return null

  const createdAt = new Date().toISOString()
  const size = clampViewport(options.source)
  const index = useDesignWorkspaceStore.getState().artifacts.length
  useDesignWorkspaceStore.getState().upsertArtifact({
    id: artifactId,
    kind: 'html',
    title: options.source.title,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: '' }],
    designMdPath,
    previewStatus: 'pending',
    node: {
      ...defaultDesignArtifactNode(index),
      ...size,
      sizeMode: 'manual',
      viewMode: 'preview'
    },
    importedFromPath: sourcePath
  })
  useDesignWorkspaceStore.getState().setActiveArtifact(artifactId)
  return { artifactId, relativePath, documentId, reused: false }
}
