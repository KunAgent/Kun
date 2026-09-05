import { useEffect } from 'react'
import {
  isCodeWorkspaceRemoved,
  rememberRemovedCodeWorkspace,
  type RemovedCodeWorkspacesRegistry
} from '../../lib/removed-code-workspaces'
import { useChatStore } from '../../store/chat-store'
import type { SidebarThreadWorktrees } from './sidebar-project-selectors'

/** Persist newly discovered custom Git worktree aliases for hidden projects. */
export function useRemovedWorkspaceDiscoveredAliases(
  discovered: SidebarThreadWorktrees,
  registry: RemovedCodeWorkspacesRegistry
): void {
  useEffect(() => {
    let next = registry
    for (const record of Object.values(discovered)) {
      if (!isCodeWorkspaceRemoved(record.projectPath, next) ||
          isCodeWorkspaceRemoved(record.worktreePath, next)) continue
      next = rememberRemovedCodeWorkspace({
        projectPath: record.projectPath,
        aliases: [record.worktreePath]
      }, next)
    }
    if (next !== registry) useChatStore.setState({ removedCodeWorkspaces: next })
  }, [discovered, registry])
}
