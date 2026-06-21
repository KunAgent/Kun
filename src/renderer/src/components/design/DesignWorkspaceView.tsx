import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import type { DesignArtifact } from '../../design/design-types'
import { DesignCanvas } from './DesignCanvas'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onScreenCreated?: (shapeId: string, userPrompt: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

/**
 * Design-mode center surface: the canvas/preview output. Design input is owned
 * by the floating assistant/composer overlay rendered by the workbench route.
 * The 设计上下文 form lives in a popover triggered from the canvas toolbar.
 */
export function DesignWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onUseElementAsContext
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const loadDesignSettings = useDesignWorkspaceStore((s) => s.loadDesignSettings)
  const fileError = useDesignWorkspaceStore((s) => s.fileError)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)

  useEffect(() => {
    void loadDesignSettings()
  }, [loadDesignSettings])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        <DesignCanvas
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
          onOpenAgentSettings={onOpenAgentSettings}
          onImplementDesign={onImplementDesign}
          onScreenCreated={onScreenCreated}
          onUseElementAsContext={onUseElementAsContext}
        />
      </div>
    </div>
  )
}
