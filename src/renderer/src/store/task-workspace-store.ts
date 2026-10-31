import { create } from 'zustand'
import type { ChatState, QueuedUserMessage } from './chat-store-types'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import { queuedTaskWorkspaceRequirement } from './task-workspace-queue-identity'
import type {
  TaskWorkspaceRecord,
  TaskWorkspaceState,
  TaskWorkspaceThreadEvent
} from '@shared/task-workspace'

/**
 * Composer-facing task-workspace preparation state.
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
  /** Set only after the Runtime acknowledges the owner-thread binding. */
  bound?: boolean
  /** Original project directory; `path` is the isolated execution directory. */
  sourceRoot?: string
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
  workspaceId: string,
  sourceRoot?: string
): void {
  const thread = threadId.trim()
  if (!thread) return
  useTaskWorkspaceStore.setState((state) => ({
    prepByThread: {
      ...state.prepByThread,
      [thread]: { workspaceId, ownerThreadId: thread, state: 'creating', ...(sourceRoot ? { sourceRoot } : {}) }
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

// A failed isolation request must never send the parked input in the source checkout.
export function threadWorkspaceBlocksSend(
  threadId: string | null | undefined,
  state: Pick<ChatState, 'threads' | 'adeThreads'> = { threads: [], adeThreads: [] }
): boolean {
  if (!threadId) return false
  if (threadWorkspacePreparing(threadId) || useTaskWorkspaceStore.getState().prepByThread[threadId]?.state === 'failed') return true
  const requirement = queuedTaskWorkspaceRequirement(threadId)
  return Boolean(requirement && !threadHasBoundTaskWorkspace(threadId, state, requirement.taskWorkspace))
}

export function threadHasBoundTaskWorkspace(
  threadId: string,
  state: Pick<ChatState, 'threads' | 'adeThreads'>,
  required?: QueuedUserMessage['taskWorkspace']
): boolean {
  const thread = state.threads.find((row) => row.id === threadId) ?? state.adeThreads?.find((row) => row.id === threadId)
  const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
  if (!required) return Boolean(thread?.taskWorkspaceId || (prep?.bound && prep.state === 'ready' && prep.path))
  const workspaceId = thread?.taskWorkspaceId || (prep?.bound && prep.state === 'ready' ? prep.workspaceId : '')
  const path = thread?.taskWorkspaceId ? thread.workspace : prep?.path
  return Boolean(workspaceId && path && required.sourceRoot &&
    (!required.workspaceId || required.workspaceId === workspaceId) &&
    workspaceRootScopeKey(path) !== workspaceRootScopeKey(required.sourceRoot))
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
  if (record.unitId) return
  const threadId = record.ownerThreadId?.trim()
  if (!threadId) return
  useTaskWorkspaceStore.setState((state) => {
    const existing = state.prepByThread[threadId]
    if (
      existing?.workspaceId &&
      existing.workspaceId !== record.workspaceId &&
      (record.state === 'ready' || record.state === 'failed')
    ) {
      // A superseded workspace finished late — keep tracking the newer one.
      return {}
    }
    if (
      existing && existing.state === 'ready' && record.workspaceId === existing.workspaceId &&
      existing.sourceRoot
    ) {
      return {}
    }
    return {
      prepByThread: {
        ...state.prepByThread,
        [threadId]: {
          workspaceId: record.workspaceId,
          ownerThreadId: threadId,
          state: record.state,
          ...(existing?.bound && existing.workspaceId === record.workspaceId && existing.path === record.path ? { bound: true } : {}),
          ...(record.path ? { path: record.path } : {}),
          ...(record.sourceRoot ? { sourceRoot: record.sourceRoot } : {}),
          ...(record.lastError ? { error: record.lastError } : {})
        }
      }
    }
  })
}

/** SSE entry for `task_workspace` events on the owner thread. */
export function receiveTaskWorkspaceThreadEvent(ev: TaskWorkspaceThreadEvent): void {
  if (ev.unitId) return
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
          ...(existing?.bound && existing.workspaceId === workspaceId &&
            (!ev.workspace?.path || existing.path === ev.workspace.path) ? { bound: true } : {}),
          ...(ev.progress ? { progress: ev.progress } : {}),
          ...(ev.workspace?.path ? { path: ev.workspace.path } : existing?.path
            ? { path: existing.path }
            : {}),
          ...(ev.workspace?.sourceRoot ? { sourceRoot: ev.workspace.sourceRoot }
            : existing?.sourceRoot ? { sourceRoot: existing.sourceRoot } : {})
        }
      }
    }
  })
}
