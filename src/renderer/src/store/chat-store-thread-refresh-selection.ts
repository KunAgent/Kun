import type { NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'

type ThreadRefreshState = Pick<
  ChatState,
  | 'activeThreadId'
  | 'activeThreadRelation'
  | 'threadLoadingId'
  | 'sideConversations'
  | 'route'
  | 'adeThreads'
>

export type ThreadRefreshSelection = {
  shouldClearSelection: boolean
  validIds: Set<string>
}

/**
 * Primary inventory refreshes intentionally omit side threads. Preserve an
 * explicit process navigation while it is hydrating and after its side
 * relation is known, without inserting that hidden thread into the sidebar.
 */
export function threadRefreshSelection(
  state: ThreadRefreshState,
  displayThreads: ReadonlyArray<Pick<NormalizedThread, 'id'>>
): ThreadRefreshSelection {
  const activeThreadId = state.activeThreadId
  const preserveActiveThread = activeThreadId != null && (
    state.threadLoadingId === activeThreadId || state.activeThreadRelation === 'side' ||
    state.route === 'ade'
  )
  const validIds = new Set([
    ...displayThreads.map((thread) => thread.id),
    ...(state.adeThreads ?? []).map((thread) => thread.id),
    ...Object.keys(state.sideConversations ?? {})
  ])
  if (preserveActiveThread) validIds.add(activeThreadId)
  return {
    shouldClearSelection:
      activeThreadId != null && !preserveActiveThread && !validIds.has(activeThreadId),
    validIds
  }
}
