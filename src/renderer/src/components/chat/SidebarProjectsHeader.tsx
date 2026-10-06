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

/** Section header matching the Conversations section above it. */
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
    <div className="flex min-h-[32px] items-center justify-between gap-1.5 pb-1 pl-1 pr-0.5 pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-semibold tracking-[0.02em] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
        title={t('sidebarProjects')}
        aria-label={t('sidebarProjects')}
      >
        <span className="truncate">{t('sidebarProjects')}</span>
        {allGroupsCollapsed
          ? <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          : <ChevronDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={2} />}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <SidebarIconButton
          onClick={onToggleSearch}
          active={searchVisible}
          className="h-6 w-6"
          title={t('sidebarSearchThreads')}
          ariaLabel={t('sidebarSearchThreads')}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
        </SidebarIconButton>
        <SidebarIconButton
          onClick={onPickWorkspace}
          className="h-6 w-6"
          title={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
          ariaLabel={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
        >
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </SidebarIconButton>
      </div>
    </div>
  )
}
