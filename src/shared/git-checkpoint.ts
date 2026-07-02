export type GitCheckpointManifest = {
  version: 1
  checkpointId: string
  threadId: string
  workspaceRoot: string
  repositoryRoot: string
  head: string
  currentBranch: string | null
  createdAt: string
  completeness: 'complete' | 'partial'
  untrackedFiles: string[]
  skippedUntracked?: string[]
  turnId?: string
  userMessageItemId?: string
}

export type GitCheckpointCreateResult =
  | {
      ok: true
      checkpointId: string
      repositoryRoot: string
      head: string
      currentBranch: string | null
      manifest: GitCheckpointManifest
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'conflict' | 'error'
      message: string
    }

export type GitCheckpointManifestUpdateResult =
  | {
      ok: true
      checkpointId: string
      manifest: GitCheckpointManifest
    }
  | {
      ok: false
      reason: 'not_found' | 'mismatch' | 'error'
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
      manifest: GitCheckpointManifest
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
        | 'mismatch'
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
