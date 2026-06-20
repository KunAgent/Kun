import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { DesignCanvas } from './DesignCanvas'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (prompt: string) => void
  onOpenAgentSettings?: () => void
}

/**
 * Design-mode main surface: a single full-width canvas with the design
 * composer floating bottom-center (Stitch-style). The 设计上下文 form lives
 * in a popover triggered from the canvas toolbar.
 */
export function DesignWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onOpenAgentSettings
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const loadDesignSettings = useDesignWorkspaceStore((s) => s.loadDesignSettings)
  const fileError = useDesignWorkspaceStore((s) => s.fileError)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)

  useEffect(() => {
    void loadDesignSettings()
  }, [loadDesignSettings])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="relative flex min-h-0 flex-1">
        <DesignCanvas
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
          input={input}
          setInput={setInput}
          onSubmitPrompt={onSubmitPrompt}
          onOpenAgentSettings={onOpenAgentSettings}
        />
      </div>
    </div>
  )
}
