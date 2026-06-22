import type { ReactElement, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  TerminalSquare,
  Plus,
  RotateCw,
  X,
  PencilLine,
  PanelRightClose,
  PanelsTopLeft
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
  resolveTerminalTheme as resolveTerminalThemeFromSettings,
  TERMINAL_PRESET_DARK,
  TERMINAL_PRESET_LIGHT,
  type TerminalColorSettingsV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { terminalSessionIdForWorkspace, terminalWorkspaceSessionKey } from './terminal-session'

type Props = {
  className?: string
  workspaceRoot: string
  onCollapse: () => void
  /** Fixed pixel height for the bottom-drawer layout. */
  height?: number
}

type TerminalTab = {
  id: string
  index: number
  title?: string
}

type TerminalTabContextMenu = {
  tabId: string
  x: number
  y: number
}

type TerminalTabState = {
  tabs: TerminalTab[]
  activeTabId: string
}

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

// Monospace stack matches the editor's preference and falls back to a
// platform-appropriate default (Menlo on macOS, Consolas on Windows).
const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
const TERMINAL_FONT_SIZE = 13
const TERMINAL_SCROLLBACK = 5000
const FIT_DEBOUNCE_MS = 80
const INITIAL_TAB_ID = 'main'
const MAX_RENDERER_TABS = 8

function initialTerminalTabState(): TerminalTabState {
  return {
    tabs: [{ id: INITIAL_TAB_ID, index: 1 }],
    activeTabId: INITIAL_TAB_ID
  }
}

function resolveThemeMode(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function isTransparentColor(color: string): boolean {
  return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
}

function parseCssColor(color: string): RgbaColor | null {
  if (isTransparentColor(color)) return { r: 0, g: 0, b: 0, a: 0 }
  const match = color.match(/^rgba?\((.+)\)$/)
  if (!match) return null
  const normalized = match[1].replace(/\s*\/\s*/, ', ')
  const parts = normalized.includes(',')
    ? normalized.split(',').map((part) => part.trim())
    : normalized.trim().split(/\s+/)
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part))
  const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
  if (![r, g, b, alpha].every(Number.isFinite)) return null
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
    a: Math.min(1, Math.max(0, alpha))
  }
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  }
}

function toOpaqueRgb(color: RgbaColor): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

function resolveTerminalSurfaceColor(container: HTMLElement | null): string {
  const layers: RgbaColor[] = []
  let node: HTMLElement | null = container
  while (node) {
    const color = parseCssColor(getComputedStyle(node).backgroundColor)
    if (color && color.a > 0) layers.push(color)
    if (color && color.a >= 1) break
    node = node.parentElement
  }
  const fallback = parseCssColor(resolveThemeMode() === 'light' ? TERMINAL_PRESET_LIGHT.background : TERMINAL_PRESET_DARK.background) ?? {
    r: 255,
    g: 255,
    b: 255,
    a: 1
  }
  const resolved = layers.reduceRight((background, foreground) => compositeColor(foreground, background), fallback)
  return toOpaqueRgb(resolved)
}

function resolveTerminalTheme(
  container: HTMLElement | null,
  colors: TerminalColorSettingsV1
) {
  const surfaceColor = resolveTerminalSurfaceColor(container)
  const mode = resolveThemeMode()
  return resolveTerminalThemeFromSettings(colors, mode, surfaceColor)
}

