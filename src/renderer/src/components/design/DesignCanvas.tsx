import { useEffect, type ReactElement } from 'react'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { createDesignArtifactId } from '../../design/design-types'
import type { DesignArtifact } from '../../design/design-types'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import { setScreenArtifactFactory } from '../../design/canvas/screen-artifact-bridge'
import { artifactDesignMdPath, artifactDirPath } from '../../design/design-artifact-persistence'
import { ensureDesignBoardArtifact, findDesignBoardArtifact } from '../../design/design-board'
import { prepareDesignPreviewFile } from '../../design/design-preview-file'
import { CanvasViewport } from './canvas/CanvasViewport'
import { PropertiesPanel } from './canvas/PropertiesPanel'
import { useApplyShapeOpsLive } from '../../design/canvas/use-apply-shape-ops-live'

type CanvasProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (shapeId: string, userPrompt: string, brief?: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

/** Design-mode unified stage: one SVG/Figma-style board hosts HTML screen frames and vector layers. */
export function DesignCanvas({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onUseElementAsContext
}: CanvasProps): ReactElement {
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const settingsLoaded = useDesignWorkspaceStore((s) => s.settingsLoaded)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const boardArtifact = findDesignBoardArtifact(artifacts)
  const baseDir = activeDocumentId ? `.kun-design/${activeDocumentId}` : undefined

  useApplyShapeOpsLive(Boolean(boardArtifact), onScreenCreated)

  useEffect(() => {
    if (!workspaceRoot || !settingsLoaded) return
    void ensureDesignBoardArtifact(workspaceRoot)
  }, [workspaceRoot, settingsLoaded, artifacts.length])

  // Register the factory that design_canvas/add-screen calls and the Screen
  // tool use to create a linked HTML artifact (returns the new artifact id synchronously).
  useEffect(() => {
    if (!boardArtifact) return
    setScreenArtifactFactory((name: string) => {
      const store = useDesignWorkspaceStore.getState()
      const docId = store.ensureActiveDocument()
      const createdAt = new Date().toISOString()
      const artifactId = createDesignArtifactId()
      const relativePath = `${artifactDirPath(docId, artifactId)}/v1.html`
      const designMdPath = artifactDesignMdPath(docId, artifactId)
      const title = name || 'Screen'
      store.upsertArtifact({
        id: artifactId,
        kind: 'html',
        title,
        relativePath,
        createdAt,
        updatedAt: createdAt,
        versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: '' }],
        designMdPath,
        previewStatus: 'pending'
      })
      // Drop a placeholder HTML file immediately so the canvas tile renders the
      // "Generating…" skeleton instead of polling a missing file (and tripping the
      // "prototype file not found" banner) until the agent writes the real page.
      void prepareDesignPreviewFile(store.workspaceRoot, relativePath)
      store.setActiveArtifact(boardArtifact.id)
      return artifactId
    })
    return () => setScreenArtifactFactory(() => null)
  }, [boardArtifact])

  if (!boardArtifact) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-ds-main text-sm text-ds-faint">
        Loading design board...
      </div>
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main">
      <CanvasViewport
        workspaceRoot={workspaceRoot}
        artifactId={boardArtifact.id}
        {...(baseDir ? { baseDir } : {})}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        onOpenAgentSettings={onOpenAgentSettings}
        syncHtmlScreens
        onImplementDesign={onImplementDesign}
        onUseElementAsContext={onUseElementAsContext}
      />
      <PropertiesPanel onImplementDesign={onImplementDesign} />
    </div>
  )
}
