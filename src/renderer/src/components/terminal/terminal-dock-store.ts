import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import {
  TERMINAL_MAX_CLOSED,
  TERMINAL_MAX_TABS,
  TERMINAL_RIGHT_WIDTH,
  defaultDockLayout,
  emptyWorkspaceTerminals,
  initialStatus,
  makeTab,
  type ClosedTerminal,
  type TerminalDockLayout,
  type TerminalPane,
  type TerminalSessionStatus,
  type TerminalTab,
  type WorkspaceTerminals
} from './terminal-dock-model'

/**
 * Terminal dock state shared by the dock, the top-bar badge and the chat
 * stage: tabs per workspace, the dock layout, and live status per PTY session.
 * Tabs and layout persist; status is live only.
 */
const STORAGE_KEY = 'kun.terminal.dock.v1'

type PersistedDock = {
  version: 1
  layout: TerminalDockLayout
  workspaces: Record<string, WorkspaceTerminals>
}

export type TerminalDockState = {
  layout: TerminalDockLayout
  workspaces: Record<string, WorkspaceTerminals>
  status: Record<string, TerminalSessionStatus>
  /** Kun background shells the user closed; they are not reopened automatically. */
  dismissedProcesses: Record<string, true>
}

function sanitizePane(value: unknown): TerminalPane | null {
  if (!value || typeof value !== 'object') return null
  const pane = value as TerminalPane
  if (typeof pane.id !== 'string' || !pane.id || !pane.target || typeof pane.target !== 'object') return null
  if (pane.target.kind === 'kun-process') return null
  if (!['local', 'ssh', 'agent'].includes(pane.target.kind)) return null
  // A setup prefill or one-shot command must never run twice after a restart.
  const { prefill: _prefill, initialCommand: _initialCommand, fresh: _fresh, ...rest } = pane
  return rest
}

function sanitizeWorkspace(value: unknown): WorkspaceTerminals | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<WorkspaceTerminals>
  const tabs: TerminalTab[] = []
  for (const tab of Array.isArray(source.tabs) ? source.tabs : []) {
    if (!tab || typeof tab.id !== 'string') continue
    const panes = (Array.isArray(tab.panes) ? tab.panes : []).map(sanitizePane).filter((pane): pane is TerminalPane => Boolean(pane)).slice(0, 2)
    if (!panes.length) continue
    const focusedPaneId = panes.some((pane) => pane.id === tab.focusedPaneId) ? tab.focusedPaneId : panes[0]!.id
    tabs.push({ id: tab.id, panes, focusedPaneId })
  }
  const closed = (Array.isArray(source.closed) ? source.closed : []).flatMap((entry) => {
    const pane = sanitizePane(entry?.pane)
    return pane && typeof entry.ptySessionId === 'string'
      ? [{ pane, ptySessionId: entry.ptySessionId, title: String(entry.title ?? ''), closedAt: Number(entry.closedAt) || 0 }]
      : []
  }).slice(0, TERMINAL_MAX_CLOSED)
  const activeTabId = tabs.some((tab) => tab.id === source.activeTabId) ? source.activeTabId! : tabs[0]?.id ?? null
  return { tabs: tabs.slice(0, TERMINAL_MAX_TABS), activeTabId, closed }
}

function readPersisted(): Pick<TerminalDockState, 'layout' | 'workspaces'> {
  try {
    const raw = readBrowserStorageItem(STORAGE_KEY)
    if (!raw) return { layout: defaultDockLayout(), workspaces: {} }
    const parsed = JSON.parse(raw) as Partial<PersistedDock>
    const layout = { ...defaultDockLayout(), ...(parsed.layout ?? {}) }
    layout.rightWidth = Math.min(TERMINAL_RIGHT_WIDTH.max, Math.max(TERMINAL_RIGHT_WIDTH.min, Number(layout.rightWidth) || TERMINAL_RIGHT_WIDTH.default))
    layout.position = layout.position === 'right' ? 'right' : 'bottom'
    layout.maximized = layout.maximized === true
    layout.railOpen = layout.railOpen === true
    const workspaces: Record<string, WorkspaceTerminals> = {}
    for (const [key, value] of Object.entries(parsed.workspaces ?? {})) {
      const workspace = sanitizeWorkspace(value)
      if (workspace) workspaces[key] = workspace
    }
    return { layout, workspaces }
  } catch {
    return { layout: defaultDockLayout(), workspaces: {} }
  }
}

export const useTerminalDockStore = create<TerminalDockState>(() => ({
  ...readPersisted(),
  status: {},
  dismissedProcesses: {}
}))

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const { layout, workspaces } = useTerminalDockStore.getState()
    const persisted: PersistedDock = { version: 1, layout, workspaces: {} }
    for (const [key, workspace] of Object.entries(workspaces)) {
      const sanitized = sanitizeWorkspace(workspace)
      if (sanitized) persisted.workspaces[key] = sanitized
    }
    try {
      writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch { /* Layout persistence is best effort. */ }
  }, 300)
}

function updateWorkspace(key: string, update: (current: WorkspaceTerminals) => WorkspaceTerminals): void {
  useTerminalDockStore.setState((state) => ({
    workspaces: { ...state.workspaces, [key]: update(state.workspaces[key] ?? emptyWorkspaceTerminals()) }
  }))
  schedulePersist()
}

