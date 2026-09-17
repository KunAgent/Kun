/** Artifact kind. `'canvas'` is the ShapeOps JSON board; `'svg'` is a real SVG document. */
import { normalizeCanvasEngine, type CanvasEngine } from '../whiteboard/canvas-engine'

export type DesignArtifactKind = 'html' | 'canvas' | 'svg'

export function isFileDesignArtifactKind(
  kind: DesignArtifactKind
): kind is 'html' | 'svg' {
  return kind === 'html' || kind === 'svg'
}

/** Canvas surface for HTML artifacts. `'live'` shows the running dev server. */
export type DesignCanvasView = 'preview' | 'code' | 'live'

export type DesignViewport = 'mobile' | 'tablet' | 'desktop'

export type DesignIntentMode = 'generate' | 'modify' | 'preview'

/** Pixel width applied to the canvas wrapper per viewport; null = full width. */
export const DESIGN_VIEWPORT_WIDTHS: Record<DesignViewport, number | null> = {
  mobile: 390,
  tablet: 768,
  desktop: null
}

export type DesignArtifactVersion = {
  id: string
  /** Workspace-relative path to this version's snapshot document. */
  relativePath: string
  createdAt: string
  /** The agent's one-paragraph summary of what this turn produced. */
  summary: string
}

export function designArtifactVersionNumber(version: Pick<DesignArtifactVersion, 'id' | 'relativePath'>): number | null {
  const pathMatch = /\/v(\d+)\.(?:html?|svg)$/i.exec(version.relativePath)
  if (pathMatch) return Number(pathMatch[1])
  const idMatch = /-v(\d+)$/i.exec(version.id)
  return idMatch ? Number(idMatch[1]) : null
}

export function designArtifactVersionLabel(
  version: Pick<DesignArtifactVersion, 'id' | 'relativePath'> | undefined,
  fallbackNumber: number
): string {
  return `v${version ? (designArtifactVersionNumber(version) ?? fallbackNumber) : fallbackNumber}`
}

export type DesignArtifactNode = {
  x: number
  y: number
  width: number
  height: number
  /**
   * auto: width/height can follow generated content/default target sizing.
   * manual: user locked both width and height.
   * manual-width-auto-height: user locked width, height follows rendered HTML.
   */
  sizeMode?: 'auto' | 'manual' | 'manual-width-auto-height'
  favorite?: boolean
  /** Hidden from the board after the user deletes its linked frame. */
  boardHidden?: boolean
  /**
   * Per-HTML-version tombstones for linked frames the user deleted from the
   * board. Keeps a deleted historical version frame from being recreated on
   * sync/reload while newer versions still get their own frames. Legacy
   * artifact-level `boardHidden` continues to cover the current version only.
   */
  boardHiddenVersionIds?: string[]
  viewMode?: DesignCanvasView
}

export type DesignPrototypeLink = {
  /** Planned target screen title from the multi-page planner. */
  targetTitle: string
  /** Resolved artifact id when the target already exists on the board. */
  targetArtifactId?: string
  /** Local href that generated HTML should use for this transition. */
  href?: string
  /** Human-facing action label, often the page's primary action. */
  label?: string
}

export type DesignDirectionStatus = 'active' | 'accepted' | 'archived'

export type DesignDirection = {
  /** Stable id for a named exploration branch/direction. */
  id: string
  /** Human-facing direction name, e.g. "Checkout revamp". */
  name: string
  /** Direction lifecycle for future compare/accept/archive flows. */
  status?: DesignDirectionStatus
  createdAt?: string
}

export type DesignArtifact = {
  id: string
  kind: DesignArtifactKind
  title: string
  /** Workspace-relative path to the current (latest) single-file document. */
  relativePath: string
  createdAt: string
  updatedAt: string
  versions: DesignArtifactVersion[]
  /** Per-artifact design notes that travel with HTML and SVG documents. */
  designMdPath?: string
  /** Renderer-side preview lifecycle state; persisted for restart recovery. */
  previewStatus?: 'pending' | 'ready' | 'error'
  /** Optional Stitch-style project-canvas placement metadata. */
  node?: DesignArtifactNode
  /** Outgoing prototype-flow transitions to other HTML screen artifacts. */
  prototypeLinks?: DesignPrototypeLink[]
  /** Stitch-style named exploration branch this artifact belongs to. */
  direction?: DesignDirection
  /** ISO time the design was handed to code; absent = not implemented yet. */
  implementedAt?: string
  /** Code thread that implemented it (provenance). */
  implementedThreadId?: string
  /** Hash of design-system.json at implement time (code-drift baseline). */
  implementedDesignSystemHash?: string
  /**
   * Workspace-relative source of a conversation component prototype that this
   * artifact was imported from (`.kun-design/component-prototypes/<id>/prototype.html`).
   * Lets "open in canvas" reuse the same artifact instead of duplicating it.
   */
  importedFromPath?: string
  /**
   * Foundation role in a Stitch-style run: the shared visual style guide or the
   * brand logo. Absent for normal pages. Lets the run reuse them on re-runs and
   * label them in the sibling manifest.
   */
  role?: 'design-system' | 'logo'
}

