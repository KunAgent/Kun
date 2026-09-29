import { useCallback, type MutableRefObject, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { terminalBackend } from './terminal-backend'
import {
  initialTerminalTabState,
  type TerminalTab,
  type TerminalTabContextMenu
} from './terminal-panel-support'

/**
 * Tab-strip actions for TerminalPanel — close/context-menu/rename callbacks
 * kept in one hook so the panel file stays under the 700-line limit.
 */
export function useTerminalTabActions({
  tabs,
  activeTab,
  activeTabId,
  renamingTabId,
  renameValue,
  tabButtonRefs,
  sessionIdForTab,
  getTabTitle,
  setTabs,
  setActiveTabId,
  setContextMenu,
  setRenamingTabId,
  setRenameValue,
  onCollapse
}: {
  tabs: TerminalTab[]
  activeTab: TerminalTab | undefined
  activeTabId: string
  renamingTabId: string | null
  renameValue: string
  tabButtonRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
  sessionIdForTab: (tab: TerminalTab) => string
  getTabTitle: (tab: TerminalTab) => string
  setTabs: (updater: TerminalTab[] | ((current: TerminalTab[]) => TerminalTab[])) => void
  setActiveTabId: (id: string) => void
  setContextMenu: (menu: TerminalTabContextMenu | null) => void
  setRenamingTabId: (id: string | null) => void
  setRenameValue: (value: string) => void
  onCollapse: () => void
}) {
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
  }, [activeTabId, sessionIdForTab, setActiveTabId, setTabs, tabs])

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
  }, [setActiveTabId, setContextMenu, tabButtonRefs])

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
  }, [getTabTitle, setContextMenu, setRenamingTabId, setRenameValue, tabs])

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return
    const nextTitle = renameValue.trim()
    setTabs((current) =>
      current.map((tab) => (tab.id === renamingTabId ? { ...tab, title: nextTitle || undefined } : tab))
    )
    setRenamingTabId(null)
    setRenameValue('')
  }, [renameValue, renamingTabId, setRenamingTabId, setRenameValue, setTabs])

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null)
    setRenameValue('')
  }, [setRenamingTabId, setRenameValue])

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
  }, [cancelRenameTab, renamingTabId, sessionIdForTab, setActiveTabId, setContextMenu, setTabs, tabs])

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
  }, [cancelRenameTab, onCollapse, sessionIdForTab, setActiveTabId, setContextMenu, setTabs, tabs])

  return {
    handleCloseTab,
    openTabContextMenu,
    openActiveTabContextMenu,
    openTabContextMenuOnSecondaryPointer,
    openActiveTabContextMenuOnSecondaryPointer,
    startRenameTab,
    commitRenameTab,
    cancelRenameTab,
    handleCloseOtherTabs,
    handleCloseAllTabs
  }
}
