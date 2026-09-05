import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { saveQueuedMessagesForThread } from './queued-message-persistence'
import i18n from '../i18n'
import { createThreadCreationActions } from './chat-store-thread-creation-actions'
import { createThreadSelectionActions } from './chat-store-thread-selection-actions'
import { createThreadQueueActions } from './chat-store-thread-queue-actions'
import { createThreadSendActions } from './chat-store-thread-send-actions'
import { createThreadReviewActions } from './chat-store-thread-review-actions'
import type { StoreActionContext, ThreadActionRuntime } from './chat-store-thread-actions-support'
import { cancelThreadRecovery } from './thread-recovery-coordinator'

type SseAbortRef = { current: AbortController | null }

export function createThreadActions(
  context: { set: ChatStoreSet; get: ChatStoreGet; sseAbortRef: SseAbortRef }
): Pick<ChatState, 'createThread' | 'createConversation' | 'recoverActiveTurn' | 'selectThread' | 'loadEarlierThreadHistory' | 'subscribeThreadEventsLive' | 'drainQueuedMessages' | 'removeQueuedMessage' | 'restoreQueuedMessage' | 'reorderQueuedMessage' | 'guideQueuedMessage' | 'resumeQueuedTurns' | 'sendMessage' | 'reviewActiveThread'> {
  const actionContext: StoreActionContext = context
  const runtime: ThreadActionRuntime = {
    threadSelectionGeneration: 0,
    fenceThreadMutation: (threadId) => {
      if (threadId) cancelThreadRecovery(threadId)
      runtime.threadSelectionGeneration += 1
      return runtime.threadSelectionGeneration
    },
    persistActiveQueuedMessages: () => {
      const state = context.get()
      if (state.activeThreadId) {
        if (!saveQueuedMessagesForThread(state.activeThreadId, state.queuedMessages)) {
          context.set({ error: i18n.t('common:queuedMessagesPersistenceFailed') })
        }
      }
    }
  }
  return {
    ...createThreadCreationActions(actionContext, runtime),
    ...createThreadSelectionActions(actionContext, runtime),
    ...createThreadQueueActions(actionContext, runtime),
    ...createThreadSendActions(actionContext, runtime),
    ...createThreadReviewActions(actionContext, runtime)
  }
}
