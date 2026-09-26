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
