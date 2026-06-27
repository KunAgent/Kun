import type {
  DesignArtifact,
  DesignArtifactNode,
  DesignArtifactVersion,
  DesignCanvasView,
  DesignDocument,
  DesignIntentMode,
  DesignViewport
} from './design-types'
import type { DesignContext } from './design-context'

/** Progress of an in-flight Stitch-style multi-page generation run. */
export type DesignPagesRunState = {
  phase: 'planning' | 'generating'
  /** Total pages to generate (0 while still planning). */
  total: number
  /** Pages already generated. */
  done: number
  /** Title of the page being generated (or '' while planning). */
  title: string
}

export type DesignWorkspaceState = {
  /** Workspace root design artifacts live under; '' = none chosen yet. */
  workspaceRoot: string
  /** 设计稿 (design documents) — top-level containers, source of truth. */
  documents: DesignDocument[]
  /** Active 设计稿 id; null = none (empty workspace). */
  activeDocumentId: string | null
  /** Projection of the active 设计稿's 画布 (artifacts). Do not mutate directly. */
  artifacts: DesignArtifact[]
  /** Projection of the active 设计稿's active 画布 id. */
  activeArtifactId: string | null
  canvasView: DesignCanvasView
  viewport: DesignViewport
  /** Live dev-server URL synced from code mode; '' = none running. */
  devPreviewUrl: string
  /** Composer model used for design-agent turns; '' = inherit runtime default. */
  assistantModel: string
  assistantProviderId: string
  designContext: DesignContext
  // settings-driven runtime knobs (loaded from settings.design)
  canvasBackground: 'light' | 'dark'
  liveRefresh: boolean
  deviceFrame: boolean
  generationPrompt: string
  reasoningEffort: string
  implementStackHint: string
  injectIntoCode: boolean
  publishDesignSystem: boolean
  settingsLoaded: boolean
  fileError: string | null
  /** Hash of the current published .kun-design/DESIGN_SYSTEM.md ('' = none). */
  designSystemHash: string
  /** When true, the design page shows the in-page code-implement assistant. */
  implementOpen: boolean
  /** Title of the artifact being implemented (panel header). */
  implementTitle: string
  /** Backward-compatible persisted assistant collapsed flag. Prefer canvasAssistantOpen. */
  aiRailCollapsed: boolean
  /** User preference for the floating canvas assistant on desktop. Persisted. */
  canvasAssistantOpen: boolean
  /** User preference for keeping the floating inspector visible without a selection. Persisted. */
  canvasInspectorPinned: boolean
  /** Stitch-style design intent for the floating composer and command pill. */
  designIntentMode: DesignIntentMode
  /** When ON, a "generate" brief is decomposed into multiple cohesive pages. */
  multiPageMode: boolean
  /** Progress of an in-flight multi-page run; null = idle. */
  pagesRun: DesignPagesRunState | null

  setWorkspaceRoot: (workspaceRoot: string) => void
  setCanvasView: (view: DesignCanvasView) => void
  setViewport: (viewport: DesignViewport) => void
  setDevPreviewUrl: (url: string) => void
  setCanvasBackground: (background: 'light' | 'dark') => void
  setActiveArtifact: (artifactId: string | null) => void
  /** Create a new 设计稿 (empty), make it active, and return its id. */
  createDocument: (title?: string) => string
  /** Rename a 设计稿 (persisted to documents.json). */
  renameDocument: (documentId: string, title: string) => void
  /** Delete a 设计稿 and all its 画布 (on-disk dirs + index entry). */
  removeDocument: (documentId: string) => void
  /** Switch the active 设计稿 (re-projects artifacts; thread switch is wired by the workbench). */
  switchActiveDocument: (documentId: string) => void
  /** Return the active 设计稿 id, creating a default 设计稿 if none exists yet. */
  ensureActiveDocument: () => string
  /** Insert a new artifact (or replace one with the same id) and make it active. */
  upsertArtifact: (artifact: DesignArtifact) => void
  /** Append a new version, repointing the artifact's current document at it. */
  addArtifactVersion: (artifactId: string, version: DesignArtifactVersion) => void
  /** Stamp an artifact as handed to code (provenance + drift baseline). */
  markImplemented: (artifactId: string, threadId: string, designSystemHash?: string) => void
  removeArtifact: (artifactId: string) => void
  /** Rename an artifact's title (persisted to its meta.json sidecar). */
  renameArtifact: (artifactId: string, title: string) => void
  /** Overwrite a version's summary with the agent's actual end-of-turn description. */
  setVersionSummary: (artifactId: string, versionId: string, summary: string) => void
  updateArtifactNode: (artifactId: string, patch: Partial<DesignArtifactNode>) => void
  duplicateArtifact: (artifactId: string) => Promise<void>
  selectArtifactVersion: (artifactId: string, versionId: string) => void
  setDesignIntentMode: (mode: DesignIntentMode) => void
  setMultiPageMode: (on: boolean) => void
  /** Update or clear (null) the multi-page run progress. */
  setPagesRun: (state: DesignPagesRunState | null) => void
  /** Set or clear the design-mode error banner. */
  setFileError: (error: string | null) => void
  /** Open the in-page "implement in code" assistant for an artifact. */
  openImplementPanel: (title: string) => void
  closeImplementPanel: () => void
  /**
   * Ensure there's a target HTML artifact for a design turn and return its paths.
   * If an HTML artifact is active, appends a new version (basePath = current);
   * otherwise creates a fresh HTML artifact and makes it active.
   */
  prepareHtmlTurn: (
    brief: string,
    options?: { forceNew?: boolean; artifactId?: string; activate?: boolean }
  ) => { artifactId: string; relativePath: string; basePath?: string; designMdPath: string }
  setAiRailCollapsed: (collapsed: boolean) => void
  setCanvasAssistantOpen: (open: boolean) => void
  setCanvasInspectorPinned: (pinned: boolean) => void
  setAssistantModel: (model: string, providerId?: string) => void
  updateDesignContext: (patch: Partial<DesignContext>) => void
  /** Hydrate workspace root + design context defaults from persisted settings. */
  loadDesignSettings: () => Promise<void>
  /** Rebuild the artifact list from `.kun-design/` on disk (durable list). */
  rehydrateArtifacts: () => Promise<void>
  /** Re-read DESIGN_SYSTEM.md and refresh designSystemHash (code-drift detection). */
  refreshDesignSystemHash: () => Promise<void>
  resetWorkspace: () => void
}
