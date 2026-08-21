import type { TerminalTarget } from './terminal-backend'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'

const TERMINAL_SESSION_PREFIX = 'terminal'

export function terminalWorkspaceSessionKey(workspaceRoot: string): string {
  return workspaceRootIdentityKey(workspaceRoot) || 'no-workspace'
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function terminalSessionIdForWorkspace(
  workspaceRoot: string,
  tabId: string,
  target: TerminalTarget = { kind: 'local' }
): string {
  const workspaceKey = terminalWorkspaceSessionKey(workspaceRoot)
  const tabKey = tabId.trim() || 'main'
  if (target.kind === 'local') {
    return `${TERMINAL_SESSION_PREFIX}:${hashString(workspaceKey)}:${tabKey}`
  }
  return `${TERMINAL_SESSION_PREFIX}:${hashString(workspaceKey)}:ssh-${hashString(target.hostId)}:${tabKey}`
}