export function TerminalPanel({ className = '', workspaceRoot, onCollapse, height }: Props): ReactElement {
  const { t } = useTranslation('common')
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
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenu | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
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
    const container = containerRef.current
    if (!term || !container) return
    term.options.theme = resolveTerminalTheme(container, terminalColors)
  }, [terminalColors])

  const getTabTitle = useCallback((tab: TerminalTab): string => {
    return tab.title?.trim() || t('terminalTabTitle', { index: tab.index })
  }, [t])

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
  const sessionIdForTab = useCallback((tabId: string): string => {
    return terminalSessionIdForWorkspace(workspaceRoot, tabId)
  }, [workspaceRoot])

  const attachTerminal = useCallback(async (tabId: string) => {
    const sessionId = sessionIdForTab(tabId)
    const attachToken = ++attachTokenRef.current
    const isCurrentAttach = (): boolean => aliveRef.current && attachTokenRef.current === attachToken
    const container = containerRef.current
    if (!container || !isCurrentAttach()) return
    container.replaceChildren()
    setError(null)
    setExited(false)

    const cols = fitRef.current?.proposeDimensions()?.cols ?? TERMINAL_DEFAULT_COLS
    const rows = fitRef.current?.proposeDimensions()?.rows ?? TERMINAL_DEFAULT_ROWS

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true,
      theme: resolveTerminalTheme(container, terminalColorsRef.current),
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
    const offData = window.kunGui.onTerminalData((payload) => {
      if (payload.sessionId !== sessionId) return
      term.write(payload.data)
    })
    const offExit = window.kunGui.onTerminalExit((payload) => {
      if (payload.sessionId !== sessionId) return
      setExited(true)
    })

    // xterm input → PTY.
    const disposable = term.onData((data) => {
      void window.kunGui.writeToTerminal({
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
      void window.kunGui.resizeTerminal({
        sessionId,
        cols: dim.cols,
        rows: dim.rows
      })
    }
    const fitDisposable = term.onResize(onDimensionChange)

    // Create (or re-attach to) the PTY session. On re-attach the main process
    // replays the ring buffer before new output arrives.
    try {
      const result = await window.kunGui.createTerminal({
        sessionId,
        cwd: workspaceRoot || undefined,
        cols,
        rows
      })
      if (!isCurrentAttach()) return
      if (!result.ok) {
        setError(result.message)
        return
      }
      // After a successful (re)attach, reflect the latest fit so the PTY
      // matches the visible grid.
      const dims = fit.proposeDimensions()
      if (dims) {
        void window.kunGui.resizeTerminal({
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
  }, [sessionIdForTab, workspaceRoot])

  useEffect(() => {
    aliveRef.current = true
    if (activeTab) void attachTerminal(activeTab.id)
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
      if (!term) return
      term.options.theme = resolveTerminalTheme(containerRef.current, terminalColorsRef.current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

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

  const handleNewTab = useCallback(() => {
    if (tabs.length >= MAX_RENDERER_TABS) return
    const nextIndex = tabs.length + 1
    const tab: TerminalTab = {
      id: `tab-${Date.now().toString(36)}-${nextIndex}`,
      index: nextIndex
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [tabs.length])

  const handleCloseTab = useCallback((tabId: string) => {
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId)
    if (closingIndex === -1) return
    void window.kunGui.disposeTerminal(sessionIdForTab(tabId))
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
      if (tab.id !== tabId) void window.kunGui.disposeTerminal(sessionIdForTab(tab.id))
    }
    setTabs([keptTab])
    setActiveTabId(tabId)
    setContextMenu(null)
    if (renamingTabId && renamingTabId !== tabId) cancelRenameTab()
  }, [cancelRenameTab, renamingTabId, sessionIdForTab, tabs])

  const handleCloseAllTabs = useCallback(() => {
    for (const tab of tabs) {
      void window.kunGui.disposeTerminal(sessionIdForTab(tab.id))
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
      await window.kunGui.disposeTerminal(sessionIdForTab(activeTab.id))
    } catch {
      /* ignore */
    }
    setError(null)
    setExited(false)
    disposeRenderer()
    aliveRef.current = true
    void attachTerminal(activeTab.id)
  }, [activeTab, attachTerminal, disposeRenderer, sessionIdForTab])

  return (
    <aside
      className={`ds-no-drag ds-surface-strong flex min-h-0 flex-col overflow-hidden border-t border-ds-border-muted text-ds-ink shadow-[0_-18px_60px_rgba(20,47,95,0.08)] dark:bg-[rgba(21,29,49,0.98)] dark:shadow-[0_-24px_70px_rgba(2,6,16,0.2)] ${className}`}
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
                    className="mx-2 min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-card px-2 py-1 text-[12px] text-ds-ink outline-none focus:border-ds-accent"
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
                    <TerminalSquare className="h-4 w-4 shrink-0" strokeWidth={1.8} />
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
          <button
            type="button"
            onClick={handleNewTab}
            disabled={tabs.length >= MAX_RENDERER_TABS}
            className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('terminalNewTab')}
            title={t('terminalNewTab')}
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
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

      <div className="ds-surface-strong relative min-h-0 flex-1 overflow-hidden px-5 py-4 dark:bg-[rgba(21,29,49,0.98)]">
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

function TerminalTabContextMenu({
  state,
  tabCount,
  onRename,
  onCloseOthers,
  onCloseAll,
  t
}: {
  state: TerminalTabContextMenu
  tabCount: number
  onRename: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const run = (action: () => void): void => {
    action()
  }

  return (
    <div
      role="menu"
      aria-label={t('terminalTabMenuTitle')}
      className="ds-no-drag fixed z-[1000] min-w-[196px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(2,6,16,0.28)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <TerminalTabContextMenuItem
        icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalRenameTab')}
        onClick={() => run(onRename)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <TerminalTabContextMenuItem
        icon={<PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalCloseOtherTabs')}
        disabled={tabCount <= 1}
        onClick={() => run(onCloseOthers)}
      />
      <TerminalTabContextMenuItem
        icon={<PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('terminalCloseAllTabs')}
        danger
        onClick={() => run(onCloseAll)}
      />
    </div>
  )
}

function TerminalTabContextMenuItem({
  icon,
  label,
  disabled = false,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="shrink-0 text-current">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
