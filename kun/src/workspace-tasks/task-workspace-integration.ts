import { realpath } from 'node:fs/promises'
import {
  workspaceChangeSnapshot,
  workspaceCommitGit,
  workspaceGit,
  workingTreeChangedFiles
} from './workspace-git.js'
import type { WorktreeLifecycle } from './worktree-lifecycle.js'
import type { TaskWorkspaceStore } from './task-workspace-store.js'
import {
  type PreservedBranchInfo,
  type TaskWorkspaceDiscardPreview,
  type TaskWorkspaceIntegrateOutcome,
  type TaskWorkspaceRecord
} from '../contracts/task-workspace.js'

/** Capture/integrate/discard/cleanup for task workspaces (docs/ade/07 §8-10). */

export type TaskWorkspaceArtifacts = {
  put(input: {
    content: string
    source?: string
    origin?: string
    linkedOwners?: string[]
  }): Promise<{ meta: { id: string } }>
}

export type WorkspaceIntegrationContext = {
  store: TaskWorkspaceStore
  lifecycle: WorktreeLifecycle
  artifacts?: TaskWorkspaceArtifacts
  nowIso: () => string
  withRepoLock: <T>(repoRoot: string, operation: () => Promise<T>) => Promise<T>
  withWriteContext: <T>(operation: () => Promise<T>) => Promise<T>
  emit: (workspaceId: string) => void
  git?: typeof workspaceGit
  commitGit?: typeof workspaceCommitGit
}

export type TaskWorkspaceIntegrateResult = {
  outcome: TaskWorkspaceIntegrateOutcome
  record: TaskWorkspaceRecord
  reason?: string
  recovery?: string[]
}

export class TaskWorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class TaskWorkspaceDiscardPending extends Error {
  constructor(readonly preview: TaskWorkspaceDiscardPreview) {
    super('discard requires confirmation')
  }
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
}

function requireRecord(ctx: WorkspaceIntegrationContext, id: string): TaskWorkspaceRecord {
  const record = ctx.store.get(id)
  if (!record) throw new TaskWorkspaceConflictError('task workspace not found')
  return record
}

function requireWorktree(record: TaskWorkspaceRecord): asserts record is TaskWorkspaceRecord & {
  repositoryRoot: string
  path: string
  baseRevision: string
} {
  if (
    record.isolation !== 'worktree' ||
    !record.repositoryRoot ||
    !record.baseRevision ||
    record.path === record.sourceRoot
  ) {
    throw new TaskWorkspaceConflictError(
      `${record.isolation} isolation has no host worktree to operate on`
    )
  }
}

function touch(
  ctx: WorkspaceIntegrationContext,
  id: string,
  patch: Partial<TaskWorkspaceRecord>
): TaskWorkspaceRecord {
  const record = ctx.store.update(id, { ...patch, updatedAt: ctx.nowIso() })
  ctx.emit(id)
  if (!record) throw new TaskWorkspaceConflictError('task workspace not found')
  return record
}

const CAPTURABLE = new Set(['ready', 'captured', 'conflict'])

/**
 * Snapshot of source-checkout dirty files for the merge safety assertion
 * (docs/ade/07 §8): keys are the uncommitted/untracked paths.
 */
export async function porcelainSnapshot(repoRoot: string): Promise<Record<string, string>> {
  return workspaceChangeSnapshot(repoRoot, undefined)
}

/** Source-checkout dirty files must be byte-identical before and after merge. */
export async function assertSourceUntouched(
  before: Record<string, string>,
  repoRoot: string,
  snapshot: typeof porcelainSnapshot = porcelainSnapshot
): Promise<void> {
  const after = await snapshot(repoRoot)
  for (const path of Object.keys(before)) {
    if (after[path] !== before[path]) {
      throw new Error(`source change modified: ${path}`)
    }
  }
}

