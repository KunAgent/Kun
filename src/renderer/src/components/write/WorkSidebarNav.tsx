import type { ReactElement } from 'react'
import { FilePlus2, SquarePen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '../chat/sidebar-code-nav.css'
import './work-sidebar.css'

/** Primary actions in Code's shape: a session button and a document icon. */
export function WorkSidebarPrimaryActions({ runtimeReady, onNewSession, onNewDocument }: {
  runtimeReady: boolean
  onNewSession: () => void
  onNewDocument: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="sidebar-primary-actions ds-no-drag" data-work-primary-actions>
      <button type="button" className="sidebar-new-task" data-cursor-spotlight-target disabled={!runtimeReady}
        title={runtimeReady ? t('workSidebarNewSession') : t('runtimeActionNeedsConnection')}
        onClick={runtimeReady ? onNewSession : undefined}>
        <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{t('workSidebarNewSession')}</span>
      </button>
      <button type="button" className="sidebar-new-chat" data-cursor-spotlight-target
        aria-label={t('workSidebarNewDocument')} title={t('workSidebarNewDocument')} onClick={onNewDocument}>
        <FilePlus2 size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}
