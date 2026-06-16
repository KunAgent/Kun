/**
 * Shared types for the Git worktree pool feature.
 *
 * A pool of up to MAX_POOL_SIZE worktrees is maintained per project so that
 * multiple agents can work on the same repository in parallel on isolated
 * branches without interfering with each other.
 */

export const MAX_WORKTREE_POOL_SIZE = 3
export const WORKTREE_BRANCH_PREFIX = 'kun-pool'

export interface WorktreeInfo {
  poolIndex: number
  path: string
  branch: string
  inUse: boolean
  taskId: string | null
  baseCommit: string
  changesCount: number
}

export interface WorktreePoolStatus {
  projectPath: string
  poolDir: string
  mainBranch: string
  headCommit: string
  worktrees: WorktreeInfo[]
  inUseCount: number
  isGitRepo: boolean
}

export interface WorktreeChanges {
  worktreePath: string
  baseCommit: string
  currentCommit: string
  modifiedFiles: string[]
  addedFiles: string[]
  deletedFiles: string[]
  hasUncommittedChanges: boolean
}

export interface MergeResult {
  success: boolean
  mergedCommit: string | null
  hasConflicts: boolean
  conflictedFiles: string[]
  message: string
}

export interface SyncResult {
  success: boolean
  syncedCommit: string | null
  hasConflicts: boolean
  conflictedFiles: string[]
  message: string
}

/**
 * Special error message format emitted by acquireWorktree when the target
 * worktree already exists and contains uncommitted changes but force was not
 * requested. The renderer parses this to show a confirmation dialog.
 *
 * Format: `WORKTREE_HAS_CHANGES:{poolIndex}:{changesCount}`
 */
export const WORKTREE_HAS_CHANGES_PREFIX = 'WORKTREE_HAS_CHANGES:'

export function parseWorktreeHasChangesError(
  message: string
): { poolIndex: number; changesCount: number } | null {
  if (!message.startsWith(WORKTREE_HAS_CHANGES_PREFIX)) return null
  const parts = message.slice(WORKTREE_HAS_CHANGES_PREFIX.length).split(':')
  if (parts.length !== 2) return null
  const poolIndex = Number(parts[0])
  const changesCount = Number(parts[1])
  if (!Number.isFinite(poolIndex) || !Number.isFinite(changesCount)) return null
  return { poolIndex, changesCount }
}
