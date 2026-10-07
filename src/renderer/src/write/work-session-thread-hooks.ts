import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useWriteWorkspaceStore } from './write-workspace-store'
import {
  beginWorkSessionTransition,
  currentWorkSessionPin,
  useWorkSidebarStore,
  writeHasDocumentContext
} from './work-sidebar-store'

/**
 * The pinned session that a Work send in `workspaceRoot` should reuse: only
 * when it is already the active thread, so a stale pin never redirects a turn.
 */
export function pinnedWriteSessionId(workspaceRoot: string, activeThreadId: string | null): string | null {
  const write = useWriteWorkspaceStore.getState()
  const mounted = normalizeWorkspaceRoot(write.workspaceRoot) === normalizeWorkspaceRoot(workspaceRoot)
  const pin = currentWorkSessionPin(workspaceRoot, mounted ? writeHasDocumentContext(write) : true)
  return pin?.threadId && pin.threadId === activeThreadId ? pin.threadId : null
}

/** Pins an explicitly chosen Work thread while it is being selected. */
export async function selectPinnedWorkSession(
  workspaceRoot: string,
  threadId: string,
  select: () => Promise<void>
): Promise<void> {
  const end = beginWorkSessionTransition()
  try {
    if (workspaceRoot) useWorkSidebarStore.getState().pinSession(workspaceRoot, threadId)
    await select()
  } finally {
    end()
  }
}
