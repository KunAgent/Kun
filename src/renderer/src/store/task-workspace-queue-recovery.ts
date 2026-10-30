import { getProvider } from '../agent/registry'
import type { AgentProvider } from '../agent/types'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'
import { isPendingQueuedMessage, queuedMessagesForThread, readQueuedMessageRegistry } from './queued-message-persistence'
import { receiveTaskWorkspaceRecord, useTaskWorkspaceStore } from './task-workspace-store'

function hasParkedPlanBuild(threadId: string): boolean {
  return queuedMessagesForThread(threadId).some((message) => message.planBuild &&
    message.expectedThreadId === threadId && Boolean(message.clientRequestId) &&
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
    if (!hasParkedPlanBuild(threadId)) continue
    try {
      const result = await provider.listTaskWorkspaces({ ownerThreadId: threadId })
      if (!isCurrent() || !hasParkedPlanBuild(threadId)) continue
      const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
      const thread = get().adeThreads?.find((row) => row.id === threadId) ??
        get().threads.find((row) => row.id === threadId)
      if (thread?.archived || thread?.relation === 'side') continue
      const workspaceId = thread?.taskWorkspaceId || prep?.workspaceId
      const owner = result.records.filter((record) => record.ownerThreadId === threadId &&
        !record.unitId && (!workspaceId || record.workspaceId === workspaceId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      // Never fall back to an older ready workspace or the source checkout.
      if (!owner || owner.state !== 'ready' || !owner.path) continue
      receiveTaskWorkspaceRecord(owner)
      await bindReadyTaskWorkspace({ threadId, workspaceId: owner.workspaceId, state: 'ready',
        workspace: { path: owner.path, sourceRoot: owner.sourceRoot } }, set, get,
      () => isCurrent() && hasParkedPlanBuild(threadId) &&
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
