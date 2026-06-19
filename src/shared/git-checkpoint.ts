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
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'conflict' | 'error'
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
        | 'error'
      message: string
    }