/** Capture committed + uncommitted worktree changes into a patch artifact. */
export async function captureTaskWorkspace(
  ctx: WorkspaceIntegrationContext,
  workspaceId: string
): Promise<TaskWorkspaceRecord> {
  const record = requireRecord(ctx, workspaceId)
  requireWorktree(record)
  if (!CAPTURABLE.has(record.state)) {
    throw new TaskWorkspaceConflictError(
      `cannot capture a task workspace in state ${record.state}`
    )
  }
  const captured = await ctx.withWriteContext(() =>
    ctx.lifecycle.capture({ path: record.path, baseRevision: record.baseRevision }))
  const artifact = ctx.artifacts
    ? await ctx.artifacts.put({
        content: captured.patch,
        source: 'other',
        origin: `task-workspace:${workspaceId}`
      })
    : undefined
  return touch(ctx, workspaceId, {
    state: 'captured',
    changedFiles: captured.changedFiles,
    headRevision: captured.headRevision,
    ...(artifact ? { patchArtifactId: artifact.meta.id } : {}),
    lastError: undefined,
    recovery: undefined
  })
}

/** Integrate a captured/ready worktree into its source repository. */
export async function integrateTaskWorkspace(
  ctx: WorkspaceIntegrationContext,
  workspaceId: string,
  mode: 'apply-patch' | 'merge-branch'
): Promise<TaskWorkspaceIntegrateResult> {
  const record = requireRecord(ctx, workspaceId)
  requireWorktree(record)
  if (!['ready', 'captured', 'conflict'].includes(record.state)) {
    throw new TaskWorkspaceConflictError(
      `cannot integrate a task workspace in state ${record.state}`
    )
  }
  const repoRoot = record.repositoryRoot as string
  return ctx.withRepoLock(repoRoot, () =>
    ctx.withWriteContext(() =>
      mode === 'apply-patch'
        ? integrateApplyPatch(ctx, record)
        : integrateMergeBranch(ctx, record)))
}

async function integrateApplyPatch(
  ctx: WorkspaceIntegrationContext,
  record: TaskWorkspaceRecord
): Promise<TaskWorkspaceIntegrateResult> {
  // Re-capture so integrate always applies the latest diff (07 §8.1).
  const captured = await ctx.lifecycle.capture({
    path: record.path,
    baseRevision: record.baseRevision as string
  })
  const artifact = ctx.artifacts
    ? await ctx.artifacts.put({
        content: captured.patch,
        source: 'other',
        origin: `task-workspace:${record.workspaceId}`
      })
    : undefined
  // Files a previously-integrated workspace already applied must not count as
  // user-side dirty overlap.
  const ownedPaths = new Set(
    ctx.store.list()
      .filter((entry) =>
        entry.workspaceId !== record.workspaceId &&
        entry.repositoryRoot === record.repositoryRoot &&
        entry.state === 'integrated')
      .flatMap((entry) => entry.changedFiles)
  )
  const result = await ctx.lifecycle.applyPatch(
    {
      repositoryRoot: record.repositoryRoot as string,
      baseRevision: record.baseRevision as string,
      changedFiles: captured.changedFiles,
      patch: captured.patch
    },
    { ownedPaths, patchLabel: 'task workspace patch' }
  )
  if (result.outcome === 'applied') {
    const next = touch(ctx, record.workspaceId, {
      state: 'integrated',
      changedFiles: captured.changedFiles,
      headRevision: captured.headRevision,
      ...(artifact ? { patchArtifactId: artifact.meta.id } : {}),
      lastError: undefined,
      recovery: undefined
    })
    return { outcome: 'applied', record: next }
  }
  const recovery = [
    `Review ${result.outcome === 'needs_human' ? 'the source checkout' : 'the conflict'} in ${record.repositoryRoot}`,
    `The worktree is preserved at ${record.path}`,
    'Resolve manually, then retry integrate or mark the workspace ready'
  ]
  const next = touch(ctx, record.workspaceId, {
    state: 'conflict',
    changedFiles: captured.changedFiles,
    headRevision: captured.headRevision,
    lastError: result.reason,
    recovery
  })
  return { outcome: result.outcome, record: next, reason: result.reason, recovery }
}

