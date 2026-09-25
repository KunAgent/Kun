import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { normalizeGraphRelativePath } from '../contracts/graph-path.js'
import { graphHostRelativePathsOverlap } from '../graph/graph-platform-path.js'
import {
  workingTreeChangedFiles,
  type workspaceCommitGit,
  type workspaceGit
} from './workspace-git.js'

type GitFn = typeof workspaceGit
type CommitGitFn = typeof workspaceCommitGit

export type WorktreeApplyOutcome =
  | { outcome: 'applied' }
  | { outcome: 'needs_human'; reason: string }
  | { outcome: 'conflict'; reason: string }

export type WorktreeLifecycleDeps = {
  git: GitFn
  commitGit: CommitGitFn
  fence: () => Promise<void>
  withCommit: <T>(
    operation: (context: { signal: AbortSignal }) => Promise<T>
  ) => Promise<T>
  boundedError?: (error: unknown) => string
}

/**
 * Host-managed git worktree lifecycle shared by Graph write isolation and
 * ADE task workspaces (docs/ade/07 §3). Contains only git operations —
 * leases, scope checks, state persistence and artifact storage stay with
 * the callers.
 */
export function createWorktreeLifecycle(deps: WorktreeLifecycleDeps) {
  const boundedError =
    deps.boundedError ?? ((error: unknown) =>
      (error instanceof Error ? error.message : String(error)).slice(0, 2_048))

  async function create(input: {
    repositoryRoot: string
    path: string
    startRevision: string
    branch?: string
  }): Promise<{ repositoryRoot: string; baseRevision: string; branch?: string }> {
    const args = input.branch
      ? ['worktree', 'add', '-b', input.branch, input.path, input.startRevision]
      : ['worktree', 'add', '--detach', input.path, input.startRevision]
    await deps.fence()
    await deps.commitGit(input.repositoryRoot, args)
    return {
      repositoryRoot: input.repositoryRoot,
      baseRevision: input.startRevision,
      ...(input.branch ? { branch: input.branch } : {})
    }
  }

  async function capture(record: {
    path: string
    baseRevision: string
  }): Promise<{ headRevision: string; changedFiles: string[]; patch: string }> {
    await deps.commitGit(record.path, ['add', '-A'])
    const [head, files, patch] = await Promise.all([
      deps.git(record.path, ['rev-parse', 'HEAD']),
      deps.git(record.path, [
        'diff', '--cached', '-z', '--name-only', '--no-renames', record.baseRevision
      ]),
      deps.git(record.path, [
        'diff', '--cached', '--binary', '--no-ext-diff', record.baseRevision
      ])
    ])
    return {
      headRevision: head.trim(),
      changedFiles: [
        ...new Set(files.split('\0').filter(Boolean).map(normalizeGraphRelativePath))
      ].sort(),
      patch
    }
  }

  async function applyPatch(
    record: {
      repositoryRoot: string
      baseRevision: string
      changedFiles: readonly string[]
      patch: string
    },
    opts: { ownedPaths: ReadonlySet<string>; patchLabel?: string }
  ): Promise<WorktreeApplyOutcome> {
    await deps.fence()
    const currentHead = (await deps.git(record.repositoryRoot, ['rev-parse', 'HEAD'])).trim()
    if (currentHead !== record.baseRevision) {
      return {
        outcome: 'needs_human',
        reason: 'repository HEAD changed since worktree allocation'
      }
    }
    const label = opts.patchLabel ?? 'patch'
    const overlappingDirty = (await workingTreeChangedFiles(record.repositoryRoot))
      .filter((path) =>
        !opts.ownedPaths.has(path) &&
        graphHostRelativePathsOverlap([path], [...record.changedFiles]))
    if (overlappingDirty.length) {
      return {
        outcome: 'needs_human',
        reason:
          `repository contains uncommitted changes overlapping ${label}: ${overlappingDirty.slice(0, 20).join(', ')}`
      }
    }
    if (!record.patch.trim()) return { outcome: 'applied' }
    const dir = await mkdtemp(join(tmpdir(), 'kun-worktree-patch-'))
    const patchPath = join(dir, 'change.patch')
    try {
      return await deps.withCommit(async (context) => {
        await atomicWriteFile(patchPath, record.patch, { signal: context.signal })
        try {
          await deps.git(record.repositoryRoot, ['apply', '--check', patchPath])
          await deps.commitGit(record.repositoryRoot, ['apply', '--index', patchPath])
          return { outcome: 'applied' }
        } catch (error) {
          return { outcome: 'conflict', reason: boundedError(error) }
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function remove(
    record: { repositoryRoot: string; path: string },
    opts: { force: boolean }
  ): Promise<void> {
    await deps.fence()
    await deps.commitGit(record.repositoryRoot, [
      'worktree',
      'remove',
      ...(opts.force ? ['--force'] : []),
      record.path
    ])
  }

  return { create, capture, applyPatch, remove }
}

export type WorktreeLifecycle = ReturnType<typeof createWorktreeLifecycle>
