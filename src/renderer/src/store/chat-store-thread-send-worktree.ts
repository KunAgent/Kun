import type { AgentProvider } from '../agent/types'
import type {
  CreateTaskWorkspaceRequest,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import type { QueuedUserMessage } from './chat-store-types'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { buildThreadEventSink } from './chat-store-runtime'
import { subscribeThreadEventsWithRecovery } from './chat-store-thread-action-helpers'
import {
  markThreadWorkspacePreparing,
  markThreadWorkspacePrepFailed,
  receiveTaskWorkspaceRecord
} from './task-workspace-store'
import { upsertQueuedSubmission, type StoreActionContext } from './chat-store-thread-actions-support'
import type { ChatState } from './chat-store-types'

/**
 * New-session worktree isolation (12 §7.3): subscribe for the task_workspace
 * lifecycle, kick off async prep, and park the submission in the local queue
 * until the workspace reports `ready` (the sink's ready handler drains it).
 * Returns the created record, or null when preparation failed to start.
 */
export async function prepareAdeThreadWorktree(args: {
  provider: AgentProvider
  threadId: string
  workspaceRoot: string
  context: StoreActionContext
  submittedMessageForQueue: QueuedUserMessage
  persistActiveQueuedMessages: () => void
  /** Frozen at submission (plan builds pin current-head). */
  startFrom?: CreateTaskWorkspaceRequest['startFrom']
  label?: string
}): Promise<TaskWorkspaceRecord | null> {
  const { provider: p, threadId, workspaceRoot, submittedMessageForQueue } = args
  const { set, get, sseAbortRef } = args.context
  const ac = new AbortController()
  sseAbortRef.current = ac
  const sink = buildThreadEventSink(set, get, { threadId, signal: ac.signal, sinceSeq: 0 })
  subscribeThreadEventsWithRecovery(p, threadId, 0, sink, ac.signal, get)
  // Seed `creating` before the POST resolves so a failed create leaves a
  // retryable prep entry instead of a silent stall.
  markThreadWorkspacePreparing(threadId, '')
  let record: TaskWorkspaceRecord | null = null
  try {
    const created = await p.createTaskWorkspace!({
      ownerThreadId: threadId,
      sourceRoot: workspaceRoot,
      isolation: 'worktree',
      ...(args.label?.trim() ? { label: args.label.trim() } : {}),
      ...(args.startFrom ? { startFrom: args.startFrom } : {})
    })
    record = created.record
    receiveTaskWorkspaceRecord(created.record)
  } catch (workspaceError) {
    markThreadWorkspacePrepFailed(
      threadId,
      workspaceError instanceof Error ? workspaceError.message : String(workspaceError)
    )
  }
  const pending = { ...submittedMessageForQueue, deliveryState: 'pending' as const }
  const active = get().activeThreadId === threadId
  const queuedMessages = upsertQueuedSubmission(
    active ? get().queuedMessages : queuedMessagesForThread(threadId), pending
  )
  if (active) {
    set((_s: ChatState) => ({ busy: false, busyUnconfirmed: false, queuedMessages }))
  }
  saveQueuedMessagesForThread(threadId, queuedMessages)
  if (active) args.persistActiveQueuedMessages()
  return record
}
