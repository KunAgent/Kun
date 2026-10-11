import type { ReactElement, ReactNode } from 'react'
import { PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteRightPanelId } from '../../write/write-right-panel-state'
import { WriteRightPanelIcon, writeRightPanelLabelKey } from './write-right-panel-meta'

/**
 * Shared 52px header for every Work right panel. Its bottom hairline lines up
 * with the sidebar top row and the editor tab row.
 */
export function WriteRightPanelHeader({
  id,
  actions,
  onCollapse
}: {
  id: WriteRightPanelId
  actions?: ReactNode
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="write-right-panel-header ds-sidebar-surface-chrome flex h-[52px] shrink-0 items-center gap-1 border-b border-ds-border-muted pl-4 pr-2.5">
      <span className={`flex shrink-0 items-center ${id === 'assistant' ? 'write-ai-tint' : 'text-ds-muted'}`}>
        <WriteRightPanelIcon id={id} />
      </span>
      <h2 className="ml-2 min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-ds-ink">
        {t(writeRightPanelLabelKey(id))}
      </h2>
      {actions}
      <button
        type="button"
        onClick={onCollapse}
        className="write-panel-icon-button"
        aria-label={t('rightPanelCollapse')}
        title={t('rightPanelCollapse')}
      >
        <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

export function WriteRightPanelEmpty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-1 items-start justify-center px-6 pt-10 text-center text-[12.5px] leading-6 text-ds-muted">
      <p className="max-w-[260px]">{children}</p>
    </div>
  )
}
