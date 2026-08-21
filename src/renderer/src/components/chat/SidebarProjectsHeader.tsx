import type { ReactElement } from 'react'
import { ChevronDown, ChevronRight, FolderPlus, Search } from 'lucide-react'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'

type Props = {
  allGroupsCollapsed: boolean
  searchVisible: boolean
  workspaceRoot: string
  onToggle: () => void
  onToggleSearch: () => void
  onPickWorkspace: () => void
  t: (key: string) => string
}

export function SidebarProjectsHeader({
  allGroupsCollapsed,
  searchVisible,
  workspaceRoot,
  onToggle,
  onToggleSearch,
  onPickWorkspace,
  t
}: Props): ReactElement {
  return (
    <div className="flex min-h-[38px] items-center justify-between px-2 pb-1.5 pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
        title={t('sidebarProjects')}
        aria-label={t('sidebarProjects')}
      >
        <span className="truncate">{t('sidebarProjects')}</span>
        {allGroupsCollapsed
          ? <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          : <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <SidebarIconButton
          onClick={onToggleSearch}
          active={searchVisible}
          className="h-7 w-7"
          title={t('sidebarSearchThreads')}
          ariaLabel={t('sidebarSearchThreads')}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={onPickWorkspace}
          className="h-7 w-7"
          title={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
          ariaLabel={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
        >
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </SidebarIconButton>
      </div>
    </div>
  )
}
