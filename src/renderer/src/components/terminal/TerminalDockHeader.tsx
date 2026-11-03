import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import {
  ChevronDown,
  Columns2,
  Ellipsis,
  List,
  Maximize2,
  Minimize2,
  PanelLeft,
  Plus,
  Search,
  X
} from 'lucide-react'
import {
  paneTitle,
  statusDot,
  strongestDot,
  type TerminalDockLayout,
  type TerminalSessionStatus,
  type TerminalTab,
  type WorkspaceTerminals
} from './terminal-dock-model'
import { ptySessionIdFor, type DockScope } from './terminal-dock-actions'
import { TerminalTargetIcon } from './TerminalIcon'
import { dockShortcut, toggleTerminalShortcut, withShortcut } from './terminal-shortcuts'

type T = (key: string, options?: Record<string, unknown>) => string

export type DockPlacement = 'bottom' | 'right' | 'ade'

export function tabTitle(scope: DockScope, tab: TerminalTab, status: Record<string, TerminalSessionStatus>, t: T): string {
  return tab.panes.map((pane) => paneTitle(pane, status[ptySessionIdFor(scope.workspaceRoot, pane)], fallbackTitle(pane.target.kind, t))).join(' · ')
}

export function fallbackTitle(kind: string, t: T): string {
  if (kind === 'ssh') return 'SSH'
  if (kind === 'kun-process') return t('termDockKunProcess')
  if (kind === 'agent') return t('termDockAgent')
  return t('termDockShell')
}

export function tabDot(scope: DockScope, tab: TerminalTab, status: Record<string, TerminalSessionStatus>) {
  return strongestDot(tab.panes.map((pane) => statusDot(status[ptySessionIdFor(scope.workspaceRoot, pane)])))
}

function tabExited(scope: DockScope, tab: TerminalTab, status: Record<string, TerminalSessionStatus>): boolean {
  return tab.panes.every((pane) => status[ptySessionIdFor(scope.workspaceRoot, pane)]?.phase === 'exited') && tab.panes[0]?.target.kind === 'ssh'
}

export type TerminalDockHeaderProps = {
  scope: DockScope
  workspace: WorkspaceTerminals
  status: Record<string, TerminalSessionStatus>
  layout: TerminalDockLayout
  placement: DockPlacement
  railVisible: boolean
  renamingTabId: string | null
  canSplit: boolean
  findActive: boolean
  onSelectTab: (tabId: string) => void
  onCloseTab: (tab: TerminalTab) => void
  onRename: (tab: TerminalTab, title: string | null) => void
  onTabMenu: (tab: TerminalTab, x: number, y: number) => void
  onNewShell: () => void
  onNewMenu: (anchor: DOMRect) => void
  onToggleRail: () => void
  onSplit: () => void
  onFind: () => void
  onMore: (anchor: DOMRect) => void
  onToggleMaximize: () => void
  onCollapse: () => void
  t: T
}

