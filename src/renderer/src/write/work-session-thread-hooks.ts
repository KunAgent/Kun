import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useWriteWorkspaceStore } from './write-workspace-store'
import {
  beginWorkSessionTransition,
  currentWorkSessionPin,
  useWorkSidebarStore,
  workDocumentKey,
  type WorkSessionPin
} from './work-sidebar-store'

/** The pin that applies to `workspaceRoot`, compared against what is open there. */
function workspacePin(workspaceRoot: string): WorkSessionPin | null {
  const write = useWriteWorkspaceStore.getState()
  const mounted = normalizeWorkspaceRoot(write.workspaceRoot) === normalizeWorkspaceRoot(workspaceRoot)
  return currentWorkSessionPin(workspaceRoot, mounted ? write : null)
}

/**
 * The pinned session that a Work send in `workspaceRoot` should reuse: only
 * when it is already the active thread, so a stale pin never redirects a turn.
 */
export function pinnedWriteSessionId(workspaceRoot: string, activeThreadId: string | null): string | null {
  const pin = workspacePin(workspaceRoot)
  return pin?.threadId && pin.threadId === activeThreadId ? pin.threadId : null
}

/** A draft is pending: the next send must start a new session, never reuse one. */
export function workSessionDraftPending(workspaceRoot: string): boolean {
  const pin = workspacePin(workspaceRoot)
  return pin !== null && !pin.threadId
}

/** Pins an explicitly chosen Work thread while it is being selected. */
export async function selectPinnedWorkSession(
  workspaceRoot: string,
  threadId: string,
  select: () => Promise<void>
): Promise<void> {
  const end = beginWorkSessionTransition()
  try {
    if (workspaceRoot) {
      useWorkSidebarStore.getState().pinSession(workspaceRoot, threadId, workDocumentKey(useWriteWorkspaceStore.getState()))
    }
    await select()
  } finally {
    end()
  }
}
