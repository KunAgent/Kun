import { useEffect, type ReactElement } from 'react'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { DESIGN_CANVAS_ENABLED } from '../../design/design-feature-flags'
import { createDesignArtifactId, defaultDesignArtifactNode } from '../../design/design-types'
import type { DesignArtifact } from '../../design/design-types'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import { setScreenArtifactFactory } from '../../design/canvas/screen-artifact-bridge'
import { CanvasViewport } from './canvas/CanvasViewport'
import { PropertiesPanel } from './canvas/PropertiesPanel'
import { DesignProjectCanvas } from './DesignProjectCanvas'
import { useApplyShapeOpsOnTurnComplete } from '../../design/canvas/use-apply-shape-ops-on-turn-complete'

type CanvasProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (shapeId: string, userPrompt: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

/**
 * Design-mode stage router. SVG canvas artifacts keep the Figma-style ShapeOps
 * editor; HTML artifacts and the empty state use the Stitch-style project canvas.
 */
export function DesignCanvas({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onUseElementAsContext
}: CanvasProps): ReactElement {
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const activeArtifact = artifacts.find((item) => item.id === activeArtifactId) ?? null
  const showCanvasStage = DESIGN_CANVAS_ENABLED && activeArtifact?.kind === 'canvas'

  useApplyShapeOpsOnTurnComplete(showCanvasStage, onScreenCreated)

  // Register the factory that add-screen ShapeOps and the Screen tool use to
  // create a linked HTML artifact (returns the new artifact id synchronously).
  useEffect(() => {
    setScreenArtifactFactory((name: string) => {
      const store = useDesignWorkspaceStore.getState()
      const createdAt = new Date().toISOString()
      const artifactId = createDesignArtifactId()
      const relativePath = `.kun-design/${artifactId}/v1.html`
      const title = name || 'Screen'
      store.upsertArtifact({
        id: artifactId,
        kind: 'html',
        title,
        relativePath,
        createdAt,
        updatedAt: createdAt,
        versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: '' }],
        node: defaultDesignArtifactNode(store.artifacts.length)
      })
      return artifactId
    })
    return () => setScreenArtifactFactory(() => null)
  }, [])

  if (showCanvasStage && activeArtifact) {
    return (
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main">
        <CanvasViewport
          workspaceRoot={workspaceRoot}
          artifactId={activeArtifact.id}
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
        />
        <PropertiesPanel />
      </div>
    )
  }

  return (
    <DesignProjectCanvas
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={onToggleLeftSidebar}
      onOpenAgentSettings={onOpenAgentSettings}
      onImplementDesign={onImplementDesign}
      onUseElementAsContext={onUseElementAsContext}
    />
  )
}
