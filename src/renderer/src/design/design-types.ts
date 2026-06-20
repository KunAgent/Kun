/** Artifact kind. `'canvas'` = Figma-style SVG design canvas. */
export type DesignArtifactKind = 'html' | 'canvas'

/** Canvas surface for HTML artifacts. `'live'` shows the running dev server. */
export type DesignCanvasView = 'preview' | 'code' | 'live'

export type DesignViewport = 'mobile' | 'tablet' | 'desktop'

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

export type DesignArtifact = {
  id: string
  kind: DesignArtifactKind
  title: string
  /** Workspace-relative path to the current (latest) single-file document. */
  relativePath: string
  createdAt: string
  updatedAt: string
  versions: DesignArtifactVersion[]
  /** ISO time the design was handed to code; absent = not implemented yet. */
  implementedAt?: string
  /** Code thread that implemented it (provenance). */
  implementedThreadId?: string
  /** Hash of the DESIGN_SYSTEM.md published at implement time (code-drift baseline). */
  implementedDesignSystemHash?: string
}

/** Short, collision-resistant id for a design artifact directory. */
export function createDesignArtifactId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}
