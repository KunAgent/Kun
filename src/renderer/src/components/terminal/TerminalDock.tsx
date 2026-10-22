import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import './terminal-dock.css'
import { useChatStore } from '../../store/chat-store'
import { saveSettingsPatch } from './terminal-settings-save'
import { terminalWorkspaceSessionKey } from './terminal-session'
import { openTerminal, useTerminalOpenRequests } from './terminal-open'
import {
  emptyWorkspaceTerminals,
  freshPane,
  TERMINAL_RIGHT_WIDTH,
  type TerminalPane,
  type TerminalTab
} from './terminal-dock-model'
import {
  focusTerminalPane,
  hasWorkspaceTerminals,
  renameTerminalPane,
  seedWorkspace,
  setActiveTerminalTab,
  setDockLayout,
  useTerminalDockStore
} from './terminal-dock-store'
import {
  closePane,
  openAgent,
  openAgentLogin,
  openLocalShell,
  openScript,
  openSshShell,
  paneIsBusy,
  ptySessionIdFor,
  reopenClosedPane,
  type DockScope
} from './terminal-dock-actions'
import { clearTerminal, restartTerminal, terminalInstance, writeToTerminal } from './terminal-instance-registry'
import { useTerminalDockRuntime } from './useTerminalDockRuntime'
import { TerminalDockHeader, tabTitle, type DockPlacement } from './TerminalDockHeader'
import { TerminalPaneView } from './TerminalPaneView'
import { TerminalSessionRail } from './TerminalSessionRail'
import { TerminalNewMenu } from './TerminalNewMenu'
import { TerminalCloseConfirm, TerminalEmptyState, TerminalMoreMenu, TerminalTabMenu, type FloatingAnchor } from './TerminalMenus'

type DockMenu =
  | { kind: 'new'; anchor: DOMRect; split?: boolean }
  | { kind: 'more'; anchor: FloatingAnchor }
  | { kind: 'tab'; tabId: string; anchor: FloatingAnchor }

type CloseRequest = { entries: Array<{ tabId: string; pane: TerminalPane; title: string }>; title: string }

const RAIL_MIN_WIDTH = 720

