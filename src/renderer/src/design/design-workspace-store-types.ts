import type { DesignArtifact, DesignArtifactVersion, DesignCanvasView, DesignViewport } from './design-types'
import type { DesignContext } from './design-context'

export type DesignWorkspaceState = {
  /** Workspace root design artifacts live under; '' = none chosen yet. */
  workspaceRoot: string
  artifacts: DesignArtifact[]
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
  /** When true, the right-side Design AI Rail collapses to a thin strip. Persisted. */
  aiRailCollapsed: boolean

  setWorkspaceRoot: (workspaceRoot: string) => void
  setCanvasView: (view: DesignCanvasView) => void
  setViewport: (viewport: DesignViewport) => void
  setDevPreviewUrl: (url: string) => void
  setCanvasBackground: (background: 'light' | 'dark') => void
  setActiveArtifact: (artifactId: string | null) => void
  /** Insert a new artifact (or replace one with the same id) and make it active. */
  upsertArtifact: (artifact: DesignArtifact) => void
  /** Append a new version, repointing the artifact's current document at it. */
  addArtifactVersion: (artifactId: string, version: DesignArtifactVersion) => void
  /** Stamp an artifact as handed to code (provenance + drift baseline). */
  markImplemented: (artifactId: string, threadId: string, designSystemHash?: string) => void
  removeArtifact: (artifactId: string) => void
  /** Rename an artifact's title (persisted to its meta.json sidecar). */
  renameArtifact: (artifactId: string, title: string) => void
  /** Set or clear the design-mode error banner. */
  setFileError: (error: string | null) => void
  /** Open the in-page "implement in code" assistant for an artifact. */
  openImplementPanel: (title: string) => void
  closeImplementPanel: () => void
  setAiRailCollapsed: (collapsed: boolean) => void
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
