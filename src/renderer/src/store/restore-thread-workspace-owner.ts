import type { AgentProvider } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import {
  clearThreadWorkspacePrep, markThreadWorkspacePreparing, markThreadWorkspacePrepFailed,
  receiveTaskWorkspaceRecord, useTaskWorkspaceStore
} from './task-workspace-store'
import { bindReadyTaskWorkspace } from './chat-store-runtime-helpers'

const BINDABLE = new Set(['ready', 'captured', 'integrated', 'conflict', 'preserved'])

/** Recover a ready event missed while this task's SSE subscription was inactive. */
export async function restoreThreadWorkspaceOwner(
  provider: AgentProvider,
  threadId: string,
  set: ChatStoreSet,
  get: ChatStoreGet,
  stillCurrent: () => boolean
): Promise<boolean> {
  if (!stillCurrent()) return false
  const findThread = (state: ChatState) => state.threads.find((thread) => thread.id === threadId) ??
    state.adeThreads?.find((thread) => thread.id === threadId)
  const target = findThread(get())
  const previous = useTaskWorkspaceStore.getState().prepByThread[threadId]
  const repairBoundFailure = Boolean(target?.taskWorkspaceId && previous?.state === 'failed')
  if (!provider.listTaskWorkspaces || (target?.taskWorkspaceId && !repairBoundFailure) ||
    (readThreadWorktreeRegistry().worktrees[threadId] && !repairBoundFailure) || target?.relation === 'side') return true
  const expected = previous || target?.executionConfig?.isolation === 'worktree'
  if (expected) markThreadWorkspacePreparing(threadId, previous?.workspaceId ?? '')
  try {
    const result = await provider.listTaskWorkspaces({ ownerThreadId: threadId })
    if (!stillCurrent()) return false
    // A newer stream/bind wins over the query, including while navigation reused a cached view.
    const currentBinding = findThread(get())?.taskWorkspaceId
    if (currentBinding && (!repairBoundFailure || currentBinding !== target?.taskWorkspaceId)) return true
    const owner = result.records.filter((record) => record.ownerThreadId === threadId &&
      !record.unitId && record.state !== 'removed' &&
      (!currentBinding || record.workspaceId === currentBinding)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!owner) {
      if (expected) clearThreadWorkspacePrep(threadId)
      return true
    }
    const currentPrep = useTaskWorkspaceStore.getState().prepByThread[threadId]
    if (currentPrep?.workspaceId && currentPrep.workspaceId !== owner.workspaceId &&
      currentPrep.workspaceId !== previous?.workspaceId) return true
    if (currentPrep?.workspaceId !== owner.workspaceId) markThreadWorkspacePreparing(threadId, owner.workspaceId)
    const sameOwner = (): boolean => stillCurrent() &&
      useTaskWorkspaceStore.getState().prepByThread[threadId]?.workspaceId === owner.workspaceId
    receiveTaskWorkspaceRecord(owner)
    if (currentBinding === owner.workspaceId) {
      if (BINDABLE.has(owner.state) && previous?.error && get().error === previous.error) set({ error: null })
      return stillCurrent()
    }
    if (BINDABLE.has(owner.state)) {
      await bindReadyTaskWorkspace({ threadId, workspaceId: owner.workspaceId,
        state: 'ready', workspace: { path: owner.path, sourceRoot: owner.sourceRoot } }, set, get, sameOwner)
    }
    return stillCurrent()
  } catch (error) {
    if (!stillCurrent()) return false
    if (expected) markThreadWorkspacePrepFailed(threadId, error instanceof Error ? error.message : String(error))
    set({ error: error instanceof Error ? error.message : String(error) })
    return true
  }
}