export type TerminalDockProps = {
  workspaceRoot: string
  placement: DockPlacement
  /** Fixed height (bottom/ADE placement, not maximized). */
  height?: number
  onCollapse: () => void
  onBeginResize?: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function TerminalDock({ workspaceRoot, placement, height, onCollapse, onBeginResize }: TerminalDockProps): ReactElement {
  const { t } = useTranslation('common')
  const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string
  const rootRef = useRef<HTMLElement | null>(null)
  const workspaceKey = terminalWorkspaceSessionKey(workspaceRoot)
  const scope = useMemo<DockScope>(() => ({ workspaceRoot, workspaceKey }), [workspaceKey, workspaceRoot])
  const workspace = useTerminalDockStore((state) => state.workspaces[workspaceKey]) ?? emptyWorkspaceTerminals()
  const status = useTerminalDockStore((state) => state.status)
  const layout = useTerminalDockStore((state) => state.layout)
  const settings = useTerminalDockRuntime({ rootRef, workspaceRoot, workspaceKey, t: tr })
  const [menu, setMenu] = useState<DockMenu | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null)
  const [findRequest, setFindRequest] = useState<{ paneId: string; seq: number; query?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dockWidth, setDockWidth] = useState(0)

  useEffect(() => {
    if (!hasWorkspaceTerminals(workspaceKey)) seedWorkspace(workspaceKey, freshPane({ kind: 'local' }))
  }, [workspaceKey])
  useTerminalOpenRequests(workspaceKey)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(([entry]) => setDockWidth(entry?.contentRect.width ?? 0))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2_600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0]
  const focusedPane = activeTab?.panes.find((pane) => pane.id === activeTab.focusedPaneId) ?? activeTab?.panes[0]
  const focusedId = focusedPane ? ptySessionIdFor(workspaceRoot, focusedPane) : null
  const railVisible = placement === 'bottom' && layout.railOpen && dockWidth >= RAIL_MIN_WIDTH
  const canSplit = Boolean(activeTab && activeTab.panes.length < 2 && focusedPane?.target.kind !== 'kun-process')

  const closeNow = useCallback((entries: CloseRequest['entries']) => {
    for (const entry of entries) closePane(scope, entry.tabId, entry.pane, entry.title)
  }, [scope])

  const requestClose = useCallback(async (entries: CloseRequest['entries']) => {
    if (!entries.length) return
    if (settings.behavior.confirmClose) {
      const busy = await Promise.all(entries.map((entry) => paneIsBusy(workspaceRoot, entry.pane)))
      if (busy.some(Boolean)) {
        setCloseRequest({ entries, title: entries[0]!.title })
        return
      }
    }
    closeNow(entries)
  }, [closeNow, settings.behavior.confirmClose, workspaceRoot])

  const entriesForTab = (tab: TerminalTab) => tab.panes.map((pane) => ({
    tabId: tab.id,
    pane,
    title: tabTitle(scope, { ...tab, panes: [pane] }, status, tr)
  }))

  const newShell = (): void => {
    if (!openLocalShell(scope)) setNotice(tr('termDockTooManyTabs'))
  }
  const split = (): void => {
    if (activeTab && canSplit) openLocalShell(scope, { kind: 'split', tabId: activeTab.id })
  }
  const openFind = (query?: string): void => {
    if (focusedPane) setFindRequest((current) => ({ paneId: focusedPane.id, seq: (current?.seq ?? 0) + 1, query }))
  }
  const toggleMaximize = (): void => setDockLayout({ maximized: !layout.maximized })

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const mac = window.kunGui?.platform === 'darwin'
    const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey
    if (!mod || event.altKey) return
    const key = event.key.toLowerCase()
    const handled = (() => {
      if (key === 'f') { openFind(); return true }
      if (key === 'k' && mac && !event.shiftKey) { if (focusedId) clearTerminal(focusedId); return true }
      if (key === 'd' && !event.shiftKey) { split(); return true }
      if (key === 't' && !(mac && event.shiftKey)) { newShell(); return true }
      if (key === 'm' && event.shiftKey) { toggleMaximize(); return true }
      if (/^[1-9]$/.test(key)) {
        const tab = workspace.tabs[Number(key) - 1]
        if (tab) setActiveTerminalTab(workspaceKey, tab.id)
        return true
      }
      if ((key === 'arrowup' || key === 'arrowdown') && focusedId) {
        terminalInstance(focusedId)?.commands?.jump(key === 'arrowup' ? 'previous' : 'next')
        return true
      }
      return false
    })()
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const beginWidthResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = layout.rightWidth
    const onMove = (move: PointerEvent): void => {
      const next = Math.min(TERMINAL_RIGHT_WIDTH.max, Math.max(TERMINAL_RIGHT_WIDTH.min, startWidth + startX - move.clientX))
      setDockLayout({ rightWidth: next })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const style = placement === 'right'
    ? { width: layout.rightWidth, flex: '1 1 auto', minHeight: 0 }
    : layout.maximized ? { flex: 1, minHeight: 0 } : height ? { height } : undefined

  return (
    <section
      ref={rootRef}
      className="kun-terminal-dock ds-no-drag"
      data-position={placement === 'right' ? 'right' : 'bottom'}
      data-maximized={layout.maximized && placement !== 'right' ? 'true' : 'false'}
      data-terminal-dock
      aria-label={tr('termDockTitle')}
      style={style}
      onKeyDown={onKeyDown}
    >
      {placement === 'right'
        ? <div className="kun-terminal-resize" data-axis="x" role="separator" aria-orientation="vertical" onPointerDown={beginWidthResize} />
        : !layout.maximized && onBeginResize
          ? <div className="kun-terminal-resize" role="separator" aria-orientation="horizontal" onPointerDown={onBeginResize} />
          : null}
      <TerminalDockHeader
        scope={scope}
        workspace={workspace}
        status={status}
        layout={layout}
        placement={placement}
        railVisible={railVisible}
        renamingTabId={renamingTabId}
        canSplit={canSplit}
        findActive={Boolean(findRequest && findRequest.paneId === focusedPane?.id)}
        onSelectTab={(tabId) => setActiveTerminalTab(workspaceKey, tabId)}
        onCloseTab={(tab) => void requestClose(entriesForTab(tab))}
        onRename={(tab, title) => {
          setRenamingTabId(null)
          const pane = tab.panes.find((candidate) => candidate.id === tab.focusedPaneId) ?? tab.panes[0]
          if (title !== null && pane) renameTerminalPane(workspaceKey, tab.id, pane.id, title)
        }}
        onTabMenu={(tab, x, y) => {
          if (x < 0) {
            setRenamingTabId(tab.id)
            return
          }
          setActiveTerminalTab(workspaceKey, tab.id)
          setMenu({ kind: 'tab', tabId: tab.id, anchor: { x, y } })
        }}
        onNewShell={newShell}
        onNewMenu={(anchor) => setMenu({ kind: 'new', anchor })}
        onToggleRail={() => setDockLayout({ railOpen: !layout.railOpen })}
        onSplit={split}
        onFind={() => openFind()}
        onMore={(anchor) => setMenu({ kind: 'more', anchor: { x: anchor.right, y: anchor.bottom + 6, alignRight: true } })}
        onToggleMaximize={toggleMaximize}
        onCollapse={() => {
          if (layout.maximized) setDockLayout({ maximized: false })
          onCollapse()
        }}
        t={tr}
      />
      <div className="kun-terminal-body">
        {railVisible ? (
          <TerminalSessionRail
            scope={scope}
            workspace={workspace}
            status={status}
            onSelect={(tabId) => setActiveTerminalTab(workspaceKey, tabId)}
            onNew={(anchor) => setMenu({ kind: 'new', anchor })}
            onReopen={(paneId) => reopenClosedPane(scope, paneId)}
            t={tr}
          />
        ) : null}
        {workspace.tabs.length ? (
          <div className="kun-terminal-panes">
            {workspace.tabs.flatMap((tab) => tab.panes.map((pane, index) => {
              const visible = tab.id === activeTab?.id
              const focused = visible && pane.id === focusedPane?.id
              return (
                <PaneSlot key={pane.id} visible={visible} divider={visible && index > 0}>
                  <TerminalPaneView
                    scope={scope}
                    pane={pane}
                    focused={focused}
                    showHeader={tab.panes.length > 1}
                    visible={visible}
                    restore={settings.behavior.restoreSessions && !pane.fresh}
                    findRequest={findRequest?.paneId === pane.id ? findRequest : null}
                    onCloseFind={() => setFindRequest(null)}
                    onFocus={() => { if (tab.focusedPaneId !== pane.id) focusTerminalPane(workspaceKey, tab.id, pane.id) }}
                    onClose={() => void requestClose([{ tabId: tab.id, pane, title: tabTitle(scope, { ...tab, panes: [pane] }, status, tr) }])}
                    onNotify={setNotice}
                    t={tr}
                  />
                </PaneSlot>
              )
            }))}
          </div>
        ) : (
          <TerminalEmptyState
            closed={workspace.closed}
            onNewShell={newShell}
            onNewMenu={(anchor) => setMenu({ kind: 'new', anchor })}
            onReopen={(paneId) => reopenClosedPane(scope, paneId)}
            t={tr}
          />
        )}
      </div>
      {notice ? <div className="kun-terminal-popover" role="status" style={{ position: 'absolute', right: 12, top: 48, zIndex: 8, padding: '7px 12px', fontSize: 12.5 }}>{notice}</div> : null}
      {menu?.kind === 'new' ? createPortal(
        <TerminalNewMenu
          anchor={menu.anchor}
          workspaceRoot={workspaceRoot}
          settings={settings}
          onClose={() => setMenu(null)}
          actions={{
            onLocal: newShell,
            onShell: (shell) => openLocalShell(scope, undefined, { shell }),
            onSsh: (host) => openSshShell(scope, host),
            onAgent: (entry, options) => openAgent(scope, entry, options),
            onAgentLogin: (entry) => openAgentLogin(scope, entry),
            onScript: (scripts, name) => openScript(scope, scripts.manager, name),
            onShowProcess: (process) => openTerminal({ kunProcess: { id: process.id, command: process.command, threadId: process.threadId } }),
            onManageAgents: () => useChatStore.getState().openSettings('terminal'),
            onTerminalSettings: () => useChatStore.getState().openSettings('terminal'),
            onAddSsh: () => useChatStore.getState().openSettings('terminal')
          }}
          t={tr}
        />,
        document.body
      ) : null}
      {menu?.kind === 'more' ? createPortal(
        <TerminalMoreMenu
          anchor={menu.anchor}
          position={placement === 'right' ? 'right' : 'bottom'}
          hasSession={Boolean(focusedId)}
          canInterrupt={Boolean(focusedPane && focusedPane.target.kind !== 'kun-process')}
          closed={workspace.closed}
          cwd={focusedId ? status[focusedId]?.cwd ?? workspaceRoot : undefined}
          onClear={() => focusedId && clearTerminal(focusedId)}
          onRename={() => activeTab && setRenamingTabId(activeTab.id)}
          onRestart={() => focusedId && void restartTerminal(focusedId)}
          onInterrupt={() => focusedId && writeToTerminal(focusedId, '\x03')}
          onCopyId={() => focusedId && void navigator.clipboard.writeText(focusedId).catch(() => undefined)}
          onDock={(position) => setDockLayout({ position, maximized: false })}
          onOpenSystem={() => {
            const cwd = (focusedId && status[focusedId]?.cwd) || workspaceRoot
            void window.kunGui.openSystemTerminal?.(cwd).then((ok) => { if (!ok) setNotice(tr('termDockOpenSystemFailed')) })
          }}
          onReopen={(paneId) => reopenClosedPane(scope, paneId)}
          onSettings={() => useChatStore.getState().openSettings('terminal')}
          onClose={() => setMenu(null)}
          t={tr}
        />,
        document.body
      ) : null}
      {menu?.kind === 'tab' ? createPortal((() => {
        const tab = workspace.tabs.find((candidate) => candidate.id === menu.tabId)
        if (!tab) return null
        return (
          <TerminalTabMenu
            anchor={menu.anchor}
            canSplit={tab.panes.length < 2 && tab.panes[0]?.target.kind !== 'kun-process'}
            tabCount={workspace.tabs.length}
            onRename={() => setRenamingTabId(tab.id)}
            onSplit={() => openLocalShell(scope, { kind: 'split', tabId: tab.id })}
            onCloseOthers={() => void requestClose(workspace.tabs.filter((candidate) => candidate.id !== tab.id).flatMap(entriesForTab))}
            onCloseAll={() => void requestClose(workspace.tabs.flatMap(entriesForTab))}
            onClose={() => setMenu(null)}
            t={tr}
          />
        )
      })(), document.body) : null}
      {closeRequest ? createPortal(
        <TerminalCloseConfirm
          title={closeRequest.title}
          count={closeRequest.entries.length}
          onCancel={() => setCloseRequest(null)}
          onConfirm={(dontAsk) => {
            closeNow(closeRequest.entries)
            setCloseRequest(null)
            if (dontAsk) saveSettingsPatch({ behavior: { confirmClose: false } })
          }}
          t={tr}
        />,
        document.body
      ) : null}
    </section>
  )
}

/** Keeps hidden panes mounted (their instances stay attached) without layout. */
function PaneSlot({ visible, divider, children }: { visible: boolean; divider: boolean; children: ReactElement }): ReactElement {
  return (
    <>
      {divider ? <span className="kun-terminal-pane-divider" /> : null}
      <div style={{ display: visible ? 'flex' : 'none', minWidth: 0, minHeight: 0, flex: 1 }}>{children}</div>
    </>
  )
}
