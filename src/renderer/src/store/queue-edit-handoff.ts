import { accountIdForComposerSelection } from './chat-store-helpers'
import { queuedMessageEditBlockReason } from './queued-message-edit'
import i18n from '../i18n'
import type { QueuedUserMessage, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { browserStorage } from '../lib/browser-storage'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'

export function assertQueueEditAccount(message: QueuedUserMessage, get: ChatStoreGet): void {
  if (!message.accountId?.trim()) return
  const actual = accountIdForComposerSelection(get().composerModelGroups, message.providerId ?? '', message.model ?? '')
  if (actual !== message.accountId.trim()) throw new Error(i18n.t('common:queuedMessageEditAccountUnavailable'))
}

/** Refresh at most once, before cancelling; never change a connection to restore a draft. */
export async function preflightQueueEditAccount(threadId: string, message: QueuedUserMessage, get: ChatStoreGet): Promise<boolean> {
  try { assertQueueEditAccount(message, get) } catch {
    await get().loadComposerModels()
    if (get().activeThreadId !== threadId) return false
    const current = get().queuedMessages.find((row) => row.id === message.id)
    if (!current || current.clientRequestId !== message.clientRequestId || current.deliveryTurnId !== message.deliveryTurnId ||
      current.accountId !== message.accountId || current.providerId !== message.providerId || current.model !== message.model ||
      queuedMessageEditBlockReason(current)) return false
    assertQueueEditAccount(current, get)
  }
  return get().activeThreadId === threadId
}

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
