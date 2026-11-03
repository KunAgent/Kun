import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { DesignWorkspaceView, designWorkspaceStageMode } from '../design/DesignWorkspaceView'
import { DesignDrawingStart, type DesignDrawingStartProps } from '../design/DesignDrawingStart'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'

type DesignWorkspaceViewProps = ComponentProps<typeof DesignWorkspaceView>

type WorkbenchDesignStageProps = Pick<
  DesignWorkspaceViewProps,
  | 'leftSidebarCollapsed'
  | 'onToggleLeftSidebar'
  | 'busy'
  | 'onOpenAgentSettings'
  | 'onImplementDesign'
  | 'onScreenCreated'
  | 'onSvgCreated'
  | 'onUseElementAsContext'
> & {
  rightPanel: ReactNode
  drawingStart: DesignDrawingStartProps
}

export function WorkbenchDesignStage({
  rightPanel,
  drawingStart,
  ...workspaceProps
}: WorkbenchDesignStageProps): ReactElement {
  const settingsLoaded = useDesignWorkspaceStore((state) => state.settingsLoaded)
  const documents = useDesignWorkspaceStore((state) => state.documents)
  const activeDocumentId = useDesignWorkspaceStore((state) => state.activeDocumentId)
  const drawingCreationOpen = useDesignWorkspaceStore((state) => state.drawingCreationOpen)
  const drawingCreationSubmitting = useDesignWorkspaceStore(
    (state) => state.drawingCreationSubmitting
  )
  const stageMode = designWorkspaceStageMode({
    settingsLoaded,
    drawingCreationOpen,
    drawingCreationSubmitting,
    documentCount: documents.length,
    activeDocumentId
  })
  const showRightPanel = stageMode === 'canvas' || stageMode === 'submitting'

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <DesignWorkspaceView
        {...workspaceProps}
        drawingStart={<DesignDrawingStart {...drawingStart} />}
      />
      {showRightPanel ? rightPanel : null}
    </div>
  )
}