/** A logical Design-sidebar directory. It does not alter on-disk artifact paths. */
export type DesignWorkspaceFolder = {
  id: string
  name: string
  parentId: string | null
}

export function currentDesignArtifactVersion(
  artifact: Pick<DesignArtifact, 'relativePath' | 'versions'>
): DesignArtifactVersion | undefined {
  return artifact.versions.find((version) => version.relativePath === artifact.relativePath) ?? artifact.versions[0]
}

export type DesignArtifactFoundationRole = NonNullable<DesignArtifact['role']>

export function inferDesignArtifactFoundationRole(
  artifact: Pick<DesignArtifact, 'role' | 'title'>
): DesignArtifactFoundationRole | undefined {
  if (artifact.role === 'design-system' || artifact.role === 'logo') return artifact.role
  const normalizedTitle = artifact.title.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalizedTitle) return undefined
  if (
    normalizedTitle.includes('designsystem') ||
    normalizedTitle.includes('stylesystem') ||
    normalizedTitle.includes('设计系统')
  ) {
    return 'design-system'
  }
  if (
    normalizedTitle === 'logo' ||
    normalizedTitle.includes('brandlogo') ||
    normalizedTitle.includes('标志') ||
    normalizedTitle.includes('徽标')
  ) {
    return 'logo'
  }
  return undefined
}

/**
 * A 设计稿 (design document) — the top-level container, one per directory under
 * `.kun-design/<id>/`. Holds HTML, SVG, and ShapeOps canvas artifacts and
 * owns its own project-canvas surface + AI conversation. The store keeps the
 * flat `artifacts`/`activeArtifactId` as a projection of the active document.
 */
export type DesignDocument = {
  id: string
  title: string
  /** How the visible title was chosen. Missing means a legacy document. */
  titleOrigin?: 'generated' | 'user'
  createdAt: string
  updatedAt: string
  /** Sidebar ordering (ascending); ties broken by createdAt. */
  order: number
  /** Logical Design-sidebar folder; null/absent means the workspace root. */
  folderId?: string | null
  /** The 画布 in this 设计稿 (newest first, matching the flat list convention). */
  artifacts: DesignArtifact[]
  /** Last-active 画布 within this 设计稿; null when empty. */
  activeArtifactId: string | null
  /** Renderer for this drawing. Missing means the legacy Kun canvas. */
  engine?: CanvasEngine
}

export const DESIGN_ARTIFACT_NODE_DEFAULT_WIDTH = 420
export const DESIGN_ARTIFACT_NODE_DEFAULT_HEIGHT = 340

export function defaultDesignArtifactNode(index: number): DesignArtifactNode {
  const safeIndex = Math.max(0, index)
  const col = safeIndex % 3
  const row = Math.floor(safeIndex / 3)
  return {
    x: 160 + col * 500,
    y: 150 + row * 430,
    width: DESIGN_ARTIFACT_NODE_DEFAULT_WIDTH,
    height: DESIGN_ARTIFACT_NODE_DEFAULT_HEIGHT,
    sizeMode: 'auto',
    viewMode: 'preview'
  }
}

/** Short, collision-resistant id for a design artifact directory. */
export function createDesignArtifactId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

/** Short, collision-resistant id for a 设计稿 (design document) directory. */
export function createDesignDocumentId(): string {
  return createDesignArtifactId()
}

export function designDocumentResolvedEngine(
  document: Pick<DesignDocument, 'engine' | 'artifacts'>
): CanvasEngine {
  if (document.artifacts.some((artifact) => artifact.kind === 'html' || artifact.kind === 'svg')) {
    return 'kun'
  }
  return normalizeCanvasEngine(document.engine)
}
