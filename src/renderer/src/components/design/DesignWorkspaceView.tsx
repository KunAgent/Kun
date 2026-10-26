import type { ReactElement, ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { flushDesignWorkspacePersistence } from '../../design/design-persistence-flush'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import type { DesignArtifact } from '../../design/design-types'
import { DesignCanvas } from './DesignCanvas'

type Props = {
  drawingStart: ReactNode
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

export function designWorkspaceStageMode(options: {
  settingsLoaded: boolean
  drawingCreationOpen: boolean
  drawingCreationSubmitting: boolean
  documentCount: number
  activeDocumentId: string | null
}): 'loading' | 'start' | 'submitting' | 'canvas' {
  if (!options.settingsLoaded) return 'loading'
  if (
    options.drawingCreationOpen &&
    options.drawingCreationSubmitting &&
    options.activeDocumentId
  ) return 'submitting'
  if (
    options.drawingCreationOpen ||
    options.documentCount === 0 ||
    !options.activeDocumentId
  ) return 'start'
  return 'canvas'
}

/**
 * Design-mode center surface: the canvas/preview output. Design input is owned
 * by the floating assistant/composer overlay rendered by the workbench route.
 * The 设计上下文 form lives in a popover triggered from the canvas toolbar.
 */
export function DesignWorkspaceView({
  drawingStart,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onSvgCreated,
  onUseElementAsContext,
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const loadDesignSettings = useDesignWorkspaceStore((s) => s.loadDesignSettings)
  const settingsLoaded = useDesignWorkspaceStore((s) => s.settingsLoaded)
  const documents = useDesignWorkspaceStore((s) => s.documents)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const drawingCreationOpen = useDesignWorkspaceStore((s) => s.drawingCreationOpen)
  const drawingCreationSubmitting = useDesignWorkspaceStore((s) => s.drawingCreationSubmitting)
  const fileError = useDesignWorkspaceStore((s) => s.fileError)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)

  // Reset the load gate before the browser paints this route. A passive effect
  // can expose one stale frame from the previously opened Design workspace.
  useLayoutEffect(() => {
    void loadDesignSettings()
    return () => {
      const workspaceRoot = useDesignWorkspaceStore.getState().workspaceRoot
      if (workspaceRoot) void flushDesignWorkspacePersistence(workspaceRoot)
    }
  }, [loadDesignSettings])

  const stageMode = designWorkspaceStageMode({
    settingsLoaded,
    drawingCreationOpen,
    drawingCreationSubmitting,
    documentCount: documents.length,
    activeDocumentId
  })

  return (
    <div className="design-workspace-view flex min-h-0 min-w-0 flex-1 flex-col">
      {fileError ? (
        <div className="ds-no-drag flex shrink-0 items-center justify-between gap-2 bg-[#c0392b]/10 px-3 py-1.5 text-[12px] text-[#c0392b] shadow-[inset_0_-1px_0_rgba(192,57,43,0.25)] dark:text-[#f0a0a0]">
          <span className="min-w-0 flex-1 truncate">{fileError}</span>
          <button
            type="button"
            onClick={() => setFileError(null)}
            aria-label={t('close')}
            className="shrink-0 transition-opacity hover:opacity-70"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {stageMode === 'loading' ? (
          <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
        ) : stageMode === 'start' ? (
          drawingStart
        ) : stageMode === 'submitting' ? (
          <div
            className="ds-stage-design-canvas relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-ds-main text-ds-faint"
            aria-label={t('designDrawingPreparing')}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
                backgroundSize: '20px 20px'
              }}
              aria-hidden
            />
            <div className="relative flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card/90 px-4 py-2 text-[12.5px] font-medium shadow-sm backdrop-blur-sm">
              <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={2} />
              <span>{t('designDrawingPreparing')}</span>
            </div>
          </div>
        ) : (
          <DesignCanvas
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
            busy={busy}
            onOpenAgentSettings={onOpenAgentSettings}
            onImplementDesign={onImplementDesign}
            onScreenCreated={onScreenCreated}
            onSvgCreated={onSvgCreated}
            onUseElementAsContext={onUseElementAsContext}
          />
        )}
      </div>
    </div>
  )
}