export function TerminalDockHeader(props: TerminalDockHeaderProps): ReactElement {
  const { scope, workspace, status, layout, placement, railVisible, t } = props
  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId)
  const compact = placement === 'right'
  const activePane = activeTab?.panes.find((pane) => pane.id === activeTab.focusedPaneId) ?? activeTab?.panes[0]
  const activeCwd = activePane ? status[ptySessionIdFor(scope.workspaceRoot, activePane)]?.cwd : undefined
  return (
    <div className="kun-terminal-header">
      {railVisible ? (
        <>
          <button type="button" className="kun-terminal-icon-button" data-active="true" aria-pressed="true" aria-label={t('termDockHideRail')} title={t('termDockHideRail')} onClick={props.onToggleRail}>
            <PanelLeft className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <div className="kun-terminal-header-title">
            <strong>{activeTab ? tabTitle(scope, activeTab, status, t) : t('termDockTitle')}</strong>
            {activeCwd ? <span>{activeCwd.replace(window.kunGui?.homeDir ?? '\u0000', '~')}</span> : null}
          </div>
        </>
      ) : compact ? (
        <div className="kun-terminal-header-title">
          <SessionPicker {...props} />
          <button type="button" className="kun-terminal-icon-button" aria-label={t('termDockNewShell')} title={t('termDockNewShell')} onClick={props.onNewShell}>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="kun-terminal-tabs" role="tablist" aria-label={t('termDockSessions')}>
          {workspace.tabs.map((tab) => (
            <TabButton key={tab.id} tab={tab} active={tab.id === workspace.activeTabId} {...props} />
          ))}
          {workspace.tabs.length ? <span className="kun-terminal-sep" /> : null}
          <NewButtons {...props} />
        </div>
      )}
      <div className="kun-terminal-actions">
        {placement === 'bottom' && !railVisible ? (
          <button type="button" className="kun-terminal-icon-button" aria-label={t('termDockShowRail')} title={t('termDockShowRail')} onClick={props.onToggleRail}>
            <List className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
        {railVisible ? <NewButtons {...props} /> : null}
        <button type="button" className="kun-terminal-icon-button" disabled={!props.canSplit} aria-label={t('termDockSplit')} title={withShortcut(t('termDockSplit'), dockShortcut('D'))} onClick={props.onSplit}>
          <Columns2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button type="button" className="kun-terminal-icon-button" data-active={props.findActive ? 'true' : undefined} disabled={!activeTab} aria-label={t('termDockFind')} title={withShortcut(t('termDockFind'), dockShortcut('F'))} onClick={props.onFind}>
          <Search className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button type="button" className="kun-terminal-icon-button" aria-label={t('termDockMore')} title={t('termDockMore')} onClick={(event) => props.onMore(event.currentTarget.getBoundingClientRect())}>
          <Ellipsis className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <span className="kun-terminal-sep" />
        {placement !== 'right' ? (
          <button type="button" className="kun-terminal-icon-button" data-active={layout.maximized ? 'true' : undefined} aria-label={layout.maximized ? t('termDockRestoreSize') : t('termDockMaximize')} title={withShortcut(layout.maximized ? t('termDockRestoreSize') : t('termDockMaximize'), dockShortcut('M', { shift: true }))} onClick={props.onToggleMaximize}>
            {layout.maximized ? <Minimize2 className="h-4 w-4" strokeWidth={1.8} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.8} />}
          </button>
        ) : null}
        <button type="button" className="kun-terminal-icon-button" aria-label={t('termDockCollapse')} title={withShortcut(t('termDockCollapse'), toggleTerminalShortcut())} onClick={props.onCollapse}>
          {placement === 'right' ? <X className="h-4 w-4" strokeWidth={1.8} /> : <ChevronDown className="h-4 w-4" strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  )
}

function NewButtons({ onNewShell, onNewMenu, workspace, t }: TerminalDockHeaderProps): ReactElement {
  const full = workspace.tabs.length >= 12
  return (
    <span className="kun-terminal-split-button">
      <button type="button" className="kun-terminal-icon-button" disabled={full} aria-label={t('termDockNewShell')} title={withShortcut(t('termDockNewShell'), dockShortcut('T'))} onClick={onNewShell}>
        <Plus className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <button type="button" className="kun-terminal-icon-button" disabled={full} aria-label={t('termDockNewMenu')} title={t('termDockNewMenu')} onClick={(event) => onNewMenu(event.currentTarget.getBoundingClientRect())}>
        <ChevronDown className="h-3 w-3" strokeWidth={1.9} />
      </button>
    </span>
  )
}

function TabButton({
  tab,
  active,
  scope,
  status,
  renamingTabId,
  onSelectTab,
  onCloseTab,
  onRename,
  onTabMenu,
  t
}: TerminalDockHeaderProps & { tab: TerminalTab; active: boolean }): ReactElement {
  const title = tabTitle(scope, tab, status, t)
  const renaming = renamingTabId === tab.id
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!renaming) return
    setValue(title)
    requestAnimationFrame(() => inputRef.current?.select())
    // The title at the moment renaming starts seeds the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming])
  const menu = (event: MouseEvent): void => {
    event.preventDefault()
    onTabMenu(tab, event.clientX, event.clientY)
  }
  return (
    <div className="kun-terminal-tab" data-active={active ? 'true' : 'false'} data-exited={tabExited(scope, tab, status) ? 'true' : undefined} onContextMenu={menu}>
      {renaming ? (
        <input
          ref={inputRef}
          className="kun-terminal-tab-rename"
          value={value}
          aria-label={t('termDockRename')}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => onRename(tab, value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRename(tab, value)
            else if (event.key === 'Escape') onRename(tab, null)
          }}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className="kun-terminal-tab-button"
          title={title}
          onClick={() => onSelectTab(tab.id)}
          onDoubleClick={() => onTabMenu(tab, -1, -1)}
        >
          <TerminalTargetIcon target={tab.panes[0]!.target} dot={tabDot(scope, tab, status)} />
          {tab.panes.length > 1 ? <Columns2 className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null}
          <span className="kun-terminal-tab-label">{title}</span>
        </button>
      )}
      {!renaming ? (
        <button type="button" className="kun-terminal-tab-close" aria-label={t('termDockCloseTab')} title={t('termDockCloseTab')} onClick={() => onCloseTab(tab)}>
          <X className="h-3 w-3" strokeWidth={1.9} />
        </button>
      ) : null}
    </div>
  )
}

function SessionPicker({ scope, workspace, status, onSelectTab, t }: TerminalDockHeaderProps): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeTabId)
  const active = workspace.tabs[index]
  const attention = strongestDot(workspace.tabs.filter((tab) => tab.id !== workspace.activeTabId).map((tab) => tabDot(scope, tab, status)))
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      <button type="button" className="kun-terminal-session-select" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {active ? <TerminalTargetIcon target={active.panes[0]!.target} dot={tabDot(scope, active, status)} size={14} /> : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active ? tabTitle(scope, active, status, t) : t('termDockTitle')}</span>
        {workspace.tabs.length > 1 ? <span style={{ color: 'var(--ds-text-muted)', fontWeight: 400 }}>{index + 1} / {workspace.tabs.length}</span> : null}
        {attention ? <span className="kun-terminal-status-dot" data-dot={attention} /> : null}
        <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.9} />
      </button>
      {open ? (
        <div className="kun-terminal-popover kun-terminal-menu" role="listbox" style={{ position: 'absolute', top: 32, left: 0 }}>
          {workspace.tabs.map((tab) => (
            <button key={tab.id} type="button" role="option" aria-selected={tab.id === workspace.activeTabId} className="kun-terminal-menu-item" data-active={tab.id === workspace.activeTabId ? 'true' : undefined} onClick={() => { onSelectTab(tab.id); setOpen(false) }}>
              <TerminalTargetIcon target={tab.panes[0]!.target} dot={tabDot(scope, tab, status)} />
              <span className="kun-terminal-menu-label">{tabTitle(scope, tab, status, t)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
