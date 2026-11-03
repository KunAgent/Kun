import type { ReactElement } from 'react'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignArtifact } from '../../design/design-types'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import { designThreadBelongsToDocument } from '../../design/design-thread-workbench'
import { useChatStore } from '../../store/chat-store'
import { DesignDocumentCanvasSurface } from './canvas/DesignDocumentCanvasSurface'

type CanvasProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (
    shapeId: string,
    userPrompt: string,
    brief?: string
  ) => boolean | void | Promise<boolean | void>
  onSvgCreated?: (
    artifactId: string,
    shapeId: string,
    userPrompt: string,
    brief: string
  ) => boolean | Promise<boolean>
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
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
}: CanvasProps): ReactElement {
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const activeThreadBelongsToDoc = designThreadBelongsToDocument({
    threads,
    workspaceRoot,
    docId: activeDocumentId,
    activeThreadId
  })
  return (
    <DesignDocumentCanvasSurface
      workspaceRoot={workspaceRoot}
      documentId={activeDocumentId}
      activeThreadId={activeThreadBelongsToDoc ? activeThreadId : null}
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={onToggleLeftSidebar}
      busy={busy}
      onOpenAgentSettings={onOpenAgentSettings}
      onImplementDesign={onImplementDesign}
      onScreenCreated={onScreenCreated}
      onSvgCreated={onSvgCreated}
      onUseElementAsContext={onUseElementAsContext}
    />
  )
}
