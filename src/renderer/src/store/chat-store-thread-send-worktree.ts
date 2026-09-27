import type { AgentProvider } from '../agent/types'
import type { QueuedUserMessage } from './chat-store-types'
import { saveQueuedMessagesForThread } from './queued-message-persistence'
import { buildThreadEventSink } from './chat-store-runtime'
import { subscribeThreadEventsWithRecovery } from './chat-store-thread-action-helpers'
import {
  markThreadWorkspacePrepFailed,
  receiveTaskWorkspaceRecord
} from './task-workspace-store'
import { upsertQueuedSubmission, type StoreActionContext } from './chat-store-thread-actions-support'
import type { ChatState } from './chat-store-types'

/**
 * New-session worktree isolation (12 §7.3): subscribe for the task_workspace
 * lifecycle, kick off async prep, and park the submission in the local queue
 * until the workspace reports `ready` (the sink's ready handler drains it).
 */
export async function prepareAdeThreadWorktree(args: {
  provider: AgentProvider
  threadId: string
  workspaceRoot: string
  context: StoreActionContext
  submittedMessageForQueue: QueuedUserMessage
  persistActiveQueuedMessages: () => void
}): Promise<void> {
  const { provider: p, threadId, workspaceRoot, submittedMessageForQueue } = args
  const { set, get, sseAbortRef } = args.context
  const ac = new AbortController()
  sseAbortRef.current = ac
  const sink = buildThreadEventSink(set, get, { threadId, signal: ac.signal, sinceSeq: 0 })
  subscribeThreadEventsWithRecovery(p, threadId, 0, sink, ac.signal, get)
  try {
    const created = await p.createTaskWorkspace!({
      ownerThreadId: threadId,
      sourceRoot: workspaceRoot,
      isolation: 'worktree',
      ...(get().composerWorktreeStartFrom
        ? { startFrom: get().composerWorktreeStartFrom }
        : {})
    })
    receiveTaskWorkspaceRecord(created.record)
  } catch (workspaceError) {
    markThreadWorkspacePrepFailed(
      threadId,
      workspaceError instanceof Error ? workspaceError.message : String(workspaceError)
    )
  }
  set((s: ChatState) => ({
    busy: false,
    busyUnconfirmed: false,
    queuedMessages: upsertQueuedSubmission(s.queuedMessages, {
      ...submittedMessageForQueue,
      deliveryState: 'pending' as const
    })
  }))
  saveQueuedMessagesForThread(threadId, get().queuedMessages)
  args.persistActiveQueuedMessages()
}
