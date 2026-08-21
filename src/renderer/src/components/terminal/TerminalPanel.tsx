import type { ReactElement, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  TerminalSquare,
  Plus,
  RotateCw,
  Server,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS
} from '@shared/terminal'
import {
  defaultTerminalColors,
  type TerminalColorSettingsV1
} from '@shared/app-settings'
import type { RemoteSshHost } from '@shared/remote-ssh'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { terminalBackend } from './terminal-backend'
import { terminalSessionIdForWorkspace, terminalWorkspaceSessionKey } from './terminal-session'
import { TerminalTabContextMenu } from './TerminalTabContextMenu'
import {
  FIT_DEBOUNCE_MS,
  INITIAL_TAB_ID,
  MAX_RENDERER_TABS,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK,
  initialTerminalTabState,
  resolveTerminalTheme,
  type TerminalTab,
  type TerminalTabState,
  type TerminalTabContextMenu as TerminalTabContextMenuState
} from './terminal-panel-support'

type Props = {
  className?: string
  workspaceRoot: string
  onCollapse: () => void
  /** Fixed pixel height for the bottom-drawer layout. */
  height?: number
  active?: boolean
  embedded?: boolean
  onTitleChange?: (title: string) => void
}

export function TerminalPanel({
  className = '',
  workspaceRoot,
  onCollapse,
  height,
  active = true,
  embedded = false,
  onTitleChange
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const terminalBodyRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Guards against stale async after unmount or re-attach.
  const aliveRef = useRef(true)
  const attachTokenRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState(false)
  const [tabs, setTabs] = useState<TerminalTab[]>(() => initialTerminalTabState().tabs)
  const [activeTabId, setActiveTabId] = useState(() => initialTerminalTabState().activeTabId)
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenuState | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [terminalBackground, setTerminalBackground] = useState<string | null>(null)
  const [remoteHosts, setRemoteHosts] = useState<RemoteSshHost[]>([])
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const workspaceTabStatesRef = useRef<Record<string, TerminalTabState>>({})
  const workspaceKeyRef = useRef(terminalWorkspaceSessionKey(workspaceRoot))
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const workspaceKey = terminalWorkspaceSessionKey(workspaceRoot)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const [terminalColors, setTerminalColors] = useState<TerminalColorSettingsV1>(() => defaultTerminalColors())
  const terminalColorsRef = useRef(terminalColors)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  terminalColorsRef.current = terminalColors

  const resolvePanelTheme = useCallback((colors: TerminalColorSettingsV1) => {
    const surfaceSource = terminalBodyRef.current?.parentElement ?? containerRef.current
    return resolveTerminalTheme(surfaceSource, colors)
  }, [])

  // Load terminal color settings from the main process and keep them in
  // sync when settings change while the panel is open. The ref lets
  // attachTerminal and the MutationObserver read the latest colors without
  // stale-closure issues.
  useEffect(() => {
    let cancelled = false
    const apply = (settings: { terminal?: { colors: TerminalColorSettingsV1 } }): void => {
      if (cancelled) return
      const colors = settings?.terminal?.colors
      if (colors) setTerminalColors(colors)
    }
    void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<{ terminal?: { colors: TerminalColorSettingsV1 } }>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  // Apply new colors to the live xterm instance without re-attaching.
  useEffect(() => {
    const term = termRef.current
    if (!containerRef.current) return
    const theme = resolvePanelTheme(terminalColors)
    setTerminalBackground(theme.background)
    if (!term) return
    term.options.theme = theme
  }, [resolvePanelTheme, terminalColors])

  const getTabTitle = useCallback((tab: TerminalTab): string => {
    if (tab.title?.trim()) return tab.title.trim()
    return tab.target.kind === 'ssh'
      ? `SSH · ${tab.target.hostName}`
      : t('terminalTabTitle', { index: tab.index })
  }, [t])

  useEffect(() => {
    void window.kunGui.listRemoteSshHosts().then(setRemoteHosts).catch(() => setRemoteHosts([]))
  }, [])

  useEffect(() => {
    if (activeTab) onTitleChange?.(getTabTitle(activeTab))
  }, [activeTab, getTabTitle, onTitleChange])

  useLayoutEffect(() => {
    if (!active) return
    window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* wait for the visible panel to become measurable */
      }
    })
  }, [active])

  useLayoutEffect(() => {
    const previousKey = workspaceKeyRef.current
    if (previousKey === workspaceKey) return
    workspaceTabStatesRef.current[previousKey] = {
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current
    }
    const next = workspaceTabStatesRef.current[workspaceKey] ?? initialTerminalTabState()
    const nextActiveId = next.tabs.some((tab) => tab.id === next.activeTabId)
      ? next.activeTabId
      : (next.tabs[0]?.id ?? INITIAL_TAB_ID)
    workspaceKeyRef.current = workspaceKey
    setTabs(next.tabs.length > 0 ? next.tabs : initialTerminalTabState().tabs)
    setActiveTabId(nextActiveId)
    setContextMenu(null)
    setRenamingTabId(null)
    setRenameValue('')
  }, [workspaceKey])

  const disposeRenderer = useCallback(() => {
    const term = termRef.current
    const disposer = (term as Terminal & { __dispose?: () => void } | null)?.__dispose
    disposer?.()
    term?.dispose()
    termRef.current = null
    fitRef.current = null
    const container = containerRef.current
    if (container) container.replaceChildren()
  }, [])

  // (Re)create the xterm instance and wire it to a persistent PTY session.
  // On unmount we dispose only the xterm renderer; the underlying PTY stays
  // alive in the main process so toggling the panel preserves shell state
  // and replays recent output from the ring buffer on re-attach.
  const sessionIdForTab = useCallback((tab: TerminalTab): string => {
    return terminalSessionIdForWorkspace(workspaceRoot, tab.id, tab.target)
  }, [workspaceRoot])

  const attachTerminal = useCallback(async (tab: TerminalTab) => {
    const sessionId = sessionIdForTab(tab)
    const backend = terminalBackend(tab.target)
    const attachToken = ++attachTokenRef.current
    const isCurrentAttach = (): boolean => aliveRef.current && attachTokenRef.current === attachToken
    const container = containerRef.current
    if (!container || !isCurrentAttach()) return
    container.replaceChildren()
    setError(null)
    setExited(false)

    const cols = fitRef.current?.proposeDimensions()?.cols ?? TERMINAL_DEFAULT_COLS
    const rows = fitRef.current?.proposeDimensions()?.rows ?? TERMINAL_DEFAULT_ROWS

    const theme = resolvePanelTheme(terminalColorsRef.current)
    setTerminalBackground(theme.background)

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true,
      theme,
      cols,
      rows
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    // The container may still be settling (lazy Suspense); defer the first
    // fit to the next frame so clientWidth is correct.
    requestAnimationFrame(() => {
      if (!isCurrentAttach()) return
      try {
        fit.fit()
      } catch {
        /* ignore until the element has a measurable size */
      }
    })

    // Stream PTY output → xterm.
    const offData = backend.onData((payload) => {
      if (payload.sessionId !== sessionId) return
      term.write(payload.data)
    })
    const offExit = backend.onExit((payload) => {
      if (payload.sessionId !== sessionId) return
      setExited(true)
    })

    // xterm input → PTY.
    const disposable = term.onData((data) => {
      void backend.write({
        sessionId,
        data
      })
    })

    // Keep cols/rows in sync with the panel width.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const triggerFit = (): void => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!isCurrentAttach()) return
        try {
          fit.fit()
        } catch {
          /* ignore */
        }
      }, FIT_DEBOUNCE_MS)
    }
    const resizeObserver = new ResizeObserver(triggerFit)
    resizeObserver.observe(container)
    const onDimensionChange = (dim: { cols: number; rows: number }): void => {
      void backend.resize({
        sessionId,
        cols: dim.cols,
        rows: dim.rows
      })
    }
    const fitDisposable = term.onResize(onDimensionChange)

    // Create (or re-attach to) the PTY session. On re-attach the main process
    // replays the ring buffer before new output arrives.
    try {
      let result = await backend.create({
        sessionId,
        cwd: tab.target.kind === 'local' ? (workspaceRoot || undefined) : undefined,
        cols,
        rows
      })
      if (!result.ok && 'reason' in result && result.reason === 'hostKeyConfirmationRequired') {
        const accepted = window.confirm(`Trust SSH host key?\n\n${result.fingerprint}`)
        if (accepted) {
          await window.kunGui.confirmRemoteSshHostKey(result)
          result = await backend.create({ sessionId, cols, rows })
        }
      }
      if (!isCurrentAttach()) return
      if (!result.ok) {
        setError('message' in result ? result.message : 'SSH host key was not trusted.')
        return
      }
      // After a successful (re)attach, reflect the latest fit so the PTY
      // matches the visible grid.
      const dims = fit.proposeDimensions()
      if (dims) {
        void backend.resize({
          sessionId,
          cols: dims.cols,
          rows: dims.rows
        })
      }
      setExited(false)
    } catch (e) {
      if (!isCurrentAttach()) return
      setError(e instanceof Error ? e.message : String(e))
    }

    // Stash disposers on the instance for teardown.
    ;(term as Terminal & { __dispose?: () => void }).__dispose = () => {
      offData()
      offExit()
      disposable.dispose()
      fitDisposable.dispose()
      resizeObserver.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [resolvePanelTheme, sessionIdForTab, workspaceRoot])

  useEffect(() => {
    aliveRef.current = true
    if (activeTab) void attachTerminal(activeTab)
    return () => {
      aliveRef.current = false
      attachTokenRef.current += 1
      disposeRenderer()
    }
  }, [activeTab, attachTerminal, disposeRenderer])

  // React to system/app theme changes so the terminal follows light/dark.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const term = termRef.current
      if (!containerRef.current) return
      const theme = resolvePanelTheme(terminalColorsRef.current)
      setTerminalBackground(theme.background)
      if (!term) return
      term.options.theme = theme
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [resolvePanelTheme])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!renamingTabId) return
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [renamingTabId])

  const createTab = useCallback((target: TerminalTab['target']) => {
    if (tabs.length >= MAX_RENDERER_TABS) return
    const nextIndex = tabs.length + 1
    const tab: TerminalTab = {
      id: `tab-${Date.now().toString(36)}-${nextIndex}`,
      index: nextIndex,
      target
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setNewTabMenuOpen(false)
  }, [tabs.length])

  const handleNewTab = useCallback(() => {
    createTab({ kind: 'local' })
  }, [createTab])

  const handleCloseTab = useCallback((tabId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId)
    const closingTab = tabs[closingIndex]
    if (closingIndex === -1 || !closingTab) return
    void terminalBackend(closingTab.target).dispose(sessionIdForTab(closingTab))
    setTabs((current) => {
      if (current.length <= 1) return current
      return current.filter((tab) => tab.id !== tabId)
    })
    if (activeTabId === tabId) {
      const nextTab = tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? tabs[0]
      if (nextTab && nextTab.id !== tabId) setActiveTabId(nextTab.id)
    }
  }, [activeTabId, sessionIdForTab, tabs])

  const openTabContextMenu = useCallback((event: ReactMouseEvent | ReactPointerEvent, tabId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const tabButton = tabButtonRefs.current[tabId]
    const tabRect = tabButton?.getBoundingClientRect()
    const pointerX = event.clientX > 0 ? event.clientX : (tabRect?.left ?? 0)
    const pointerY = event.clientY > 0 ? event.clientY : (tabRect?.bottom ?? 0)
    setActiveTabId(tabId)
    setContextMenu({
      tabId,
      x: Math.min(Math.max(pointerX, 8), window.innerWidth - 220),
      y: Math.min(Math.max(pointerY, 8), window.innerHeight - 132)
    })
  }, [])

  const openActiveTabContextMenu = useCallback((event: ReactMouseEvent) => {
    if (!activeTab) return
    openTabContextMenu(event, activeTab.id)
  }, [activeTab, openTabContextMenu])

  const openTabContextMenuOnSecondaryPointer = useCallback((event: ReactPointerEvent, tabId: string) => {
    if (event.button !== 2) return
    openTabContextMenu(event, tabId)
  }, [openTabContextMenu])

  const openActiveTabContextMenuOnSecondaryPointer = useCallback((event: ReactPointerEvent) => {
    if (!activeTab || event.button !== 2) return
    openTabContextMenu(event, activeTab.id)
  }, [activeTab, openTabContextMenu])

  const startRenameTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab) return
    setContextMenu(null)
    setRenamingTabId(tabId)
    setRenameValue(getTabTitle(tab))
  }, [getTabTitle, tabs])

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return
    const nextTitle = renameValue.trim()
    setTabs((current) =>
      current.map((tab) => (tab.id === renamingTabId ? { ...tab, title: nextTitle || undefined } : tab))
    )
    setRenamingTabId(null)
    setRenameValue('')
  }, [renameValue, renamingTabId])

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null)
    setRenameValue('')
  }, [])

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    const keptTab = tabs.find((tab) => tab.id === tabId)
    if (!keptTab) return
    for (const tab of tabs) {
      if (tab.id !== tabId) void terminalBackend(tab.target).dispose(sessionIdForTab(tab))
    }
    setTabs([keptTab])
    setActiveTabId(tabId)
    setContextMenu(null)
    if (renamingTabId && renamingTabId !== tabId) cancelRenameTab()
  }, [cancelRenameTab, renamingTabId, sessionIdForTab, tabs])

  const handleCloseAllTabs = useCallback(() => {
    for (const tab of tabs) {
      void terminalBackend(tab.target).dispose(sessionIdForTab(tab))
    }
    setContextMenu(null)
    cancelRenameTab()
    const next = initialTerminalTabState()
    setTabs(next.tabs)
    setActiveTabId(next.activeTabId)
    onCollapse()
  }, [cancelRenameTab, onCollapse, sessionIdForTab, tabs])

  const handleRestart = useCallback(async () => {
    if (!activeTab) return
    // Dispose the old shell then re-attach so a fresh one spawns.
    try {
      await terminalBackend(activeTab.target).dispose(sessionIdForTab(activeTab))
    } catch {
      /* ignore */
    }
    setError(null)
    setExited(false)
    disposeRenderer()
    aliveRef.current = true
    void attachTerminal(activeTab)
  }, [activeTab, attachTerminal, disposeRenderer, sessionIdForTab])

  return (
    <aside
      className={`ds-no-drag ds-surface-strong flex min-h-0 flex-col overflow-hidden text-ds-ink dark:bg-[rgba(21,29,49,0.98)] ${
        embedded ? '' : 'border-t border-ds-border-muted shadow-[0_-18px_60px_rgba(20,47,95,0.08)] dark:shadow-[0_-24px_70px_rgba(2,6,16,0.2)]'
      } ${className}`}
      style={height ? { height } : undefined}
    >
      <div className="flex h-11 shrink-0 items-center border-b border-ds-border-muted bg-ds-card/92 text-ds-ink backdrop-blur-xl dark:bg-[rgba(24,33,54,0.92)]">
        <div
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-3 pt-2"
          role="tablist"
          aria-label={t('terminalPanelTitle')}
          onPointerDownCapture={openActiveTabContextMenuOnSecondaryPointer}
          onContextMenu={openActiveTabContextMenu}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={`group flex h-8 max-w-[220px] shrink-0 items-center rounded-t-[10px] text-[13px] font-medium transition ${
                  active
                    ? 'ds-surface-strong border border-b-transparent border-ds-border-muted text-ds-ink shadow-sm dark:bg-[rgba(38,49,76,0.96)]'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
                onContextMenu={(event) => openTabContextMenu(event, tab.id)}
              >
                {renamingTabId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={commitRenameTab}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRenameTab()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRenameTab()
                      }
                    }}
                    className="mx-2 min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-card px-2 py-1 text-[12px] text-ds-ink outline-none focus:border-accent"
                    aria-label={t('terminalRenameTab')}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    ref={(node) => {
                      tabButtonRefs.current[tab.id] = node
                    }}
                    aria-selected={active}
                    onClick={() => setActiveTabId(tab.id)}
                    onPointerDownCapture={(event) => openTabContextMenuOnSecondaryPointer(event, tab.id)}
                    onContextMenu={(event) => openTabContextMenu(event, tab.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  >
                    {tab.target.kind === 'ssh'
                      ? <Server className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      : <TerminalSquare className="h-4 w-4 shrink-0" strokeWidth={1.8} />}
                    <span className="truncate">{getTabTitle(tab)}</span>
                  </button>
                )}
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('terminalCloseTab')}
                    title={t('terminalCloseTab')}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTab(tab.id)
                    }}
                    className="mr-2 rounded-full p-0.5 text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            )
          })}
          <div className="relative mb-1 shrink-0">
            <button
              type="button"
              onClick={() => setNewTabMenuOpen((open) => !open)}
              disabled={tabs.length >= MAX_RENDERER_TABS}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('terminalNewTab')}
              aria-expanded={newTabMenuOpen}
              title={t('terminalNewTab')}
            >
              <Plus className="h-4 w-4" strokeWidth={1.8} />
            </button>
            {newTabMenuOpen ? (
              <div className="absolute bottom-9 left-0 z-50 min-w-56 rounded-xl border border-ds-border bg-ds-card p-1.5 text-[12px] shadow-xl">
                <button type="button" onClick={handleNewTab} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-ds-ink hover:bg-ds-hover">
                  <TerminalSquare className="h-4 w-4" />
                  {t('terminalNewLocalTab', { defaultValue: 'Local terminal' })}
                </button>
                {remoteHosts.map((host) => (
                  <button
                    key={host.id}
                    type="button"
                    onClick={() => createTab({ kind: 'ssh', hostId: host.id, hostName: host.label })}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <Server className="h-4 w-4" />
                    <span className="min-w-0"><span className="block truncate">SSH · {host.label}</span><span className="block truncate text-[10px] text-ds-muted">{host.username}@{host.hostname}</span></span>
                  </button>
                ))}
                {remoteHosts.length === 0 ? <p className="px-3 py-2 text-ds-muted">{t('terminalNoSshServers', { defaultValue: 'Add an SSH server in Terminal settings.' })}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 px-3">
          <button
            type="button"
            onClick={() => void handleRestart()}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('terminalRestart')}
            title={t('terminalRestart')}
          >
            <RotateCw className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
        {contextMenu ? (
          createPortal(
            <TerminalTabContextMenu
              state={contextMenu}
              tabCount={tabs.length}
              onRename={() => startRenameTab(contextMenu.tabId)}
              onCloseOthers={() => handleCloseOtherTabs(contextMenu.tabId)}
              onCloseAll={handleCloseAllTabs}
              t={t}
            />,
            document.body
          )
        ) : null}
      </div>

      <div
        ref={terminalBodyRef}
        className="ds-surface-strong relative min-h-0 flex-1 overflow-hidden px-5 py-4 dark:bg-[rgba(21,29,49,0.98)]"
        style={terminalBackground ? { backgroundColor: terminalBackground } : undefined}
      >
        <div ref={containerRef} className="h-full w-full" key={activeTab?.id} />
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div>
              <div className="text-[13px] font-semibold text-red-400">{t('terminalUnavailable')}</div>
              <div className="mt-2 max-w-sm text-[12px] leading-5 text-zinc-400">{error}</div>
              <button
                type="button"
                onClick={() => void handleRestart()}
                className="mt-4 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-white/20"
              >
                {t('terminalRestart')}
              </button>
            </div>
          </div>
        ) : null}
        {exited && !error ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => void handleRestart()}
              className="pointer-events-auto rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg backdrop-blur transition hover:bg-white/20"
            >
              {t('terminalExitMessage')}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