async function integrateMergeBranch(
  ctx: WorkspaceIntegrationContext,
  record: TaskWorkspaceRecord
): Promise<TaskWorkspaceIntegrateResult> {
  const repoRoot = record.repositoryRoot as string
  const worktree = record.path
  const branch = record.branch
  const target = record.targetBranch
  if (!branch || !target) {
    return conflictResult(ctx, record, 'needs_human',
      'no local integration branch (detached or remote start point)',
      ['Integrate manually, or start the workspace from a local branch'])
  }
  const git = ctx.git ?? workspaceGit
  const commitGit = ctx.commitGit ?? workspaceCommitGit
  try {
    // 1. Commit pending worktree changes so the branch carries them.
    await commitGit(worktree, ['add', '-A'])
    const staged = await git(worktree, ['diff', '--cached', '--quiet'])
      .then(() => false, () => true)
    if (staged) {
      await commitGit(worktree, [
        'commit', '-m',
        `chore(ade): ${record.label ?? 'task workspace'} (${record.workspaceId})`
      ])
    }
    // 2. Rebase onto the target branch when it advanced past the base.
    const targetSha = (await git(repoRoot, ['rev-parse', `${target}^{commit}`])).trim()
    if (targetSha !== record.baseRevision) {
      try {
        await commitGit(worktree, ['rebase', target])
      } catch (error) {
        return conflictResult(ctx, record, 'conflict',
          `rebase onto ${target} failed: ${boundedError(error)}`,
          [
            `cd ${worktree}`,
            'git status shows the in-progress rebase; resolve or `git rebase --abort`',
            `The branch ${branch} and worktree are preserved`
          ])
      }
    }
    // 3. Fast-forward the target only when safety allows; the source
    //    checkout's uncommitted files must be untouched on every path.
    const before = await workspaceChangeSnapshot(repoRoot)
    const checkedOut = await git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      .then((out) => out.trim(), () => '')
    if (checkedOut === target) {
      try {
        await commitGit(repoRoot, ['merge', '--ff-only', branch])
      } catch (error) {
        const message = boundedError(error)
        const dirtyOverlap = /local changes|would be overwritten|untracked working tree/i.test(message)
        return conflictResult(ctx, record, dirtyOverlap ? 'needs_human' : 'conflict',
          `fast-forward merge failed: ${message}`,
          [
            `Commit or stash the dirty files in ${repoRoot}`,
            `The worktree is preserved at ${worktree} on branch ${branch}`
          ])
      }
    } else {
      // The target is not checked out: move the ref only when it stays a
      // fast-forward (target must be an ancestor of the worktree branch).
      const ancestor = await git(repoRoot, [
        'merge-base', '--is-ancestor', target, branch
      ]).then(() => true, () => false)
      if (!ancestor) {
        return conflictResult(ctx, record, 'needs_human',
          `target branch ${target} diverged; merge manually`,
          [
            `cd ${repoRoot} && git merge ${branch}`,
            `The worktree is preserved at ${worktree}`
          ])
      }
      await commitGit(repoRoot, ['branch', '-f', target, branch])
    }
    await assertSourceUntouched(before, repoRoot)
    const headRevision = (await git(repoRoot, ['rev-parse', `${branch}^{commit}`])).trim()
    const next = touch(ctx, record.workspaceId, {
      state: 'integrated',
      headRevision,
      lastError: undefined,
      recovery: undefined
    })
    return { outcome: 'merged', record: next }
  } catch (error) {
    return conflictResult(ctx, record, 'needs_human', boundedError(error), [
      `Inspect ${repoRoot} and ${worktree}`,
      `The worktree is preserved at ${worktree} on branch ${branch}`
    ])
  }
}

function conflictResult(
  ctx: WorkspaceIntegrationContext,
  record: TaskWorkspaceRecord,
  outcome: 'needs_human' | 'conflict',
  reason: string,
  recovery: string[]
): TaskWorkspaceIntegrateResult {
  const next = touch(ctx, record.workspaceId, {
    state: 'conflict',
    lastError: reason,
    recovery
  })
  return { outcome, record: next, reason, recovery }
}

/** Discard is an explicit user action; without confirm it previews damage. */
export async function discardTaskWorkspace(
  ctx: WorkspaceIntegrationContext,
  workspaceId: string,
  confirm: boolean
): Promise<TaskWorkspaceRecord> {
  const record = requireRecord(ctx, workspaceId)
  requireWorktree(record)
  if (['removed', 'integrated'].includes(record.state)) {
    throw new TaskWorkspaceConflictError(`task workspace is already ${record.state}`)
  }
  const repoRoot = record.repositoryRoot as string
  return ctx.withRepoLock(repoRoot, async () => {
    if (!confirm) {
      const [uncommittedFiles, unpushedCommits] = await Promise.all([
        workingTreeChangedFiles(record.path).then((files) => files.length, () => 0),
        unpushedCommitCount(ctx, record)
      ])
      throw new TaskWorkspaceDiscardPending({ uncommittedFiles, unpushedCommits })
    }
    await ctx.withWriteContext(() =>
      ctx.lifecycle.remove(
        { repositoryRoot: repoRoot, path: record.path },
        { force: true }
      ))
    if (record.branch) {
      const git = ctx.git ?? workspaceGit
      await git(repoRoot, ['branch', '-D', record.branch]).catch(() => undefined)
    }
    return touch(ctx, workspaceId, { state: 'removed', lastError: undefined, recovery: undefined })
  })
}

