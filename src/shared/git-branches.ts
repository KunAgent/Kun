export type GitBranchRow = {
  name: string
  current: boolean
  /**
   * Absolute path of another worktree that already has this branch checked out.
   * Git only allows a branch to live in one worktree at a time, so when this is
   * set an in-place `git switch` would fail — the UI navigates to this path
   * instead. Unset when the branch is free to be checked out here.
   */
  worktreePath?: string
  /** True when {@link worktreePath} is the repository's primary (main) worktree. */
  worktreePrimary?: boolean
}

export type GitBranchesResult =
  | {
      ok: true
      repositoryRoot: string
      /** Absolute path of the repository's primary (main) worktree. */
      primaryRepositoryRoot: string
      currentBranch: string | null
      branches: GitBranchRow[]
      dirtyCount: number
      /** Free bytes on the volume that holds `~/.kun/worktrees`; null when unknown. */
      worktreeFreeBytes?: number | null
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitWorktreeCheckoutResult =
  | {
      ok: true
      repositoryRoot: string
      primaryRepositoryRoot: string
      sourceRepositoryRoot: string
      worktreePath: string
      currentBranch: string | null
      branches: GitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitBranchWorktreeRow = {
  path: string
  branch: string | null
  head: string
}

export type GitBranchWorktreesResult =
  | {
      ok: true
      repositoryRoot: string
      worktreeRoot: string
      worktrees: GitBranchWorktreeRow[]
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }
