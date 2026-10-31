import { getProvider } from '../agent/registry'
import type { AgentProvider } from '../agent/types'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'
import { isPendingQueuedMessage, queuedMessagesForThread, readQueuedMessageRegistry } from './queued-message-persistence'
import { receiveTaskWorkspaceRecord, useTaskWorkspaceStore } from './task-workspace-store'
import { failQueuedTaskWorkspace, queuedTaskWorkspaceMatches, rememberQueuedTaskWorkspace } from './task-workspace-queue-identity'
import { workspaceRootScopeKey } from '../lib/workspace-path'

function parkedWorkspaceSubmission(threadId: string) {
  return queuedMessagesForThread(threadId).find((message) => (message.taskWorkspace || message.planBuild) &&
    message.expectedThreadId === threadId && Boolean(message.clientRequestId) && !message.editIntent &&
    (isPendingQueuedMessage(message) || message.deliveryState === 'starting'))
}

/** Recover first turns even when their owner has no live SSE/completion watch. */
export async function recoverTaskWorkspaceQueuedMessages(input: {
  provider: AgentProvider
  set: ChatStoreSet
  get: ChatStoreGet
  isCurrent?: () => boolean
}): Promise<void> {
  const { provider, set, get } = input
  const isCurrent = input.isCurrent ?? (() => true)
  if (!provider.listTaskWorkspaces || !provider.bindThreadTaskWorkspace) return
  for (const threadId of Object.keys(readQueuedMessageRegistry().threads)) {
    if (!isCurrent()) return
    if (!parkedWorkspaceSubmission(threadId)) continue
    try {
      const result = await provider.listTaskWorkspaces({ ownerThreadId: threadId })
      const submission = parkedWorkspaceSubmission(threadId)
      if (!isCurrent() || !submission) continue
      const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
      const thread = get().adeThreads?.find((row) => row.id === threadId) ??
        get().threads.find((row) => row.id === threadId)
      if (thread?.archived || thread?.relation === 'side') continue
      const workspaceId = submission.taskWorkspace?.workspaceId || thread?.taskWorkspaceId || prep?.workspaceId
      const owner = result.records.filter((record) => !record.unitId &&
        queuedTaskWorkspaceMatches(submission, record) && (!workspaceId || record.workspaceId === workspaceId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      // Never fall back to an older ready workspace or the source checkout.
      if (!owner || owner.isolation !== 'worktree') continue
      if (owner.state === 'failed') {
        receiveTaskWorkspaceRecord(owner)
        failQueuedTaskWorkspace(owner, owner.lastError || 'Task workspace preparation failed', set, get)
        continue
      }
      if (owner.state !== 'ready' || !owner.path || !owner.sourceRoot ||
        workspaceRootScopeKey(owner.path) === workspaceRootScopeKey(owner.sourceRoot)) continue
      if (!rememberQueuedTaskWorkspace(owner, set, get)) continue
      receiveTaskWorkspaceRecord(owner)
      await bindReadyTaskWorkspace({ threadId, workspaceId: owner.workspaceId, state: 'ready',
        workspace: { path: owner.path, sourceRoot: owner.sourceRoot } }, set, get,
      () => isCurrent() && parkedWorkspaceSubmission(threadId)?.id === submission.id &&
        useTaskWorkspaceStore.getState().prepByThread[threadId]?.workspaceId === owner.workspaceId)
    } catch {
      // Runtime may still be starting/reconnecting. Keep the durable request
      // and retry with the same clientRequestId on the next application tick.
    }
  }
}

/** Application lifetime, deliberately independent of route and selected thread. */
export function startTaskWorkspaceQueueRecovery(set: ChatStoreSet, get: ChatStoreGet): () => void {
  let disposed = false
  let running = false
  const tick = async (): Promise<void> => {
    if (disposed || running || get().runtimeConnection !== 'ready') return
    running = true
    try {
      await recoverTaskWorkspaceQueuedMessages({ provider: getProvider(), set, get,
        isCurrent: () => !disposed && get().runtimeConnection === 'ready' })
    } finally {
      running = false
    }
  }
  const timer = globalThis.setInterval(() => { void tick() }, 3_000)
  void tick()
  return () => { disposed = true; globalThis.clearInterval(timer) }
}
