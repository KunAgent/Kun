import { normalizeGraphRelativePath } from '../contracts/graph-path.js'
import { graphHostRelativePathsOverlap } from '../graph/graph-platform-path.js'
import type { TaskWorkspaceStore } from './task-workspace-store.js'
import {
  workspaceGit,
  workingTreeChangedFiles
} from './workspace-git.js'
import type {
  TaskWorkspaceIntegratePreview,
  TaskWorkspaceRecord
} from '../contracts/task-workspace.js'

/**
 * Read-only integrate preview (docs/ade/11 §7.1): every probe is a
 * `status`/`diff`/`rev-parse`/`remote` query — nothing stages, writes, or
 * locks. The buttons stay accurate between captures by diffing the worktree
 * against its base revision on demand.
 */

export type TaskWorkspacePreviewDeps = {
  store: Pick<TaskWorkspaceStore, 'get' | 'list'>
  git?: typeof workspaceGit
}

const INTEGRABLE = new Set(['ready', 'captured', 'conflict'])

function blocked(
  reason: string,
  flags?: { hasUncommitted?: boolean; hasRemote?: boolean }
): TaskWorkspaceIntegratePreview {
  return {
    canApplyPatch: false,
    applyBlockReason: reason,
    canMergeBranch: false,
    mergeBlockReason: reason,
    hasUncommitted: flags?.hasUncommitted ?? false,
    hasRemote: flags?.hasRemote ?? false
  }
}

/**
 * Files the worktree would integrate: `git diff <base>` covers committed +
 * staged + unstaged tracked changes; `ls-files --others` covers untracked —
 * the read-only equivalent of capture's `add -A && diff --cached <base>`.
 */
async function worktreeChangedSince(
  git: typeof workspaceGit,
  worktreePath: string,
  baseRevision: string
): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    git(worktreePath, ['diff', '-z', '--name-only', '--no-renames', baseRevision]),
    git(worktreePath, ['ls-files', '-z', '--others', '--exclude-standard'])
  ])
  return [...new Set(
    [...tracked.split('\0'), ...untracked.split('\0')]
      .filter(Boolean)
      .map(normalizeGraphRelativePath)
  )].sort()
}

/** Paths already applied by other integrated workspaces never count as user-side dirty. */
function ownedPaths(
  store: Pick<TaskWorkspaceStore, 'list'>,
  record: TaskWorkspaceRecord
): Set<string> {
  return new Set(
    store.list()
      .filter((entry) =>
        entry.workspaceId !== record.workspaceId &&
        entry.repositoryRoot === record.repositoryRoot &&
        entry.state === 'integrated')
      .flatMap((entry) => entry.changedFiles)
  )
}

export async function taskWorkspaceIntegratePreview(
  deps: TaskWorkspacePreviewDeps,
  workspaceId: string
): Promise<TaskWorkspaceIntegratePreview> {
  const record = deps.store.get(workspaceId)
  if (!record) return blocked('task workspace not found')
  const isWorktree =
    record.isolation === 'worktree' &&
    !!record.repositoryRoot &&
    !!record.baseRevision &&
    record.path !== record.sourceRoot
  if (!isWorktree) {
    return blocked(
      record.isolation !== 'worktree'
        ? `${record.isolation} isolation has no host worktree to integrate`
        : 'task workspace has no repository metadata'
    )
  }
  const repoRoot = record.repositoryRoot as string
  const baseRevision = record.baseRevision as string
  const git = deps.git ?? workspaceGit
  const [head, sourceDirty, worktreeFiles, hasUncommitted, remotes, branchExists] =
    await Promise.all([
      git(repoRoot, ['rev-parse', 'HEAD']).then((out) => out.trim(), () => ''),
      workingTreeChangedFiles(repoRoot).catch(() => null),
      worktreeChangedSince(git, record.path, baseRevision).catch(() => null),
      git(record.path, [
        'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'
      ]).then((out) => out.split('\0').filter(Boolean).length > 0, () => null),
      git(repoRoot, ['remote']).then(
        (out) => out.split('\n').filter(Boolean).length > 0, () => false),
      record.branch
        ? git(repoRoot, [
            'rev-parse', '--verify', '--quiet', `refs/heads/${record.branch}`
          ]).then(() => true, () => false)
        : Promise.resolve(false)
    ])
  const flags = { hasUncommitted: hasUncommitted === true, hasRemote: remotes }
  if (!INTEGRABLE.has(record.state)) {
    return blocked(`task workspace is ${record.state}`, flags)
  }
  const probeFailed = sourceDirty === null || worktreeFiles === null ||
    hasUncommitted === null || head === ''
  const changedFiles = worktreeFiles ?? record.changedFiles
  const overlapping = (sourceDirty ?? []).filter((path) =>
    !ownedPaths(deps.store, record).has(path) &&
    graphHostRelativePathsOverlap([path], changedFiles))

  let canApplyPatch = true
  let applyBlockReason: string | undefined
  if (probeFailed) {
    canApplyPatch = false
    applyBlockReason = 'cannot inspect the worktree or source checkout'
  } else if (head !== baseRevision) {
    canApplyPatch = false
    applyBlockReason = 'repository HEAD changed since worktree allocation'
  } else if (overlapping.length) {
    canApplyPatch = false
    applyBlockReason =
      `source checkout has uncommitted changes overlapping the patch: ${overlapping.slice(0, 10).join(', ')}`
  } else if (changedFiles.length === 0 && !flags.hasUncommitted) {
    canApplyPatch = false
    applyBlockReason = 'nothing to integrate'
  }

  let canMergeBranch = true
  let mergeBlockReason: string | undefined
  if (!record.branch || !record.targetBranch) {
    canMergeBranch = false
    mergeBlockReason = 'no local integration branch (detached or remote start point)'
  } else if (!branchExists) {
    canMergeBranch = false
    mergeBlockReason = `branch ${record.branch} no longer exists`
  } else if (overlapping.length) {
    canMergeBranch = false
    mergeBlockReason =
      `source checkout has uncommitted changes overlapping the merge: ${overlapping.slice(0, 10).join(', ')}`
  }

  return {
    canApplyPatch,
    ...(applyBlockReason ? { applyBlockReason } : {}),
    canMergeBranch,
    ...(mergeBlockReason ? { mergeBlockReason } : {}),
    ...flags
  }
}
