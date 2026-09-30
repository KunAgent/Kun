import type { ChatState } from './chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

/** A failed automatic default must be repaired or explicitly replaced before send. */
export function codeDefaultRouteError(state: ChatState): string | undefined {
  const defaults = state.composerProjectDefaults
  return !state.activeThreadId && state.route === 'chat' && defaults?.routeError &&
    defaults.workspaceRoot === normalizeWorkspaceRoot(state.workspaceRoot) &&
    state.composerRouteExplicitWorkspaceRoot !== defaults.workspaceRoot
    ? defaults.routeError : undefined
}
