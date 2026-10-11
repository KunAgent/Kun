import type { ChatState } from '../store/chat-store-types'
import { readThreadWorktreeRegistry } from './thread-worktree-registry'

/** Existing task bindings and historical pool entries are already isolated. */
export function threadHasIsolatedWorkspace(
  state: Pick<ChatState, 'threads' | 'adeThreads'>,
  threadId: string | null | undefined
): boolean {
  if (!threadId) return false
  const thread = state.threads.find((item) => item.id === threadId) ??
    state.adeThreads?.find((item) => item.id === threadId)
  return Boolean(thread?.taskWorkspaceId || readThreadWorktreeRegistry().worktrees[threadId])
}
