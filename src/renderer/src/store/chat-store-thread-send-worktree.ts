import type { AgentProvider } from '../agent/types'
import type {
  CreateTaskWorkspaceRequest,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import type { QueuedUserMessage } from './chat-store-types'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'
import { queuedMessagesForThread, saveQueuedMessagesForThread } from './queued-message-persistence'
import { buildThreadEventSink } from './chat-store-runtime'
import { subscribeThreadEventsWithRecovery } from './chat-store-thread-action-helpers'
import {
  markThreadWorkspacePreparing,
  markThreadWorkspacePrepFailed,
  receiveTaskWorkspaceRecord,
  useTaskWorkspaceStore
} from './task-workspace-store'
import { upsertQueuedSubmission, type StoreActionContext } from './chat-store-thread-actions-support'

/**
 * New-session worktree isolation: subscribe for the task_workspace
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
  markThreadWorkspacePreparing(threadId, '')
  const ac = new AbortController()
  sseAbortRef.current = ac
  const sink = buildThreadEventSink(set, get, { threadId, signal: ac.signal, sinceSeq: 0 })
  subscribeThreadEventsWithRecovery(p, threadId, 0, sink, ac.signal, get)
  // Persist before requesting preparation: the response or ready event can
  // arrive after navigation, or after a renderer restart.
  const pending = { ...submittedMessageForQueue, deliveryState: 'pending' as const }
  const active = get().activeThreadId === threadId
  const queuedMessages = upsertQueuedSubmission(
    active ? get().queuedMessages : queuedMessagesForThread(threadId), pending
  )
  if (active) {
    set({ busy: false, busyUnconfirmed: false, queuedMessages })
  }
  saveQueuedMessagesForThread(threadId, queuedMessages)
  if (active) args.persistActiveQueuedMessages()
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
  const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
  if (prep?.state === 'ready' && prep.path) {
    await bindReadyTaskWorkspace({ threadId, workspaceId: prep.workspaceId, state: 'ready',
      workspace: { path: prep.path } }, set, get)
  }
  return record
}
