export type GitCheckpointCreateResult =
  | {
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string
      currentBranch: string | null
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'unborn_head' | 'conflict' | 'error'
      message: string
    }

export type GitCheckpointRestoreResult =
  | {
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string
      currentBranch: string | null
      rescueCheckpointId: string | null
    }
  | {
      ok: false
      reason:
        | 'no_workspace'
        | 'not_git_repo'
        | 'git_unavailable'
        | 'not_found'
        | 'conflict'
        | 'partial'
        | 'error'
      message: string
      /**
       * Present when `reason === 'partial'`: untracked files that existed at
       * checkpoint time but were NOT snapshotted (over the size budget).
       * Restoring would `git clean` them with no way to bring them back, so the
       * restore is refused unless the caller opts in with `allowPartialRestore`.
       */
      skippedUntracked?: string[]
    }
