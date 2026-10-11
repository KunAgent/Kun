import { useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Compass, FolderPlus, Import, LibraryBig, Newspaper, Rss, Search, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { focusedPaperViewId } from '../../paper/paper-view'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { openPaperImport, openPaperView } from '../../write/work-session-actions'
import { SidebarMenuRow } from '../chat/SidebarCodeNav'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import { PaperTree } from '../paper/sidebar/PaperTree'
import { WorkSidebarSection } from './WorkSidebarSection'
import '../chat/sidebar-code-nav.css'

const iconProps = { className: 'h-4 w-4', strokeWidth: 1.75 }

/**
 * 论文: the current space's papers (`<space>/papers`). The library and the
 * discover pages open as tabs next to documents; paper rows open the reader.
 */
export function WorkPapersSection(): ReactElement {
  const { t } = useTranslation('common')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const activeView = useWriteWorkspaceStore(focusedPaperViewId)
  const { entries, groups, counts, loading } = usePaperModeStore(useShallow((s) => ({
    entries: s.entries,
    groups: s.groups,
    counts: s.counts,
    loading: s.entriesLoading
  })))
  const root = normalizePath(workspaceRoot)
  const discover: Array<{ id: WritePaperViewId; label: string; Icon: typeof Search }> = [
    { id: 'discover:search', label: t('writePaperDiscoverTab_search'), Icon: Search },
    { id: 'discover:arxiv', label: t('writePaperDiscoverNav_arxiv'), Icon: Newspaper },
    { id: 'discover:venue', label: t('writePaperDiscoverNav_venue'), Icon: Trophy },
    { id: 'discover:feeds', label: t('writePaperDiscoverNav_feeds'), Icon: Rss }
  ]
  const libraryActive = activeView === 'library'

  const actions = (
    <>
      <SidebarIconButton onClick={() => setCreatingFolder(true)} title={t('paperNewFolder')}
        ariaLabel={t('paperNewFolder')} className="h-6 w-6">
        <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </SidebarIconButton>
      <SidebarIconButton onClick={() => void openPaperImport()} title={t('workSidebarImportPaper')}
        ariaLabel={t('workSidebarImportPaper')} className="h-6 w-6">
        <Import className="h-3.5 w-3.5" strokeWidth={1.75} />
      </SidebarIconButton>
    </>
  )

  return (
    <WorkSidebarSection id="papers" label={t('workSidebarPapersNav')}
      count={counts.total > 0 ? counts.total : undefined} actions={actions}>
      <nav className="sidebar-code-nav work-papers-nav" aria-label={t('workSidebarPapersNav')}>
        <button type="button" className={'sidebar-menu-row' + (libraryActive ? ' is-active' : '')} data-cursor-spotlight-target
          data-work-nav="library" aria-current={libraryActive ? 'page' : undefined} onClick={() => void openPaperView('library')}>
          <span className="sidebar-menu-row-icon" aria-hidden="true"><LibraryBig {...iconProps} /></span>
          <span className="sidebar-menu-row-label">{t('workSidebarLibrary')}</span>
          {counts.unread > 0 ? (
            <span className="sidebar-menu-row-trailing work-papers-unread">{t('workPapersUnread', { count: counts.unread })}</span>
          ) : null}
        </button>
        <SidebarMenuRow
          icon={<Compass {...iconProps} />}
          label={t('workSidebarDiscover')}
          items={discover.map(({ id, label, Icon }) => ({
            id,
            label,
            icon: <Icon {...iconProps} />,
            active: activeView === id,
            onSelect: () => void openPaperView(id)
          }))}
        />
      </nav>
      {root ? (
        entries.length === 0 && groups.length === 0 && !creatingFolder ? (
          <div className="work-papers-empty">
            <span>{loading ? t('workSessionLoading') : t('workPapersEmpty')}</span>
            {loading ? null : (
              <button type="button" onClick={() => void openPaperImport()}>{t('workSidebarImportPaper')}</button>
            )}
          </div>
        ) : (
          <PaperTree
            libraryRoot={root}
            entries={entries}
            groups={groups}
            creatingFolder={creatingFolder}
            onCreatingFolderDone={() => setCreatingFolder(false)}
          />
        )
      ) : null}
    </WorkSidebarSection>
  )
}
