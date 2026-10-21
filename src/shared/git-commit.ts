/**
 * Contract for the Changes panel's commit flow: working-tree state, per-file
 * stage / unstage / discard, commit, push and a model-written commit message.
 * Paths are repository-relative with forward slashes.
 */

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export type GitChangeEntry = {
  path: string
  /** Source path of a rename or copy. */
  previousPath?: string
  status: GitChangeStatus
  /** Line counts; null for binary files or files too large to count. */
  additions: number | null
  deletions: number | null
}

export type GitFailureReason = 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'

export type GitWorkingState =
  | {
      ok: true
      repositoryRoot: string
      /** Current branch; null when HEAD is detached. */
      branch: string | null
      /** Short id of HEAD; null before the first commit. */
      head: string | null
      /** Tracking branch such as `origin/main`; null when none is set. */
      upstream: string | null
      ahead: number
      behind: number
      /** Commits on HEAD that no remote has; equals `ahead` when an upstream exists. */
      unpushed: number
      /** Remote a push would use; null when the repository has no remote. */
      pushRemote: string | null
      staged: GitChangeEntry[]
      unstaged: GitChangeEntry[]
      truncated: boolean
    }
  | { ok: false; reason: GitFailureReason; message: string }

export type GitBranchCommit = { sha: string; subject: string; pushed: boolean }

export type GitBranchComparison =
  | {
      ok: true
      /** Ref the branch is compared with, such as `origin/develop`. */
      base: string
      /** Full id of the fork point. */
      mergeBase: string
      ahead: number
      behind: number
      /** Committed and uncommitted changes since the fork point. */
      files: GitChangeEntry[]
      commits: GitBranchCommit[]
      truncated: boolean
    }
  | { ok: false; reason: GitFailureReason | 'no_base'; message: string }

export type GitChangeSide = 'unstaged' | 'staged' | 'branch'

export type GitFileDiffRequest = {
  workspaceRoot: string
  side: GitChangeSide
  path: string
  previousPath?: string
  /** Fork point for the `branch` side. */
  mergeBase?: string
  untracked?: boolean
}

export type GitFileDiffResult =
  | { ok: true; diff: string; binary: boolean; truncated: boolean }
  | { ok: false; message: string }

export type GitPathsRequest = { workspaceRoot: string; paths?: string[] }

export type GitOperationResult = { ok: true } | { ok: false; message: string; output?: string }

export type GitDiscardResult =
  | { ok: true; restored: number; trashed: number }
  | { ok: false; message: string; output?: string }

export type GitCommitResult =
  | { ok: true; sha: string; subject: string }
  | {
      ok: false
      reason: 'nothing_to_commit' | 'empty_message' | 'error'
      message: string
      output?: string
    }

export type GitPushResult =
  | { ok: true; remote: string; branch: string; setUpstream: boolean; output: string }
  | {
      ok: false
      reason: 'detached' | 'no_remote' | 'rejected' | 'auth' | 'error'
      message: string
      /** The command as a person would type it, for the error card. */
      command: string
      output: string
    }

export type GitCommitMessageResult =
  | { ok: true; message: string; model: string }
  | { ok: false; reason: 'nothing_to_describe' | 'model' | 'error'; message: string }

export type KunGuiGitCommitApi = {
  getGitWorkingState: (workspaceRoot: string) => Promise<GitWorkingState>
  getGitBranchComparison: (workspaceRoot: string) => Promise<GitBranchComparison>
  getGitFileDiff: (request: GitFileDiffRequest) => Promise<GitFileDiffResult>
  /** Stages the paths, or every change when `paths` is omitted. */
  stageGitPaths: (request: GitPathsRequest) => Promise<GitOperationResult>
  /** Unstages the paths, or the whole index when `paths` is omitted. */
  unstageGitPaths: (request: GitPathsRequest) => Promise<GitOperationResult>
  /** Restores tracked paths from the index and moves untracked ones to the trash. */
  discardGitPaths: (request: { workspaceRoot: string; paths: string[]; confirmed: true }) => Promise<GitDiscardResult>
  commitGitChanges: (request: { workspaceRoot: string; message: string; stageAll?: boolean }) => Promise<GitCommitResult>
  /** Pushes the current branch, setting its upstream on the first push. */
  pushGitBranch: (request: { workspaceRoot: string }) => Promise<GitPushResult>
  generateGitCommitMessage: (request: { workspaceRoot: string; stageAll?: boolean }) => Promise<GitCommitMessageResult>
}