export function workspaceTerminals(key: string): WorkspaceTerminals {
  return useTerminalDockStore.getState().workspaces[key] ?? emptyWorkspaceTerminals()
}

export function hasWorkspaceTerminals(key: string): boolean {
  return Boolean(useTerminalDockStore.getState().workspaces[key])
}

export function seedWorkspace(key: string, pane: TerminalPane): void {
  if (hasWorkspaceTerminals(key)) return
  const tab = makeTab(pane)
  updateWorkspace(key, () => ({ tabs: [tab], activeTabId: tab.id, closed: [] }))
}

/** Add a tab (focused unless `activate` is false); false at the tab limit. */
export function addTerminalTab(key: string, pane: TerminalPane, options: { activate?: boolean } = {}): boolean {
  if (workspaceTerminals(key).tabs.length >= TERMINAL_MAX_TABS) return false
  const tab = makeTab(pane)
  const activate = options.activate !== false
  updateWorkspace(key, (current) => ({
    ...current,
    tabs: [...current.tabs, tab],
    activeTabId: activate || !current.activeTabId ? tab.id : current.activeTabId
  }))
  return true
}

export function setActiveTerminalTab(key: string, tabId: string): void {
  updateWorkspace(key, (current) => current.tabs.some((tab) => tab.id === tabId) ? { ...current, activeTabId: tabId } : current)
}

export function focusTerminalPane(key: string, tabId: string, paneId: string): void {
  updateWorkspace(key, (current) => ({
    ...current,
    tabs: current.tabs.map((tab) => tab.id === tabId && tab.panes.some((pane) => pane.id === paneId)
      ? { ...tab, focusedPaneId: paneId }
      : tab)
  }))
}

/** Put `pane` beside the tab's current pane; a tab holds at most two. */
export function splitTerminalTab(key: string, tabId: string, pane: TerminalPane): boolean {
  const tab = workspaceTerminals(key).tabs.find((candidate) => candidate.id === tabId)
  if (!tab || tab.panes.length >= 2) return false
  updateWorkspace(key, (current) => ({
    ...current,
    tabs: current.tabs.map((candidate) => candidate.id === tabId
      ? { ...candidate, panes: [...candidate.panes, pane], focusedPaneId: pane.id }
      : candidate)
  }))
  return true
}

export function renameTerminalPane(key: string, tabId: string, paneId: string, title: string): void {
  updateWorkspace(key, (current) => ({
    ...current,
    tabs: current.tabs.map((tab) => tab.id !== tabId ? tab : {
      ...tab,
      panes: tab.panes.map((pane) => pane.id === paneId ? { ...pane, userTitle: title.trim() || undefined } : pane)
    })
  }))
}

/** Remove one pane (the tab goes when it was the last) and remember it. */
export function removeTerminalPane(key: string, tabId: string, paneId: string, closed?: ClosedTerminal): void {
  updateWorkspace(key, (current) => {
    const index = current.tabs.findIndex((tab) => tab.id === tabId)
    const tab = current.tabs[index]
    if (!tab) return current
    const panes = tab.panes.filter((pane) => pane.id !== paneId)
    const tabs = panes.length
      ? current.tabs.map((candidate) => candidate.id === tabId ? { ...candidate, panes, focusedPaneId: panes[0]!.id } : candidate)
      : current.tabs.filter((candidate) => candidate.id !== tabId)
    const activeTabId = current.activeTabId === tabId && !panes.length
      ? (current.tabs[index + 1] ?? current.tabs[index - 1])?.id ?? null
      : current.activeTabId
    const closedList = closed ? [closed, ...current.closed.filter((entry) => entry.pane.id !== closed.pane.id)].slice(0, TERMINAL_MAX_CLOSED) : current.closed
    return { tabs, activeTabId, closed: closedList }
  })
}

export function takeClosedTerminal(key: string, paneId: string): ClosedTerminal | null {
  const entry = workspaceTerminals(key).closed.find((candidate) => candidate.pane.id === paneId) ?? null
  if (entry) updateWorkspace(key, (current) => ({ ...current, closed: current.closed.filter((candidate) => candidate !== entry) }))
  return entry
}

export function setDockLayout(patch: Partial<TerminalDockLayout>): void {
  useTerminalDockStore.setState((state) => ({ layout: { ...state.layout, ...patch } }))
  schedulePersist()
}

export function updateSessionStatus(ptySessionId: string, patch: Partial<TerminalSessionStatus>): void {
  useTerminalDockStore.setState((state) => ({
    status: { ...state.status, [ptySessionId]: { ...(state.status[ptySessionId] ?? initialStatus()), ...patch } }
  }))
}

export function readSessionStatus(ptySessionId: string): TerminalSessionStatus | undefined {
  return useTerminalDockStore.getState().status[ptySessionId]
}

export function clearSessionStatus(ptySessionId: string): void {
  useTerminalDockStore.setState((state) => {
    if (!(ptySessionId in state.status)) return state
    const status = { ...state.status }
    delete status[ptySessionId]
    return { status }
  })
}

export function dismissKunProcess(processId: string): void {
  useTerminalDockStore.setState((state) => ({ dismissedProcesses: { ...state.dismissedProcesses, [processId]: true } }))
}

/** Test seam: reset the store between cases. */
export function resetTerminalDockStoreForTest(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  useTerminalDockStore.setState({ layout: defaultDockLayout(), workspaces: {}, status: {}, dismissedProcesses: {} }, false)
}
