import type { ChatState } from './chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

/**
 * The current Code project. The store is authoritative — a Remote mobile
 * session may hold a renderer-local selection (`persist: false`) — and the
 * host `settings.workspaceRoot` is only a fallback when the store is empty.
 */
export function currentCodeWorkspaceRoot(
  state: Pick<ChatState, 'workspaceRoot'>,
  settings: { workspaceRoot: string }
): string {
  return normalizeWorkspaceRoot(state.workspaceRoot) ||
    normalizeWorkspaceRoot(settings.workspaceRoot)
}
