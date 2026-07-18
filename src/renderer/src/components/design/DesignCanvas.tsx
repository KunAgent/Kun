import { useEffect, type ReactElement } from 'react'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignArtifact } from '../../design/design-types'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import type { DesignRuntimeQualityPayload } from '../../design/design-html-quality'
import { setScreenCreationFactory } from '../../design/canvas/screen-artifact-bridge'
import { ensureDesignBoardArtifact, findDesignBoardArtifact } from '../../design/design-board'
import { createLinkedHtmlScreen } from '../../design/canvas/screen-lifecycle'
import { createLinkedSvgArtifact } from '../../design/canvas/svg-artifact-lifecycle'
import { designThreadBelongsToDocument } from '../../design/design-thread-workbench'
import { useChatStore } from '../../store/chat-store'
import { CanvasViewport } from './canvas/CanvasViewport'
import { PropertiesPanel } from './canvas/PropertiesPanel'
import { useApplyShapeOpsLive } from '../../design/canvas/use-apply-shape-ops-live'
import { canvasOpErrorKey } from '../../design/canvas/apply-shape-ops'
import { useSvgArtifactStatusMonitor } from '../../design/svg/use-svg-artifact-status-monitor'

type CanvasProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (shapeId: string, userPrompt: string, brief?: string) => void
  onSvgCreated?: (
    artifactId: string,
    shapeId: string,
    userPrompt: string,
    brief: string
  ) => boolean | Promise<boolean>
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

/** Design-mode unified stage: one SVG/Figma-style board hosts HTML screen frames and vector layers. */
export function DesignCanvas({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onSvgCreated,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: CanvasProps): ReactElement {
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const settingsLoaded = useDesignWorkspaceStore((s) => s.settingsLoaded)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const boardArtifact = findDesignBoardArtifact(artifacts)
  const baseDir = activeDocumentId ? `.kun-design/${activeDocumentId}` : undefined
  const activeThreadBelongsToDoc = designThreadBelongsToDocument({
    threads,
    workspaceRoot,
    docId: activeDocumentId,
    activeThreadId
  })
  const liveOpsThreadId = activeThreadBelongsToDoc ? activeThreadId : null
  const liveOpsErrorKey = canvasOpErrorKey(workspaceRoot, activeDocumentId, boardArtifact?.id)
  useSvgArtifactStatusMonitor(workspaceRoot, artifacts)

  useEffect(() => {
    if (!workspaceRoot || !settingsLoaded) return
    void ensureDesignBoardArtifact(workspaceRoot)
  }, [workspaceRoot, settingsLoaded, artifacts.length])

  // Register the factory that design_canvas/add-screen calls to create the
  // linked HTML artifact and canvas frame in one lifecycle step.
  useEffect(() => {
    if (!boardArtifact || !activeDocumentId) return
    const documentId = activeDocumentId
    const boardArtifactId = boardArtifact.id
    setScreenCreationFactory((request) => {
      const designState = useDesignWorkspaceStore.getState()
      if (designState.activeDocumentId !== documentId) return null
      const activeBoard = findDesignBoardArtifact(designState.artifacts)
      if (activeBoard?.id !== boardArtifactId) return null
      const created = createLinkedHtmlScreen({
        boardArtifactId,
        name: request.name,
        brief: request.brief,
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        targetFrameId: request.targetFrameId,
        devicePreset: request.devicePreset,
        preparePreview: request.preparePreview,
        sizeMode: request.sizeMode
      })
      return created ? { artifactId: created.artifactId, shapeId: created.shape.id } : null
    })
    return () => setScreenCreationFactory(null)
  }, [activeDocumentId, boardArtifact])

  useApplyShapeOpsLive(
    Boolean(boardArtifact && liveOpsThreadId),
    onScreenCreated,
    undefined,
    liveOpsErrorKey,
    liveOpsThreadId,
    boardArtifact
      ? async (request, userPrompt) => {
          try {
            const created = await createLinkedSvgArtifact({
              boardArtifactId: boardArtifact.id,
              artifactId: request.artifactId,
              name: request.name,
              brief: request.brief,
              x: request.x,
              y: request.y,
              width: request.width,
              height: request.height
            })
            if (!created) return null
            const dispatched = onSvgCreated
              ? await onSvgCreated(
                  created.artifactId,
                  created.shape.id,
                  userPrompt,
                  request.brief
                )
              : true
            if (!dispatched) return null
            return {
              artifactId: created.artifactId,
              shapeId: created.shape.id,
              newlyCreated: created.newlyCreated
            }
          } catch (error) {
            useDesignWorkspaceStore.getState().setFileError(
              error instanceof Error ? error.message : String(error)
            )
            return null
          }
        }
      : undefined
  )

  if (!boardArtifact) {
    return (
      <div className="ds-stage-design-canvas relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-ds-main text-sm text-ds-faint">
        Loading design board...
      </div>
    )
  }

  return (
    <div className="ds-stage-design-canvas relative min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main">
      <CanvasViewport
        workspaceRoot={workspaceRoot}
        artifactId={boardArtifact.id}
        {...(baseDir ? { baseDir } : {})}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        busy={busy}
        onOpenAgentSettings={onOpenAgentSettings}
        syncHtmlScreens
        onImplementDesign={onImplementDesign}
        onUseElementAsContext={onUseElementAsContext}
        onRuntimeQualityFindings={onRuntimeQualityFindings}
        onRequestQualityRepair={onRequestQualityRepair}
      />
      <PropertiesPanel onImplementDesign={onImplementDesign} />
    </div>
  )
}
