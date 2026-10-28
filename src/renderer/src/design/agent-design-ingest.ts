import type { DesignOpenRequestMetadata } from '../agent/design-open-request'
import { artifactDesignMdPath } from './design-artifact-persistence'
import type { DesignArtifact } from './design-types'
import { normalizeDesignWorkspaceRoot } from './design-workspace-lifecycle'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { useCodeCanvasDesignSurface } from './code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../lib/code-canvas-panel-event'

const SCREEN_GAP = 160
/** Space between section rows: room for the section label and boards that grow after they render. */
const SECTION_GAP = 400

type SectionRow = { y: number; right: number }

function sectionKey(section: string | undefined): string {
  return section?.trim().toLowerCase().replace(/\s+/gu, ' ') ?? ''
}

/**
 * Board placement for an agent-built design: every section is one row, rows
 * stack downward in the order sections first appear, and new boards of a
 * known section continue its row. Boards without a section share one row.
 */
export class AgentBoardLayout {
  private readonly rows = new Map<string, SectionRow>()
  private left = 0
  private bottom = Number.NEGATIVE_INFINITY

  constructor(artifacts: readonly DesignArtifact[]) {
    let left = Number.POSITIVE_INFINITY
    for (const artifact of artifacts) {
      if (artifact.kind !== 'html' || !artifact.node) continue
      const { x, y, width, height } = artifact.node
      left = Math.min(left, x)
      this.bottom = Math.max(this.bottom, y + height)
      const key = sectionKey(artifact.boardSection)
      const row = this.rows.get(key)
      if (row) this.rows.set(key, { y: Math.min(row.y, y), right: Math.max(row.right, x + width) })
      else this.rows.set(key, { y, right: x + width })
    }
    if (Number.isFinite(left)) this.left = left
  }

  place(section: string | undefined, width: number, height: number): { x: number; y: number } {
    const key = sectionKey(section)
    const row = this.rows.get(key)
    const slot = row
      ? { x: row.right + SCREEN_GAP, y: row.y }
      : { x: this.left, y: Number.isFinite(this.bottom) ? this.bottom + SECTION_GAP : 0 }
    this.rows.set(key, { y: slot.y, right: slot.x + width })
    this.bottom = Math.max(this.bottom, slot.y + height)
    return slot
  }
}

/** New and refreshed screens for a `design_open` result, keeping existing board positions. */
export function agentDesignArtifacts(
  request: DesignOpenRequestMetadata,
  existing: readonly DesignArtifact[],
  now: string
): DesignArtifact[] {
  if (request.status !== 'ready' || !request.documentId) return []
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]))
  const layout = new AgentBoardLayout(existing)
  return request.screens.map((screen) => {
    const current = byId.get(screen.artifactId)
    const section = screen.section ? { boardSection: screen.section } : {}
    if (current) return { ...current, title: screen.name, updatedAt: now, ...section }
    const { x, y } = layout.place(screen.section, screen.width, screen.height)
    const node = { x, y, width: screen.width, height: screen.height, sizeMode: 'manual-width-auto-height' as const, viewMode: 'preview' as const }
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
      node,
      ...section
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
