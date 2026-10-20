export type GitFileStatusCode =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'ignored'

export type GitFileStatusEntry = {
  /** Absolute path under the requested workspace root, spelled from that root. */
  path: string
  status: GitFileStatusCode
  /** Untracked or ignored directories are reported once, not file by file. */
  directory?: boolean
}

export type GitFileStatusResult =
  | {
      ok: true
      branch: string | null
      entries: GitFileStatusEntry[]
      /** More entries than the cap; the list holds the first ones. */
      truncated: boolean
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }
