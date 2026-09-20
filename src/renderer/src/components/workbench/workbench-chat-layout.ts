export type EmptyTaskLayoutState = {
  activeThreadId: string | null
  threadLoadingId: string | null
  hasConversationContent: boolean
  runtimeReady: boolean
  hasWorkspace: boolean
}

/**
 * The centered empty-task layout belongs only to a genuinely empty task,
 * including while the runtime is waking or showing a connection error.
 * During thread hydration the projection is deliberately cleared, but that
 * transient frame must keep the ordinary conversation dock and loading UI.
 */
export function shouldUseEmptyTaskLayout(state: EmptyTaskLayoutState): boolean {
  const hydratingActiveThread =
    state.activeThreadId != null && state.threadLoadingId === state.activeThreadId
  return !state.hasConversationContent
    && !hydratingActiveThread
    && state.hasWorkspace
}

/** True only while a real selected thread is hydrating its detail. */
export function isActiveThreadRefreshing(
  threadRefreshingId: string | null,
  activeThreadId: string | null
): boolean {
  return Boolean(activeThreadId) && threadRefreshingId === activeThreadId
}
