import type { ReactElement } from 'react'
import { Compass, FilePlus2, FolderPlus, Import, LibraryBig, Newspaper, RefreshCw, Rss, Search, SquarePen, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { focusedPaperViewId } from '../../paper/paper-view'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { useWorkSidebarStore, type WorkSidebarView } from '../../write/work-sidebar-store'
import { openPaperImport, openPaperView } from '../../write/work-session-actions'
import { SidebarMenuRow } from '../chat/SidebarCodeNav'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import '../chat/sidebar-code-nav.css'
import './work-sidebar.css'

const iconProps = { className: 'h-4 w-4', strokeWidth: 1.75 }

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

/** Papers are part of Work: the library and discovery pages sit in the nav. */
export function WorkSidebarPaperNav(): ReactElement {
  const { t } = useTranslation('common')
  const activeView = useWriteWorkspaceStore(focusedPaperViewId)
  const papersMounted = useWriteWorkspaceStore((s) => s.workSurface === 'papers')
  const total = usePaperModeStore((s) => s.counts.total)
  const discover: Array<{ id: WritePaperViewId; label: string; Icon: typeof Search }> = [
    { id: 'discover:search', label: t('writePaperDiscoverTab_search'), Icon: Search },
    { id: 'discover:arxiv', label: t('writePaperDiscoverNav_arxiv'), Icon: Newspaper },
    { id: 'discover:venue', label: t('writePaperDiscoverNav_venue'), Icon: Trophy },
    { id: 'discover:feeds', label: t('writePaperDiscoverNav_feeds'), Icon: Rss }
  ]
  const libraryActive = activeView === 'library'
  return (
    <nav className="sidebar-code-nav" aria-label={t('workSidebarPapersNav')}>
      <button type="button" className={'sidebar-menu-row' + (libraryActive ? ' is-active' : '')} data-cursor-spotlight-target
        data-work-nav="library" aria-current={libraryActive ? 'page' : undefined} onClick={() => void openPaperView('library')}>
        <span className="sidebar-menu-row-icon" aria-hidden="true"><LibraryBig {...iconProps} /></span>
        <span className="sidebar-menu-row-label">{t('workSidebarLibrary')}</span>
        {papersMounted && total > 0 ? <span className="sidebar-menu-row-trailing">{total}</span> : null}
      </button>
      <SidebarMenuRow
        icon={<Compass {...iconProps} />}
        label={t('workSidebarDiscover')}
        items={[
          ...discover.map(({ id, label, Icon }) => ({
            id,
            label,
            icon: <Icon {...iconProps} />,
            active: activeView === id,
            onSelect: () => void openPaperView(id)
          })),
          {
            id: 'import',
            label: t('workSidebarImportPaper'),
            icon: <Import {...iconProps} />,
            active: false,
            onSelect: () => void openPaperImport()
          }
        ]}
      />
    </nav>
  )
}

/** 会话 | 目录 switch with the actions of the current view. */
export function WorkSidebarViewHeader({ view, searchOpen, onToggleSearch, onAddSpace, onRefresh }: {
  view: WorkSidebarView
  searchOpen: boolean
  onToggleSearch: () => void
  onAddSpace: () => void
  onRefresh: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const setView = useWorkSidebarStore((s) => s.setView)
  const options: Array<{ id: WorkSidebarView; label: string }> = [
    { id: 'sessions', label: t('workSidebarViewSessions') },
    { id: 'files', label: t('workSidebarViewFiles') }
  ]
  return (
    <div className="work-sidebar-head ds-no-drag">
      <div className="work-sidebar-switch" role="tablist" aria-label={t('workSidebarViewLabel')}>
        {options.map((option) => (
          <button key={option.id} type="button" role="tab" aria-selected={view === option.id}
            data-work-sidebar-view={option.id} onClick={() => setView(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="work-sidebar-head-actions">
        {view === 'sessions' ? (
          <SidebarIconButton onClick={onToggleSearch} active={searchOpen} className="h-6 w-6"
            title={t('workSidebarSearchSessions')} ariaLabel={t('workSidebarSearchSessions')}>
            <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
          </SidebarIconButton>
        ) : (
          <SidebarIconButton onClick={onRefresh} className="h-6 w-6"
            title={t('writeRefreshWorkspace')} ariaLabel={t('writeRefreshWorkspace')}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </SidebarIconButton>
        )}
        <SidebarIconButton onClick={onAddSpace} className="h-6 w-6"
          title={t('writeAddWorkspace')} ariaLabel={t('writeAddWorkspace')}>
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </SidebarIconButton>
      </div>
    </div>
  )
}

