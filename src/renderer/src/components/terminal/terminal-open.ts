import { useCallback, useEffect, type MutableRefObject } from 'react'
import { MAX_RENDERER_TABS, type TerminalTab } from './terminal-panel-support'

/**
 * Cross-surface "open a terminal at this directory" request (docs/ade/11
 * §7.1 recovery affordance). The workbench layout opens the panel; the
 * terminal panel itself drains `pendingCwd` on mount and listens for the
 * event while open, so the request survives a closed panel.
 */
export const TERMINAL_OPEN_AT_EVENT = 'kun:terminal-open-at'

let pendingCwd: string | null = null

export function openTerminalAt(cwd: string): void {
  pendingCwd = cwd
  window.dispatchEvent(
    new CustomEvent<{ cwd: string }>(TERMINAL_OPEN_AT_EVENT, { detail: { cwd } })
  )
}

/** One-shot drain for a freshly mounted terminal panel. */
export function consumePendingTerminalCwd(): string | null {
  const cwd = pendingCwd
  pendingCwd = null
  return cwd
}

/**
 * TerminalPanel side of the request: reuses a matching local tab when one
 * exists, otherwise opens a new tab whose PTY starts at `cwd`.
 */
export function useTerminalOpenAt(
  tabsRef: MutableRefObject<TerminalTab[]>,
  setTabs: (updater: (current: TerminalTab[]) => TerminalTab[]) => void,
  setActiveTabId: (id: string) => void
): void {
  const openCwdTab = useCallback((cwd: string) => {
    const existing = tabsRef.current.find(
      (tab) => tab.target.kind === 'local' && tab.target.cwd === cwd
    )
    if (existing) {
      setActiveTabId(existing.id)
      return
    }
    if (tabsRef.current.length >= MAX_RENDERER_TABS) return
    const tab: TerminalTab = {
      id: `tab-${Date.now().toString(36)}-${tabsRef.current.length + 1}`,
      index: tabsRef.current.length + 1,
      title: cwd.split('/').filter(Boolean).pop() ?? cwd,
      target: { kind: 'local', cwd }
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [tabsRef, setTabs, setActiveTabId])

  useEffect(() => {
    const pending = consumePendingTerminalCwd()
    if (pending) openCwdTab(pending)
    const onOpenAt = (event: Event): void => {
      const cwd = (event as CustomEvent<{ cwd?: string }>).detail?.cwd
      consumePendingTerminalCwd()
      if (cwd) openCwdTab(cwd)
    }
    window.addEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
    return () => window.removeEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
  }, [openCwdTab])
}
