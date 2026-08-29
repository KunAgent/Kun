import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Camera,
  ChevronDown,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  Sidebar,
  X
} from 'lucide-react'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

export type NodeGraphScopeOption = {
  id: string
  label: string
  active: boolean
}

type Props = {
  search: string
  onSearchChange: (value: string) => void
  scopeLabel: string
  onCycleScope: () => void
  scopeTitle: string
  loading: boolean
  stats: string
  onRefresh: () => void
  onFit: () => void
  onExport: () => void
  controlsOpen: boolean
  onToggleControls: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  onClose?: () => void
  /** Collapses the app's own left sidebar; absent when embedded in Work. */
  onToggleAppSidebar?: () => void
  appSidebarCollapsed?: boolean
}

/**
 * One command row: identity, scope, search, then actions.
 *
 * Search lives here rather than inside the filter rail because it is the fastest
 * way into a large graph and should not require opening a panel first. It
 * deliberately claims no keyboard shortcut: `⌘K` already opens the workbench
 * command palette, and a window-level listener here would swallow it.
 *
 * With the app sidebar collapsed the row starts at the window's left edge, which
 * on macOS is where the traffic lights live. The leading group takes the shared
 * `ds-window-controls-collapsed-titlebar-inset`, the same one Workflow and
 * Schedule use, so the graph lines up with its sibling views instead of sliding
 * under the window controls. The token is 0 off macOS, so this costs nothing
 * there.
 */
export function NodeGraphTopBar({
  search,
  onSearchChange,
  scopeLabel,
  onCycleScope,
  scopeTitle,
  loading,
  stats,
  onRefresh,
  onFit,
  onExport,
  controlsOpen,
  onToggleControls,
  panelOpen,
  onTogglePanel,
  onClose,
  onToggleAppSidebar,
  appSidebarCollapsed = false
}: Props): ReactElement {
  const { t } = useTranslation('common')

  return (
    <header className="ds-drag flex shrink-0 items-center gap-2 border-b border-ds-border-muted bg-ds-card/70 px-2.5 py-2">
      <div
        className={`flex shrink-0 items-center gap-2 ${
          onToggleAppSidebar && appSidebarCollapsed
            ? 'ds-window-controls-collapsed-titlebar-inset'
            : ''
        }`}
      >
        {onToggleAppSidebar ? (
          <SidebarTitlebarToggleButton
            onClick={onToggleAppSidebar}
            title={appSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            ariaLabel={appSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          />
        ) : null}
        <span className="flex shrink-0 items-center gap-2">
          <Network className="h-4 w-4 text-accent" strokeWidth={1.9} />
          <span className="text-[13.5px] font-semibold tracking-tight text-ds-ink">
            {t('nodeGraph')}
          </span>
        </span>
      </div>

      <button
        type="button"
        onClick={onCycleScope}
        title={scopeTitle}
        className="ds-no-drag flex shrink-0 items-center gap-1 rounded-control border border-ds-border-muted px-2 py-1 text-[12px] text-ds-ink transition-colors hover:border-accent"
      >
        {scopeLabel}
        <ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={2} />
      </button>

      <label className="ds-no-drag relative mx-1 flex min-w-0 flex-1 items-center">
        <Search
          className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ds-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('nodeGraphSearchTopPlaceholder')}
          aria-label={t('nodeGraphSearchTopPlaceholder')}
          className="w-full rounded-control border border-ds-border-muted bg-ds-main py-1 pl-7 pr-2.5 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-accent"
        />
      </label>

      <span className="ds-no-drag hidden shrink-0 tabular-nums text-[11.5px] text-ds-faint xl:inline">
        {stats}
      </span>

      <span className="ds-no-drag flex shrink-0 items-center gap-0.5">
        <TopAction icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.9} />} label={t('nodeGraphRefresh')} onClick={onRefresh} disabled={loading} />
        <TopAction icon={<Maximize2 className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('nodeGraphFit')} onClick={onFit} />
        <TopAction icon={<Camera className="h-3.5 w-3.5" strokeWidth={1.9} />} label={t('nodeGraphExport')} onClick={onExport} />
        <span aria-hidden className="mx-0.5 h-4 w-px bg-ds-border-muted" />
        <IconToggle
          icon={<Sidebar className="h-3.5 w-3.5" strokeWidth={1.9} />}
          label={t('nodeGraphControls')}
          pressed={controlsOpen}
          onClick={onToggleControls}
        />
        <IconToggle
          icon={<Sidebar className="h-3.5 w-3.5 rotate-180" strokeWidth={1.9} />}
          label={t('nodeGraphSettings')}
          pressed={panelOpen}
          onClick={onTogglePanel}
        />
        {onClose ? (
          <IconToggle
            icon={<X className="h-3.5 w-3.5" strokeWidth={1.9} />}
            label={t('nodeGraphClose')}
            pressed={false}
            onClick={onClose}
          />
        ) : null}
      </span>
    </header>
  )
}

function TopAction({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: ReactElement
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[12px] text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
    >
      {icon}
      {/* The label is the point of this row; it collapses only when space runs out. */}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

function IconToggle({
  icon,
  label,
  pressed,
  onClick
}: {
  icon: ReactElement
  label: string
  pressed: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      className={`rounded-control p-1.5 transition-colors hover:bg-ds-hover ${
        pressed ? 'text-accent' : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      {icon}
    </button>
  )
}
