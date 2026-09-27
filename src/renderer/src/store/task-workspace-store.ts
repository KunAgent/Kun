import { create } from 'zustand'
import type {
  TaskWorkspaceRecord,
  TaskWorkspaceState,
  TaskWorkspaceThreadEvent
} from '@shared/task-workspace'

/**
 * Composer-facing task-workspace preparation state (docs/ade/12 §7.3).
 *
 * A new ADE thread may request a fresh worktree at creation; the workspace
 * prepares asynchronously and `task_workspace` events on the owner thread
 * report progress. Sends submitted before `ready` are queued locally and
 * drained by the store's ready handler.
 */
export type TaskWorkspacePrep = {
  workspaceId: string
  ownerThreadId: string
  state: TaskWorkspaceState
  progress?: { step?: string; percent?: number; message?: string }
  path?: string
  /** Terminal creation error shown with a retry affordance. */
  error?: string
}

type TaskWorkspaceStoreState = {
  prepByThread: Record<string, TaskWorkspacePrep>
}

export const useTaskWorkspaceStore = create<TaskWorkspaceStoreState>(() => ({
  prepByThread: {}
}))

export function markThreadWorkspacePreparing(
  threadId: string,
  workspaceId: string
): void {
  const thread = threadId.trim()
  if (!thread) return
  useTaskWorkspaceStore.setState((state) => ({
    prepByThread: {
      ...state.prepByThread,
      [thread]: { workspaceId, ownerThreadId: thread, state: 'creating' }
    }
  }))
}

export function clearThreadWorkspacePrep(threadId: string): void {
  useTaskWorkspaceStore.setState((state) => {
    if (!state.prepByThread[threadId]) return {}
    const next = { ...state.prepByThread }
    delete next[threadId]
    return { prepByThread: next }
  })
}

/** True while the thread's requested workspace is still preparing. */
export function threadWorkspacePreparing(threadId: string | null | undefined): boolean {
  if (!threadId) return false
  const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
  return prep?.state === 'creating' || prep?.state === 'setting-up'
}

/** Mark a create/prepare attempt failed; the composer shows retry. */
export function markThreadWorkspacePrepFailed(threadId: string, error: string): void {
  const thread = threadId.trim()
  if (!thread) return
  useTaskWorkspaceStore.setState((state) => {
    const existing = state.prepByThread[thread]
    if (!existing) return {}
    return {
      prepByThread: {
        ...state.prepByThread,
        [thread]: { ...existing, state: 'failed', error }
      }
    }
  })
}

/** Seed prep state from a REST record (create response / retry). */
export function receiveTaskWorkspaceRecord(record: TaskWorkspaceRecord): void {
  const threadId = record.ownerThreadId?.trim()
  if (!threadId) return
  useTaskWorkspaceStore.setState((state) => {
    const existing = state.prepByThread[threadId]
    if (
      existing &&
      existing.workspaceId !== record.workspaceId &&
      (record.state === 'ready' || record.state === 'failed')
    ) {
      // A superseded workspace finished late — keep tracking the newer one.
      return {}
    }
    if (existing && existing.state === 'ready' && record.workspaceId === existing.workspaceId) {
      return {}
    }
    return {
      prepByThread: {
        ...state.prepByThread,
        [threadId]: {
          workspaceId: record.workspaceId,
          ownerThreadId: threadId,
          state: record.state,
          ...(record.path ? { path: record.path } : {}),
          ...(record.lastError ? { error: record.lastError } : {})
        }
      }
    }
  })
}

/** SSE entry for `task_workspace` events on the owner thread (07 §5). */
export function receiveTaskWorkspaceThreadEvent(ev: TaskWorkspaceThreadEvent): void {
  const threadId = ev.threadId.trim()
  const workspaceId = ev.workspaceId.trim()
  if (!threadId || !workspaceId) return
  useTaskWorkspaceStore.setState((state) => {
    const existing = state.prepByThread[threadId]
    if (existing && existing.workspaceId !== workspaceId) {
      // Stale event for a superseded workspace.
      if (existing.state === 'ready' || existing.state === 'failed') return {}
    }
    return {
      prepByThread: {
        ...state.prepByThread,
        [threadId]: {
          workspaceId,
          ownerThreadId: threadId,
          state: ev.state,
          ...(ev.progress ? { progress: ev.progress } : {}),
          ...(ev.workspace?.path ? { path: ev.workspace.path } : existing?.path
            ? { path: existing.path }
            : {})
        }
      }
    }
  })
}
