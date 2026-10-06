import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { MAX_RENDERER_TABS, type TerminalTab } from './terminal-panel-support'
import type { TerminalAgentCreate } from '@shared/terminal'

/**
 * Cross-surface "open a terminal" request (docs/ade/11 §7.1 recovery
 * affordance; docs/ade/impl/p4 P4-09 harness setup prefill). The workbench
 * layout opens the panel; the terminal panel itself drains the pending
 * request on mount and listens for the event while open, so a request made
 * while the workbench is hidden (e.g. inside Settings) survives.
 */
export const TERMINAL_OPEN_AT_EVENT = 'kun:terminal-open-at'

export type TerminalOpenRequest = {
  /** The host resolves this registered integration into an owned PTY launch. */
  agent?: TerminalAgentCreate
  /** Open the local shell at this directory. */
  cwd?: string
  /**
   * P4-09: text written into the PTY input without a trailing Enter — the
   * user reviews the command and executes it themselves. Only ever carries
   * commands declared by builtin harness `setup` metadata.
   */
  prefill?: string
  /** Re-probe this harness (`/v1/harnesses/:id/probe`) when the PTY exits. */
  probeHarnessId?: string
  /** Optional tab title override. */
  title?: string
}

let pendingRequest: TerminalOpenRequest | null = null

export function openTerminal(request: TerminalOpenRequest): void {
  pendingRequest = request
  window.dispatchEvent(
    new CustomEvent<TerminalOpenRequest>(TERMINAL_OPEN_AT_EVENT, { detail: request })
  )
}

export function openTerminalAt(cwd: string): void {
  openTerminal({ cwd })
}

/** P4-09: open a shell with a builtin harness setup command prefilled. */
export function openTerminalWithSetup(request: TerminalOpenRequest): void {
  openTerminal(request)
}

/** One-shot drain for a freshly mounted terminal panel. */
export function consumePendingTerminalRequest(): TerminalOpenRequest | null {
  const request = pendingRequest
  pendingRequest = null
  return request
}

/**
 * Whether a request is waiting for a not-yet-mounted terminal panel. The
 * workbench layout checks this on mount so a request dispatched while a
 * covering route (Settings) was open still surfaces the panel.
 */
export function hasPendingTerminalRequest(): boolean {
  return pendingRequest !== null
}

function requestTab(request: TerminalOpenRequest, index: number): TerminalTab {
  const cwd = request.cwd
  return {
    id: `tab-${Date.now().toString(36)}-${index}`,
    index,
    title: request.title ?? (cwd ? (cwd.split('/').filter(Boolean).pop() ?? cwd) : undefined),
    target: request.agent
      ? { kind: 'agent', ...request.agent, ...(cwd ? { cwd } : {}) }
      : { kind: 'local', ...(cwd ? { cwd } : {}) },
    ...(request.prefill ? { prefill: request.prefill } : {}),
    ...(request.probeHarnessId ? { probeHarnessId: request.probeHarnessId } : {})
  }
}

/**
 * TerminalPanel side of the request: a cwd-only request reuses a matching
 * local tab when one exists; otherwise a new local tab is created carrying
 * the prefill/probe hints.
 */
export function useTerminalOpenAt(
  tabsRef: MutableRefObject<TerminalTab[]>,
  setTabs: (updater: (current: TerminalTab[]) => TerminalTab[]) => void,
  setActiveTabId: (id: string) => void
): void {
  const openRequestTab = useCallback((request: TerminalOpenRequest) => {
    const cwd = request.cwd
    if (cwd && !request.prefill && !request.agent) {
      const existing = tabsRef.current.find(
        (tab) => tab.target.kind === 'local' && tab.target.cwd === cwd && !tab.prefill
      )
      if (existing) {
        setActiveTabId(existing.id)
        return
      }
    }
    if (tabsRef.current.length >= MAX_RENDERER_TABS) return
    const tab = requestTab(request, tabsRef.current.length + 1)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }, [tabsRef, setTabs, setActiveTabId])

  // Stable ref so the mount drain and the listener share the latest opener.
  const openRef = useRef(openRequestTab)
  openRef.current = openRequestTab

  useEffect(() => {
    const pending = consumePendingTerminalRequest()
    if (pending) openRef.current(pending)
    const onOpenAt = (event: Event): void => {
      const request = (event as CustomEvent<TerminalOpenRequest>).detail ?? {}
      consumePendingTerminalRequest()
      openRef.current(request)
    }
    window.addEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
    return () => window.removeEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
  }, [])
}
