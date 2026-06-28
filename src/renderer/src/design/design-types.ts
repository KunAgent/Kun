/** Artifact kind. `'canvas'` = Figma-style SVG design canvas. */
export type DesignArtifactKind = 'html' | 'canvas'

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

export type DesignArtifactNode = {
  x: number
  y: number
  width: number
  height: number
  sizeMode?: 'auto' | 'manual'
  favorite?: boolean
  viewMode?: DesignCanvasView
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
  /** Per-artifact design notes that travel with the HTML screen. */
  designMdPath?: string
  /** Renderer-side preview lifecycle state; persisted for restart recovery. */
  previewStatus?: 'pending' | 'ready' | 'error'
  /** Optional Stitch-style project-canvas placement metadata. */
  node?: DesignArtifactNode
  /** ISO time the design was handed to code; absent = not implemented yet. */
  implementedAt?: string
  /** Code thread that implemented it (provenance). */
  implementedThreadId?: string
  /** Hash of the DESIGN_SYSTEM.md published at implement time (code-drift baseline). */
  implementedDesignSystemHash?: string
  /**
   * Foundation role in a Stitch-style run: the shared visual style guide or the
   * brand logo. Absent for normal pages. Lets the run reuse them on re-runs and
   * label them in the sibling manifest.
   */
  role?: 'design-system' | 'logo'
}

/**
 * A 设计稿 (design document) — the top-level container, one per directory under
 * `.kun-design/<id>/`. Holds multiple 画布 (canvas artifacts: HTML or SVG) and
 * owns its own project-canvas surface + AI conversation. The store keeps the
 * flat `artifacts`/`activeArtifactId` as a projection of the active document.
 */
export type DesignDocument = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Sidebar ordering (ascending); ties broken by createdAt. */
  order: number
  /** The 画布 in this 设计稿 (newest first, matching the flat list convention). */
  artifacts: DesignArtifact[]
  /** Last-active 画布 within this 设计稿; null when empty. */
  activeArtifactId: string | null
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
