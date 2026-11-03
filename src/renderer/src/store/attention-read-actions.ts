import { sidebarThreadActivity } from '../components/chat/sidebar-project-selectors'
import { useActivityStore } from './activity-store'
import { appBadgeInputFromChatState, attentionItemsForBadge } from './app-badge'
import { useChatStore } from './chat-store'
import type { ChatState } from './chat-store-types'
import { completionAttentionForThread, MAX_UNREAD_COMPLETION_IDS } from './unread-completions'

export type AttentionReadUndo = {
  count: number
  undo: () => void
  dispose: () => void
}

/** Mark only the supplied, still-unread attention rows; other attention types are untouched. */
export function markAttentionRead(threadIds: readonly string[]): AttentionReadUndo | null {
  const requested = new Set(threadIds)
  let cleared: string[] = []
  useChatStore.setState((state) => {
    const input = appBadgeInputFromChatState(state, useActivityStore.getState().rows)
    cleared = attentionItemsForBadge(input)
      .filter((item) => item.kind === 'unread' && requested.has(item.threadId))
      .map((item) => item.threadId)
    if (cleared.length === 0) return state
    const unreadThreadIds = { ...state.unreadThreadIds }
    for (const id of cleared) delete unreadThreadIds[id]
    return { unreadThreadIds }
  })
  if (cleared.length === 0) return null

  const pending = new Set(cleared)
  const prune = (state: ChatState): void => {
    if (pending.size === 0) return
    const input = appBadgeInputFromChatState(state, useActivityStore.getState().rows)
    const threads = new Map(state.threads.map((thread) => [thread.id.trim(), thread]))
    for (const id of pending) {
      const thread = threads.get(id)
      const visibleInWrite = state.route === 'write' && state.writeAssistantVisibleThreadId === id
      const visibleInSidePanel = state.route === 'chat' && state.sidePanel.open && state.sidePanel.activeSideId === id
      if (
        !thread || thread.archived === true || state.activeThreadId === id ||
        visibleInWrite || visibleInSidePanel || completionAttentionForThread(state.unreadThreadIds, id)
      ) {
        pending.delete(id)
        continue
      }
      const activity = sidebarThreadActivity(thread, input)
      if (activity === 'awaiting-input' || activity === 'running') pending.delete(id)
    }
  }

  // Changes after the batch belong to the new state, not to the undo snapshot.
  const unsubscribeChat = useChatStore.subscribe((state, previous) => {
    if (
      state.unreadThreadIds !== previous.unreadThreadIds || state.threads !== previous.threads ||
      state.activeThreadId !== previous.activeThreadId || state.busy !== previous.busy ||
      state.awaitingUserInputThreadIds !== previous.awaitingUserInputThreadIds ||
      state.watchTurnCompletion !== previous.watchTurnCompletion ||
      state.scheduledThreadActivities !== previous.scheduledThreadActivities ||
      state.writeAssistantVisibleThreadId !== previous.writeAssistantVisibleThreadId ||
      state.sidePanel !== previous.sidePanel || state.route !== previous.route
    ) prune(state)
  })
  const unsubscribeActivity = useActivityStore.subscribe((state, previous) => {
    if (state.rows !== previous.rows) prune(useChatStore.getState())
  })
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribeChat()
    unsubscribeActivity()
  }
  prune(useChatStore.getState())

  return {
    count: cleared.length,
    dispose,
    undo: () => {
      if (disposed) return
      prune(useChatStore.getState())
      dispose()
      if (pending.size === 0) return
      useChatStore.setState((state) => {
        const unreadThreadIds = { ...state.unreadThreadIds }
        let size = Object.keys(unreadThreadIds).length
        let changed = false
        for (const id of pending) {
          if (completionAttentionForThread(unreadThreadIds, id) || size >= MAX_UNREAD_COMPLETION_IDS) continue
          if (!(id in unreadThreadIds)) size += 1
          unreadThreadIds[id] = 'completed'
          changed = true
        }
        return changed ? { unreadThreadIds } : state
      })
    }
  }
}
