import { extraRootsForPrimary, type CodeWorkspaceFolderSetsRegistry } from './code-workspace-folder-sets'
import { readThreadWorktreeRegistry } from './thread-worktree-registry'
import { normalizeWorkspaceRoot } from './workspace-path'
import { resolveProjectWorkspacePath } from './worktree-project-path'

export function folderSetPrimaryForWorkspace(
  workspace: string,
  threadWorktrees = readThreadWorktreeRegistry().worktrees
): string {
  const normalized = normalizeWorkspaceRoot(workspace)
  if (!normalized) return ''
  return resolveProjectWorkspacePath(normalized, {
    threadWorktrees,
    candidateProjectPaths: Object.values(threadWorktrees).map((record) => record.projectPath)
  }) || normalized
}

export function extraRootsForWorkspace(
  workspace: string,
  registry?: CodeWorkspaceFolderSetsRegistry,
  threadWorktrees = readThreadWorktreeRegistry().worktrees
): string[] {
  return extraRootsForPrimary(folderSetPrimaryForWorkspace(workspace, threadWorktrees), registry)
}
