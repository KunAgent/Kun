/**
 * Renderer-facing mirrors of kun/src/contracts/task-workspace.ts and the
 * /v1/task-workspaces diff responses (docs/ade/11 §3). The wire shape is
 * owned by the kun contract; keep field names aligned.
 */

export type TaskWorkspaceIsolation = 'worktree' | 'local' | 'directory'

export type TaskWorkspaceState =
  | 'creating'
  | 'setting-up'
  | 'ready'
  | 'failed'
  | 'captured'
  | 'integrated'
  | 'conflict'
  | 'preserved'
  | 'removed'
  | 'orphaned'

export type TaskWorkspaceRecord = {
  workspaceId: string
  ownerThreadId: string
  unitId?: string
  label?: string
  isolation: TaskWorkspaceIsolation
  sourceRoot: string
  repositoryRoot?: string
  path: string
  baseRevision?: string
  branch?: string
  targetBranch?: string
  headRevision?: string
  state: TaskWorkspaceState
  changedFiles: string[]
  patchArtifactId?: string
  lastError?: string
  recovery?: string[]
  createdAt: string
  updatedAt: string
}

export type TaskWorkspaceListResponse = { records: TaskWorkspaceRecord[] }

export type TaskWorkspaceDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'

export type TaskWorkspaceDiffFile = {
  path: string
  oldPath?: string
  status: TaskWorkspaceDiffFileStatus
  insertions: number
  deletions: number
  binary: boolean
  tooLarge: boolean
}

export type TaskWorkspaceDiffListResponse = {
  files: TaskWorkspaceDiffFile[]
  headRevision?: string
}

export type TaskWorkspaceDiffFileResponse = TaskWorkspaceDiffFile & {
  patch?: string
  oldText?: string
  newText?: string
}

/** GET /v1/task-workspaces/:id/integrate-preview (docs/ade/11 §7.1). */
export type TaskWorkspaceIntegratePreview = {
  canApplyPatch: boolean
  applyBlockReason?: string
  canMergeBranch: boolean
  mergeBlockReason?: string
  hasUncommitted: boolean
  hasRemote: boolean
}

export type TaskWorkspaceIntegratePreviewResponse = {
  preview: TaskWorkspaceIntegratePreview
}

export type TaskWorkspaceIntegrateOutcome =
  | 'applied'
  | 'merged'
  | 'needs_human'
  | 'conflict'

export type TaskWorkspaceIntegrateMode = 'apply-patch' | 'merge-branch'

export type TaskWorkspaceIntegrateResponse = {
  record: TaskWorkspaceRecord
  outcome: TaskWorkspaceIntegrateOutcome
  reason?: string
  recovery?: string[]
}

export type TaskWorkspaceRecordResponse = { record: TaskWorkspaceRecord }

/** POST /v1/task-workspaces `startFrom` discriminated union (07 §4). */
export type TaskWorkspaceStartFrom =
  | { kind: 'default-branch' }
  | { kind: 'current-head' }
  | { kind: 'branch'; name: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'remote-branch'; remote: string; name: string }

/** POST /v1/task-workspaces request body (07 §5). */
export type CreateTaskWorkspaceRequest = {
  ownerThreadId: string
  unitId?: string
  label?: string
  sourceRoot: string
  isolation?: TaskWorkspaceIsolation
  startFrom?: TaskWorkspaceStartFrom
}

/** `task_workspace` runtime-event payload projected onto the owner thread (07 §5). */
export type TaskWorkspaceThreadEvent = {
  threadId: string
  turnId?: string
  workspaceId: string
  unitId?: string
  state: TaskWorkspaceState
  progress?: { step?: string; percent?: number; message?: string }
  workspace?: { path?: string; sourceRoot?: string; kind?: string; branch?: string }
}

/** 409 body of POST discard without `confirm` (damage preview, 07 §9). */
export type TaskWorkspaceDiscardPreview = {
  uncommittedFiles: number
  unpushedCommits: number
}

/**
 * Branch kept for human review after cleanup declined to delete it
 * (`git branch -d` refused — unmerged commits). Listed by
 * GET /v1/task-workspaces/preserved-branches (07 §8.3).
 */
export type PreservedBranchInfo = {
  branch: string
  lastCommit: string
  aheadBy: number
}

export type PreservedBranchesResponse = { branches: PreservedBranchInfo[] }

/** GET /v1/task-workspaces/:id/attribution?path= (docs/ade/11 §6). */
export type TaskWorkspaceAttributionLine = {
  /** 1-based line in the file's current content. */
  line: number
  unitId?: string
  harnessId?: string
  dispatchId?: string
  /** Worker/agent display label resolved from the team roster. */
  label?: string
}

export type TaskWorkspaceAttribution = {
  workspaceId: string
  path: string
  /** Only attributed lines are listed; absence means human-or-unknown. */
  lines: TaskWorkspaceAttributionLine[]
  tooLarge?: boolean
}
