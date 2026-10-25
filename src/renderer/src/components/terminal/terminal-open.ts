import { useEffect, useRef } from 'react'
import type { TerminalAgentCreate } from '@shared/terminal'
import { addTerminalTab, setActiveTerminalTab, workspaceTerminals } from './terminal-dock-store'
import { newTerminalId, type TerminalPane } from './terminal-dock-model'

/**
 * Cross-surface "open a terminal" request. The workbench layout opens the
 * dock; the mounted dock drains the pending request and listens for more, so
 * a request made while the workbench is hidden (e.g. inside Settings)
 * survives.
 */
export const TERMINAL_OPEN_AT_EVENT = 'kun:terminal-open-at'

export type TerminalOpenRequest = {
  /** The host resolves this registered integration into an owned PTY launch. */
  agent?: TerminalAgentCreate
  /** Open the local shell at this directory. */
  cwd?: string
  /**
   * Text written into the PTY input without a trailing Enter; the user
   * reviews the command and runs it. Only builtin harness setup commands.
   */
  prefill?: string
  /** Re-probe this harness (`/v1/harnesses/:id/probe`) when the PTY exits. */
  probeHarnessId?: string
  /** Optional tab title override. */
  title?: string
  /** Show one of Kun's background shells. */
  kunProcess?: { id: string; command: string; threadId: string }
  /** Run this command (with Enter) once the new shell is ready. */
  command?: string
}

let pendingRequest: TerminalOpenRequest | null = null

export function openTerminal(request: TerminalOpenRequest): void {
  pendingRequest = request
  window.dispatchEvent(new CustomEvent<TerminalOpenRequest>(TERMINAL_OPEN_AT_EVENT, { detail: request }))
}

export function openTerminalAt(cwd: string): void {
  openTerminal({ cwd })
}

/** Open a shell with a builtin harness setup command prefilled. */
export function openTerminalWithSetup(request: TerminalOpenRequest): void {
  openTerminal(request)
}

/** One-shot drain for a freshly mounted dock. */
export function consumePendingTerminalRequest(): TerminalOpenRequest | null {
  const request = pendingRequest
  pendingRequest = null
  return request
}

/**
 * Whether a request is waiting for a not-yet-mounted dock. The workbench
 * layout checks this on mount so a request dispatched while a covering route
 * (Settings) was open still surfaces the dock.
 */
export function hasPendingTerminalRequest(): boolean {
  return pendingRequest !== null
}

export function paneForTerminalRequest(request: TerminalOpenRequest): TerminalPane {
  const cwd = request.cwd
  if (request.kunProcess) {
    return {
      id: newTerminalId('pane'),
      fresh: true,
      title: request.kunProcess.command,
      target: { kind: 'kun-process', processId: request.kunProcess.id, command: request.kunProcess.command, threadId: request.kunProcess.threadId }
    }
  }
  // A cwd-only shell is titled by its live directory, not the one it opened in.
  const title = request.title
  return {
    id: newTerminalId('pane'),
    fresh: true,
    ...(title ? { title } : {}),
    target: request.agent
      ? { kind: 'agent', ...request.agent, ...(cwd ? { cwd } : {}) }
      : { kind: 'local', ...(cwd ? { cwd } : {}) },
    ...(request.prefill ? { prefill: request.prefill } : {}),
    ...(request.command ? { initialCommand: request.command } : {}),
    ...(request.probeHarnessId ? { probeHarnessId: request.probeHarnessId } : {})
  }
}

/**
 * Apply a request to a workspace: a cwd-only request reuses a matching local
 * pane, a Kun process reuses its tab; anything else opens a new tab.
 */
export function applyTerminalOpenRequest(workspaceKey: string, request: TerminalOpenRequest): void {
  const { tabs } = workspaceTerminals(workspaceKey)
  const existing = tabs.find((tab) => tab.panes.some((pane) => {
    if (request.kunProcess) return pane.target.kind === 'kun-process' && pane.target.processId === request.kunProcess.id
    return Boolean(request.cwd) && !request.prefill && !request.agent && !request.command &&
      pane.target.kind === 'local' && pane.target.cwd === request.cwd && !pane.prefill
  }))
  if (existing) {
    setActiveTerminalTab(workspaceKey, existing.id)
    return
  }
  addTerminalTab(workspaceKey, paneForTerminalRequest(request))
}

/** Dock side of the channel: drain on mount, then listen while mounted. */
export function useTerminalOpenRequests(workspaceKey: string): void {
  const keyRef = useRef(workspaceKey)
  keyRef.current = workspaceKey
  useEffect(() => {
    const pending = consumePendingTerminalRequest()
    if (pending) applyTerminalOpenRequest(keyRef.current, pending)
    const onOpenAt = (event: Event): void => {
      const request = (event as CustomEvent<TerminalOpenRequest>).detail ?? {}
      consumePendingTerminalRequest()
      applyTerminalOpenRequest(keyRef.current, request)
    }
    window.addEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
    return () => window.removeEventListener(TERMINAL_OPEN_AT_EVENT, onOpenAt)
  }, [])
}
