import { getProvider } from '../agent/registry'
import { useChatStore } from './chat-store'

/**
 * Foreground-thread reporter (docs/ade/06 §7.2 condition 4): POSTs the
 * thread this client is actively viewing to /v1/activity/foreground so the
 * dormancy scanner keeps it resident. Fires on every active-thread change
 * and refreshes on an interval under the mark's 30 s TTL while the window
 * is visible — a hidden or disconnected client simply stops reporting.
 */
export const ACTIVITY_FOREGROUND_REFRESH_MS = 15_000

export type ActivityForegroundDeps = {
  report(threadId: string): Promise<void>
  activeThreadId(): string | null
  /** Calls listener whenever the active thread may have changed. */
  subscribeActiveThread(listener: () => void): () => void
  isVisible(): boolean
  refreshMs: number
}

function defaultDeps(): ActivityForegroundDeps {
  return {
    report: (threadId) => {
      const report = getProvider().reportActivityForeground
      return report ? report(threadId) : Promise.resolve()
    },
    activeThreadId: () => useChatStore.getState().activeThreadId,
    subscribeActiveThread: (listener) =>
      useChatStore.subscribe((state, previous) => {
        if (state.activeThreadId !== previous.activeThreadId) listener()
      }),
    isVisible: () =>
      typeof document === 'undefined' || document.visibilityState === 'visible',
    refreshMs: ACTIVITY_FOREGROUND_REFRESH_MS
  }
}

/** Best-effort reporting; returns an unsubscribe for teardown/tests. */
export function startActivityForegroundReporting(
  deps: ActivityForegroundDeps = defaultDeps()
): () => void {
  const report = (): void => {
    if (!deps.isVisible()) return
    const threadId = deps.activeThreadId()
    if (!threadId) return
    void Promise.resolve()
      .then(() => deps.report(threadId))
      .catch(() => undefined)
  }
  const unsubscribe = deps.subscribeActiveThread(report)
  const timer = setInterval(report, deps.refreshMs)
  report()
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}
