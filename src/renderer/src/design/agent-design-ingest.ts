import type { DesignOpenRequestMetadata } from '../agent/design-open-request'
import { artifactDesignMdPath } from './design-artifact-persistence'
import type { DesignArtifact } from './design-types'
import { normalizeDesignWorkspaceRoot } from './design-workspace-lifecycle'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { useCodeCanvasDesignSurface } from './code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../lib/code-canvas-panel-event'

const SCREEN_GAP = 160

/** Where the next new screen goes: one row, to the right of the document's existing screens. */
export function nextAgentScreenX(artifacts: readonly DesignArtifact[]): number {
  let right = Number.NEGATIVE_INFINITY
  for (const artifact of artifacts) {
    if (artifact.kind !== 'html' || !artifact.node) continue
    right = Math.max(right, artifact.node.x + artifact.node.width)
  }
  return Number.isFinite(right) ? right + SCREEN_GAP : 0
}

/** New and refreshed screens for a `design_open` result, keeping existing board positions. */
export function agentDesignArtifacts(
  request: DesignOpenRequestMetadata,
  existing: readonly DesignArtifact[],
  now: string
): DesignArtifact[] {
  if (request.status !== 'ready' || !request.documentId) return []
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]))
  let x = nextAgentScreenX(existing)
  return request.screens.map((screen) => {
    const current = byId.get(screen.artifactId)
    if (current) return { ...current, title: screen.name, updatedAt: now }
    const node = { x, y: 0, width: screen.width, height: screen.height, sizeMode: 'manual-width-auto-height' as const, viewMode: 'preview' as const }
    x += screen.width + SCREEN_GAP
    return {
      id: screen.artifactId,
      kind: 'html' as const,
      title: screen.name,
      relativePath: screen.relativePath,
      createdAt: now,
      updatedAt: now,
      versions: [{ id: `${screen.artifactId}-v1`, relativePath: screen.relativePath, createdAt: now, summary: '' }],
      designMdPath: artifactDesignMdPath(request.documentId!, screen.artifactId),
      previewStatus: 'pending' as const,
      node
    }
  })
}

/**
 * Registers the screens a Code agent wrote with `design_open` as a Design
 * document (adopting Kun's folder id) and makes it active. Safe to repeat:
 * known screens only refresh their title and timestamp.
 */
export async function ingestAgentDesign(options: {
  workspaceRoot: string
  request: DesignOpenRequestMetadata
}): Promise<string | null> {
  const { request } = options
  const workspaceRoot = options.workspaceRoot.trim()
  const documentId = request.documentId
  if (!workspaceRoot || request.status !== 'ready' || !documentId || request.screens.length === 0) return null

  const store = useDesignWorkspaceStore.getState()
  if (normalizeDesignWorkspaceRoot(store.workspaceRoot) !== normalizeDesignWorkspaceRoot(workspaceRoot)) {
    store.setWorkspaceRoot(workspaceRoot)
    useDesignWorkspaceStore.setState({ settingsLoaded: false })
  }
  if (!useDesignWorkspaceStore.getState().settingsLoaded) {
    await useDesignWorkspaceStore.getState().loadDesignSettings().catch(() => undefined)
  }

  const hydrated = useDesignWorkspaceStore.getState()
  const document = hydrated.documents.find((candidate) => candidate.id === documentId)
  if (!document) {
    hydrated.createDocument(request.title, { id: documentId, titleOrigin: 'generated' })
  } else if (hydrated.activeDocumentId !== documentId) {
    hydrated.switchActiveDocument(documentId)
  }
  const active = useDesignWorkspaceStore.getState()
  if (active.activeDocumentId !== documentId) return null
  const artifacts = agentDesignArtifacts(request, active.artifacts, new Date().toISOString())
  for (const artifact of artifacts) useDesignWorkspaceStore.getState().upsertArtifact(artifact)
  if (artifacts[0]) useDesignWorkspaceStore.getState().setActiveArtifact(artifacts[0].id)
  return documentId
}

/** Registers the screens (when needed) and shows their canvas beside the conversation. */
export async function openAgentDesignCanvas(options: {
  threadId: string
  workspaceRoot: string
  request: DesignOpenRequestMetadata
}): Promise<boolean> {
  const documentId = await ingestAgentDesign(options)
  if (!documentId) return false
  useCodeCanvasDesignSurface.getState().showDesignDocument(options.threadId, options.workspaceRoot, documentId)
  requestCodeCanvasPanelOpen()
  return true
}
