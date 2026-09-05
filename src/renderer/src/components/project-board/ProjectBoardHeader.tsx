import type { ReactElement } from 'react'
import { Menu, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import type { ProjectBoardTab } from '../../project-board/project-board-types'

type Props = {
  workspaceRoot: string
  activeTab: ProjectBoardTab
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onTab: (tab: ProjectBoardTab) => void
  onNewTask: () => void
}

export function ProjectBoardHeader(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const tabs: ProjectBoardTab[] = ['overview', 'board', 'archive']
  return (
    <header className="ds-no-drag shrink-0 border-b border-ds-border-muted bg-ds-main px-6 pt-5 sm:px-8">
      <div className="flex items-start gap-3">
        {props.leftSidebarCollapsed ? (
          <button
            type="button"
            onClick={props.onToggleLeftSidebar}
            aria-label={t('projectBoardOpenSidebar')}
            className="mt-0.5 rounded-lg border border-ds-border-muted p-2 text-ds-muted hover:bg-ds-card"
          >
            <Menu className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ds-faint">
            {workspaceLabelFromPath(props.workspaceRoot)} / {t('projectBoardNav')}
          </p>
          <h1 className="mt-1 truncate text-[24px] font-semibold tracking-[-0.02em] text-ds-ink">
            {t('projectBoardTitle', { project: workspaceLabelFromPath(props.workspaceRoot) })}
          </h1>
          <p className="mt-1 text-[13px] text-ds-muted">{t('projectBoardSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={props.onNewTask}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white shadow-sm hover:brightness-105"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('projectBoardNewTask')}</span>
        </button>
      </div>
      <nav className="mt-4 flex h-10 items-end gap-7" aria-label={t('projectBoardTabs')}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => props.onTab(tab)}
            aria-current={props.activeTab === tab ? 'page' : undefined}
            className={`h-10 border-b-2 px-1 text-[13px] transition ${
              props.activeTab === tab
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-ds-muted hover:text-ds-ink'
            }`}
          >
            {t(`projectBoardTab${tab[0]?.toUpperCase()}${tab.slice(1)}`)}
          </button>
        ))}
      </nav>
    </header>
  )
}
