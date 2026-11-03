import { workspaceRootScopeKey } from '../lib/workspace-path'
import type { ChatStoreGet, ChatStoreSet, QueuedUserMessage } from './chat-store-types'
import { isPendingQueuedMessage, queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'

type WorkspaceIdentity = { ownerThreadId: string; workspaceId: string; sourceRoot?: string }

/** A durable isolation requirement outlives prep state and the selected view. */
export function queuedTaskWorkspaceRequirement(threadId: string): QueuedUserMessage | undefined {
  return queuedMessagesForThread(threadId).find((message) => (message.taskWorkspace || message.planBuild) &&
    message.expectedThreadId === threadId && message.deliveryState !== 'in_flight' && !message.deliveryTurnId)
}

export function queuedTaskWorkspaceMatches(message: QueuedUserMessage, workspace: WorkspaceIdentity): boolean {
  if (message.expectedThreadId !== workspace.ownerThreadId) return false
  const required = message.taskWorkspace
  if (!required) return true // Previously persisted plan handoffs have no workspace snapshot.
  return Boolean(required.sourceRoot && workspace.sourceRoot &&
    workspaceRootScopeKey(required.sourceRoot) === workspaceRootScopeKey(workspace.sourceRoot) &&
    (!required.workspaceId || required.workspaceId === workspace.workspaceId))
}

/** Pin the server-assigned workspace without resurrecting removed queue entries. */
export function rememberQueuedTaskWorkspace(
  workspace: WorkspaceIdentity,
  set: ChatStoreSet,
  get: ChatStoreGet
): boolean {
  const threadId = workspace.ownerThreadId
  const active = get().activeThreadId === threadId
  const rows = active ? get().queuedMessages : queuedMessagesForThread(threadId)
  const messages = rows.map((message) =>
    message.taskWorkspace && !message.taskWorkspace.workspaceId && queuedTaskWorkspaceMatches(message, workspace)
      ? { ...message, taskWorkspace: { ...message.taskWorkspace, workspaceId: workspace.workspaceId } }
      : message)
  if (messages.every((message, index) => message === rows[index])) return true
  if (!saveQueuedMessagesForThread(threadId, messages)) return false
  if (active) set({ queuedMessages: messages })
  return true
}

/** A proven terminal workspace failure needs explicit user retry, not a new turn. */
export function failQueuedTaskWorkspace(
  workspace: WorkspaceIdentity,
  error: string,
  set: ChatStoreSet,
  get: ChatStoreGet
): void {
  const threadId = workspace.ownerThreadId
  const active = get().activeThreadId === threadId
  const messages = (active ? get().queuedMessages : queuedMessagesForThread(threadId)).map((message) =>
    (message.taskWorkspace || message.planBuild) && queuedTaskWorkspaceMatches(message, workspace) &&
    (isPendingQueuedMessage(message) || message.deliveryState === 'starting')
      ? { ...message, deliveryState: 'failed' as const, errorMessage: error } : message)
  if (saveQueuedMessagesForThread(threadId, messages) && active) set({ queuedMessages: messages })
}
