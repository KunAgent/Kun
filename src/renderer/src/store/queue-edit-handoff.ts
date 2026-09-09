import i18n from '../i18n'
import type { QueuedUserMessage, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { browserStorage } from '../lib/browser-storage'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'

/** Persist before handing ownership from the runtime to the composer. */
export function saveQueueEditIntent(
  threadId: string,
  message: QueuedUserMessage,
  get: ChatStoreGet,
  set: ChatStoreSet
): void {
  const active = get().activeThreadId === threadId
  const rows = active ? get().queuedMessages : queuedMessagesForThread(threadId)
  const next = rows.some((row) => row.id === message.id)
    ? rows.map((row) => row.id === message.id ? message : row)
    : [...rows, message]
  if (!browserStorage() || !saveQueuedMessagesForThread(threadId, next)) {
    throw new Error(i18n.t('common:queuedMessageStorageFailed'))
  }
  if (active) set({ queuedMessages: next })
}
