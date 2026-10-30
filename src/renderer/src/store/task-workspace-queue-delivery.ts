import { getProvider } from '../agent/registry'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { drainBackgroundQueuedMessage } from './chat-store-background-queue'
import {
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'

/** The workspace owner, not the selected conversation, owns the parked turn. */
export async function drainTaskWorkspaceQueuedMessages(
  threadId: string,
  set: ChatStoreSet,
  get: ChatStoreGet
): Promise<void> {
  if (get().activeThreadId === threadId) {
    await get().drainQueuedMessages()
    return
  }
  let watching = false
  const watch = (): void => {
    if (watching) return
    watching = true
    invalidateThreadSnapshot(threadId)
    set((state) => ({ watchTurnCompletion: { ...state.watchTurnCompletion, [threadId]: true } }))
    watchTurnCompletionNotification(threadId, Date.now(), turnCompleteNotificationSource(threadId, get()))
    syncTurnCompletionPoll(set, get)
    if (get().activeThreadId === threadId) void get().recoverActiveTurn()
  }
  const delivery = await drainBackgroundQueuedMessage({
    threadId, provider: getProvider(), set, get, onTurnStarted: watch
  })
  // Even a queued receipt needs a watch: this is the first turn, so there
  // cannot be an older completion watch to carry it into the background.
  if (delivery.status === 'accepted') watch()
}