async function unpushedCommitCount(
  ctx: WorkspaceIntegrationContext,
  record: TaskWorkspaceRecord
): Promise<number> {
  const git = ctx.git ?? workspaceGit
  const base = record.targetBranch ?? record.baseRevision
  if (!base) return 0
  return git(record.path, ['rev-list', '--count', `${base}..HEAD`])
    .then((out) => Number.parseInt(out.trim(), 10) || 0, () => 0)
}

/** Non-destructive cleanup after integration; unmerged branches stay listed. */
export async function cleanupIntegratedTaskWorkspace(
  ctx: WorkspaceIntegrationContext,
  workspaceId: string
): Promise<TaskWorkspaceRecord> {
  const record = requireRecord(ctx, workspaceId)
  requireWorktree(record)
  if (record.state !== 'integrated') {
    throw new TaskWorkspaceConflictError(
      `only integrated task workspaces can be cleaned (state: ${record.state})`
    )
  }
  const repoRoot = record.repositoryRoot as string
  return ctx.withRepoLock(repoRoot, async () => {
    const removed = await ctx.withWriteContext(() =>
      ctx.lifecycle.remove(
        { repositoryRoot: repoRoot, path: record.path },
        { force: false }
      )).then(() => true, (error: unknown) => {
        void touch(ctx, workspaceId, {
          state: 'preserved',
          lastError: `cleanup failed: ${boundedError(error)}`,
          recovery: [
            `Inspect ${record.path}; non-force removal keeps dirty data`,
            `Remove manually with git worktree remove --force ${record.path}`
          ]
        })
        return false
      })
    if (!removed) {
      return ctx.store.get(workspaceId) as TaskWorkspaceRecord
    }
    if (record.branch) {
      const git = ctx.git ?? workspaceGit
      const deleted = await git(repoRoot, ['branch', '-d', record.branch])
        .then(() => true, () => false)
      if (!deleted) {
        // `branch -d` refuses unmerged commits; keep the branch for review.
        return touch(ctx, workspaceId, {
          state: 'preserved',
          lastError: `branch ${record.branch} has unmerged commits; preserved for review`,
          recovery: [
            `cd ${repoRoot} && git log ${record.targetBranch ?? 'HEAD'}..${record.branch}`,
            `Delete manually with git branch -D ${record.branch} when reviewed`
          ]
        })
      }
    }
    return touch(ctx, workspaceId, { state: 'removed' })
  })
}

/** Branches kept for human review (state 'preserved'). */
export async function preservedBranchesForRepo(
  ctx: WorkspaceIntegrationContext,
  repoRoot: string
): Promise<PreservedBranchInfo[]> {
  const git = ctx.git ?? workspaceGit
  // Records store the resolved repository root; callers may pass a
  // symlinked spelling of the same path (e.g. /var → /private/var).
  const resolved = await realpath(repoRoot).catch(() => repoRoot)
  const normalized = resolved.replaceAll('\\', '/').replace(/\/+$/g, '')
  const records = ctx.store.list().filter((record) =>
    record.state === 'preserved' &&
    record.branch &&
    (record.repositoryRoot ?? '').replaceAll('\\', '/').replace(/\/+$/g, '') === normalized)
  const out: PreservedBranchInfo[] = []
  for (const record of records) {
    const branch = record.branch as string
    const base = record.targetBranch ?? record.baseRevision ?? 'HEAD'
    const [lastCommit, aheadBy] = await Promise.all([
      git(repoRoot, ['rev-parse', '--short', `${branch}^{commit}`])
        .then((out) => out.trim(), () => ''),
      git(repoRoot, ['rev-list', '--count', `${base}..${branch}`])
        .then((out) => Number.parseInt(out.trim(), 10) || 0, () => 0)
    ])
    out.push({ branch, lastCommit, aheadBy })
  }
  return out
}
