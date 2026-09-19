import type {
  DesignArtifact,
  DesignArtifactNode,
  DesignArtifactVersion,
  DesignCanvasView,
  DesignDocument,
  DesignDirectionStatus,
  DesignIntentMode,
  DesignViewport,
  DesignWorkspaceFolder
} from './design-types'
import type { DesignContext, DesignTarget } from './design-context'
import type { DrawingHistoryMutation } from './design-drawing-history'
import type { CanvasEngine } from '../whiteboard/canvas-engine'

/** Progress of an in-flight Stitch-style multi-page generation run. */
export type DesignPagesRunState = {
  /** `foundation` = laying design.md / design-system / logo before any screen. */
  phase: 'foundation' | 'planning' | 'generating'
  /** Total pages to generate (0 while still planning / in foundation). */
  total: number
  /** Pages already generated. */
  done: number
  /** Page title being generated, or the localized foundation step label. */
  title: string
  /** Which foundation artifact is being produced (phase `foundation` only). */
  step?: 'spec' | 'system' | 'logo'
}

export type ParallelDesignPageState = {
  artifactId: string
  childId?: string
  status: 'queued' | 'running' | 'done' | 'failed'
  summary?: string
  error?: string
  updatedAt?: string
}

export type DesignWorkspaceState = {
  /** Workspace root design artifacts live under; '' = none chosen yet. */
  workspaceRoot: string
  /** 设计稿 (design documents) — top-level containers, source of truth. */
  documents: DesignDocument[]
  /** Logical multi-level folders used by the Design sidebar. */
  workspaceFolders: DesignWorkspaceFolder[]
  /** Active 设计稿 id; null = none (empty workspace). */
  activeDocumentId: string | null
  /** Transient launcher state for a new drawing. Never persisted to documents.json. */
  drawingCreationOpen: boolean
  /** Previously active drawing restored when the transient launcher is cancelled. */
  drawingCreationReturnDocumentId: string | null
  /** Hidden provisional drawing reused until first send commits or cleanup succeeds. */
  drawingCreationDocumentId: string | null
  /** Guards the launcher's first submission from creating duplicate drawings. */
  drawingCreationSubmitting: boolean
  /** Folder selected before the transient drawing launcher creates its document. */
  drawingCreationFolderId: string | null
  /** A destructive drawing-history operation currently owning the document. */
  drawingHistoryMutation: DrawingHistoryMutation | null
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
  /** Hash of the current valid root DESIGN.md ('' = none). */
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
  /** Transient status for pages currently delegated to design subagents. */
  parallelPageStates: Record<string, ParallelDesignPageState>

  setWorkspaceRoot: (workspaceRoot: string) => void
  setCanvasView: (view: DesignCanvasView) => void
  setViewport: (viewport: DesignViewport) => void
  setDevPreviewUrl: (url: string) => void
  setCanvasBackground: (background: 'light' | 'dark') => void
  setActiveArtifact: (artifactId: string | null) => void
  /** Create a new 设计稿 (empty), make it active, and return its id. */
  createDocument: (
    title?: string,
    options?: {
      transient?: boolean
      titleOrigin?: 'generated' | 'user'
      folderId?: string | null
      engine?: CanvasEngine
    }
  ) => string
  /** Open the new-drawing launcher without creating a document or changing the persisted active id. */
  beginDrawingCreation: (options?: { folderId?: string | null }) => void
  /** Atomically claim the launcher's first submission. Returns false when one is already in flight. */
  beginDrawingSubmission: () => boolean
  /** Release the launcher submission claim after rollback or cancellation. */
  endDrawingSubmission: () => void
  /** Commit the active provisional drawing and leave the launcher. */
  finishDrawingCreation: (documentId?: string) => void
  /** Leave the launcher and restore the drawing that was active before it opened. */
  cancelDrawingCreation: () => void
  /** Rename a 设计稿 (persisted to documents.json). */
  renameDocument: (
    documentId: string,
    title: string,
    options?: { titleOrigin?: 'generated' | 'user' }
  ) => void
  setDocumentEngine: (documentId: string, engine: CanvasEngine) => boolean
  /** Move a design document into a logical folder; null returns it to the workspace root. */
  moveDocument: (documentId: string, folderId: string | null) => void
  /** Create a logical folder under the optional parent and return its id. */
  createWorkspaceFolder: (name: string, parentId?: string | null) => string | null
  renameWorkspaceFolder: (folderId: string, name: string) => void
  /** Delete a logical folder while promoting its children and documents to the parent. */
  removeWorkspaceFolder: (folderId: string) => void
  /** Acquire a per-drawing destructive-history lock before confirmation. */
  beginDrawingHistoryMutation: (
    workspaceRoot: string,
    documentId: string,
    kind: 'clear' | 'delete'
  ) => boolean
  /** Release the matching destructive-history lock. */
  endDrawingHistoryMutation: (workspaceRoot: string, documentId: string) => void
  /** Delete a 设计稿 and all its 画布 (on-disk dirs + index entry). */
  removeDocument: (documentId: string) => Promise<boolean>
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
  /** Update renderer preview lifecycle for an HTML or SVG artifact. */
  setArtifactPreviewStatus: (
    artifactId: string,
    status: NonNullable<DesignArtifact['previewStatus']>
  ) => void
  /** Accept/archive a Stitch-style design direction and persist every screen in it. */
  setDirectionStatus: (directionId: string, status: DesignDirectionStatus) => void
  updateArtifactNode: (artifactId: string, patch: Partial<DesignArtifactNode>) => void
  duplicateArtifact: (artifactId: string) => Promise<void>
  selectArtifactVersion: (artifactId: string, versionId: string) => void
  setDesignIntentMode: (mode: DesignIntentMode) => void
  setDesignTarget: (target: DesignTarget) => void
  setMultiPageMode: (on: boolean) => void
  /** Update or clear (null) the multi-page run progress. */
  setPagesRun: (state: DesignPagesRunState | null) => void
  setParallelPageStates: (states: ParallelDesignPageState[]) => void
  updateParallelPageState: (artifactId: string, patch: Partial<Omit<ParallelDesignPageState, 'artifactId'>>) => void
  clearParallelPageStates: () => void
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
    options?: { forceNew?: boolean; artifactId?: string; activate?: boolean; reusePendingInitial?: boolean }
  ) => { artifactId: string; relativePath: string; basePath?: string; designMdPath: string }
  /** Ensure a first-class SVG artifact exists and advance it to a new turn version. */
  prepareSvgTurn: (
    brief: string,
    options?: {
      forceNew?: boolean
      artifactId?: string
      activate?: boolean
      reusePendingInitial?: boolean
      width?: number
      height?: number
      title?: string
    }
  ) => Promise<{
    artifactId: string
    relativePath: string
    basePath?: string
    designMdPath: string
    newlyCreated: boolean
    versionCreated: boolean
    rollbackPreparedVersion?: () => Promise<void>
  }>
  setAiRailCollapsed: (collapsed: boolean) => void
  setCanvasAssistantOpen: (open: boolean) => void
  toggleCanvasAssistantOpen: () => void
  setCanvasInspectorPinned: (pinned: boolean) => void
  setAssistantModel: (model: string, providerId?: string) => void
  updateDesignContext: (patch: Partial<DesignContext>) => void
  /** Hydrate workspace root + design context defaults from persisted settings. */
  loadDesignSettings: () => Promise<void>
  /** Rebuild the artifact list from `.kun-design/` on disk (durable list). */
  rehydrateArtifacts: () => Promise<void>
  /** Re-read design-system.json and refresh designSystemHash (code-drift detection). */
  refreshDesignSystemHash: () => Promise<void>
  resetWorkspace: () => void
}
