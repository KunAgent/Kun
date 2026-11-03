import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  fetchBackgroundShells,
  sameBackgroundShellSessions,
  stopBackgroundShell,
  type BackgroundShellSession
} from './shells-tray-data'

/** How often the composer re-reads the thread's background shells. */
export const BACKGROUND_SHELL_POLL_INTERVAL_MS = 2000

const NO_SESSIONS: readonly BackgroundShellSession[] = Object.freeze([])

export type BackgroundShellPoller = {
  /** The active thread's sessions; the same array while nothing changed. */
  sessions: readonly BackgroundShellSession[]
  refresh: () => Promise<void>
  /** Stops a running shell, then re-reads the list. */
  stop: (sessionId: string) => Promise<void>
}

/**
 * The one background-shell poller of a composer: reads the thread's shells
 * every 2 s while the runtime is ready and a thread is open. A request id
 * drops responses that land after a thread switch, and an unchanged result
 * keeps the previous array so an idle poll re-renders nothing.
 */
export function useBackgroundShellPoller({
  threadId,
  runtimeReady
}: {
  threadId: string | null
  runtimeReady: boolean
}): BackgroundShellPoller {
  const [sessions, setSessions] = useState<readonly BackgroundShellSession[]>(NO_SESSIONS)
  // Last list handed to React: an unchanged poll returns before setState, so
  // not even this hook's component renders.
  const sessionsRef = useRef<readonly BackgroundShellSession[]>(NO_SESSIONS)
  const requestIdRef = useRef(0)
  const runtimeContextRef = useRef({ runtimeReady, threadId })
  runtimeContextRef.current = { runtimeReady, threadId }

  const refresh = useCallback(async () => {
    if (!runtimeReady || !threadId) return
    const requestContext = runtimeContextRef.current
    if (!requestContext.runtimeReady || requestContext.threadId !== threadId) return
    const requestId = ++requestIdRef.current
    let sessionsForThread: BackgroundShellSession[]
    try {
      const data = await fetchBackgroundShells(threadId)
      // A transient failure (bridge error, 5xx, unreadable body) keeps what
      // is on screen, open sheet included; the next poll retries.
      if (data === null) return
      sessionsForThread = data.sessions.filter((session) => session.threadId === threadId)
    } catch {
      return
    }
    const currentContext = runtimeContextRef.current
    if (
      requestId !== requestIdRef.current ||
      !currentContext.runtimeReady ||
      currentContext.threadId !== threadId
    ) return
    const next = sessionsForThread.length === 0 ? NO_SESSIONS : sessionsForThread
    if (sameBackgroundShellSessions(sessionsRef.current, next)) return
    sessionsRef.current = next
    setSessions(next)
  }, [runtimeReady, threadId])

  useEffect(() => {
    requestIdRef.current += 1
    sessionsRef.current = NO_SESSIONS
    setSessions(NO_SESSIONS)
    void refresh()
    if (!runtimeReady || !threadId) return
    const timer = setInterval(() => void refresh(), BACKGROUND_SHELL_POLL_INTERVAL_MS)
    return () => {
      requestIdRef.current += 1
      clearInterval(timer)
    }
  }, [refresh, runtimeReady, threadId])

  const stop = useCallback(async (sessionId: string) => {
    try {
      await stopBackgroundShell(sessionId)
    } finally {
      await refresh()
    }
  }, [refresh])

  return { sessions, refresh, stop }
}

// ---------------------------------------------------------------------------
// Dismissed commands (per app session, shared by every composer)
// ---------------------------------------------------------------------------

let dismissedIds: ReadonlySet<string> = new Set()
const dismissedListeners = new Set<() => void>()

function subscribeDismissed(listener: () => void): () => void {
  dismissedListeners.add(listener)
  return () => {
    dismissedListeners.delete(listener)
  }
}

function readDismissed(): ReadonlySet<string> {
  return dismissedIds
}

/** Hides a finished or failed command from the tray for the rest of the app session. */
export function dismissBackgroundShell(sessionId: string): void {
  if (dismissedIds.has(sessionId)) return
  dismissedIds = new Set([...dismissedIds, sessionId])
  for (const listener of dismissedListeners) listener()
}

export function useDismissedBackgroundShells(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeDismissed, readDismissed, readDismissed)
}

/** Test helper: forget every dismissal. */
export function resetDismissedBackgroundShells(): void {
  dismissedIds = new Set()
  for (const listener of dismissedListeners) listener()
}
