import { useEffect, useState } from 'react'
import type { GitBranchesResult } from '@shared/git-branches'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import type { SidebarThreadWorktrees } from './sidebar-project-selectors'

export type SidebarGitBranchesReader = (
  workspaceRoot: string
) => Promise<GitBranchesResult>

/**
 * Resolve linked worktrees through Git instead of guessing from directory
 * names. This also covers user-managed layouts such as `<repo>.worktrees/x`.
 */
export async function discoverSidebarWorktrees(
  workspacePaths: readonly string[],
  readBranches: SidebarGitBranchesReader
): Promise<SidebarThreadWorktrees> {
  const uniquePaths = new Map<string, string>()
  for (const workspacePath of workspacePaths) {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    const key = workspaceRootIdentityKey(normalized)
    if (key && !uniquePaths.has(key)) uniquePaths.set(key, normalized)
  }

  const results = await Promise.all([...uniquePaths.entries()].map(async ([key, workspacePath]) => {
    try {
      const result = await readBranches(workspacePath)
      if (!result.ok) return null
      const projectPath = normalizeWorkspaceRoot(result.primaryRepositoryRoot)
      const repositoryRoot = normalizeWorkspaceRoot(result.repositoryRoot)
      if (
        !projectPath || !repositoryRoot ||
        workspaceRootIdentityKey(projectPath) === workspaceRootIdentityKey(repositoryRoot)
      ) return null
      return {
        key: `git:${key}`,
        record: {
          projectPath,
          // Preserve the selected workspace (which can be a repository
          // subdirectory) so thread/path matching remains exact.
          worktreePath: workspacePath,
          branch: result.currentBranch?.trim() || 'worktree'
        }
      }
    } catch {
      return null
    }
  }))

  return Object.fromEntries(
    results.flatMap((result) => result ? [[result.key, result.record] as const] : [])
  )
}

/** Discovers linked worktrees for the given serialized workspace path set. */
export function useSidebarWorktreeDiscovery(worktreeDiscoveryKey: string): SidebarThreadWorktrees {
  const [discovered, setDiscovered] = useState<SidebarThreadWorktrees>({})

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.kunGui?.getGitBranches !== 'function') return
    let cancelled = false
    setDiscovered({})
    const workspacePaths = JSON.parse(worktreeDiscoveryKey) as string[]
    void discoverSidebarWorktrees(
      workspacePaths,
      (workspacePath) => window.kunGui.getGitBranches(workspacePath)
    ).then((records) => {
      if (!cancelled) setDiscovered(records)
    })
    return () => {
      cancelled = true
    }
  }, [worktreeDiscoveryKey])

  return discovered
}
