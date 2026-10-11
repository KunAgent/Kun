import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runGit, resolveGitCwd } from './git-service'
import {
  createCheckpointManifestV1,
  type GitCheckpointManifestV1,
  validateCheckpointRestoreContext
} from './git-checkpoint-manifest'
import type {
  GitCheckpointCreateResult,
  GitCheckpointRestoreResult
} from '../../shared/git-checkpoint'

import {
  createGitCheckpoint
} from './git-checkpoint-create'
import {
  GitCheckpointStorageOptions,
  applyPatchIfPresent,
  assertNoUnmerged,
  checkpointDir,
  fileExists,
  isValidWithinBase,
  readMetadata,
  resolveCheckpointManifest,
  resolveCheckpointTarget,
  resolveCheckpointsRoot,
  resolvePathWithinRepository,
  restoreFailure,
  restoreUnbornCheckpoint
} from './git-checkpoint-foundation'

export async function restoreGitCheckpoint(params: {
  dataDir: string
  checkpointId: string
  storage?: GitCheckpointStorageOptions
  expectedThreadId?: string
  expectedWorkspaceRoot?: string
  /**
   * Opt-in to restoring a PARTIAL checkpoint (one whose snapshot skipped some
   * untracked files because they were over the size budget). A partial restore
   * runs `git clean -fd`, which deletes those never-captured files; without this
   * flag the restore is refused so the user does not silently lose data. When
   * enabled, a complete rescue checkpoint is taken first so the cleaned files
   * remain recoverable. The restore still fails closed when the configured
   * checkpoint budget cannot capture that rescue.
   */
  allowPartialRestore?: boolean
  /**
   * Optional runtime bridge used to verify that no thread is mid-turn before
   * running the destructive `git reset --hard` / `git clean -fd`. When omitted
   * (e.g. from existing callers and unit tests) the check is skipped and the
   * function behaves as before. When provided, a non-ok response or any thrown
   * error fails closed: the restore is refused rather than proceeding.
   */
  runtimeRequest?: (path: string, init: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; body: string }>
}): Promise<GitCheckpointRestoreResult> {
  const checkpointId = params.checkpointId.trim()
  const root = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const metadata = await readMetadata(root, checkpointId)
  if (!metadata) {
    return { ok: false, reason: 'not_found', message: `Git checkpoint not found: ${checkpointId}` }
  }

  // Partial-checkpoint data-loss guard. If the snapshot skipped any
  // untracked file, the upcoming `git clean -fd` would delete those files with
  // no snapshot to restore them. Refuse unless the caller explicitly opts in.
  const skippedUntracked = metadata.skippedUntracked ?? []
  const isPartial = metadata.completeness === 'partial' || skippedUntracked.length > 0
  if (isPartial && !params.allowPartialRestore) {
    return {
      ok: false,
      reason: 'partial',
      message:
        `This checkpoint is partial: ${skippedUntracked.length} untracked file(s) were too large to snapshot and are NOT stored in it. ` +
        'Restoring would permanently delete them. Re-run with allowPartialRestore to proceed (a full rescue checkpoint will be taken first).',
      skippedUntracked
    }
  }

  try {
    const repositoryRoot = metadata.repositoryRoot
    const expectedThreadId = params.expectedThreadId?.trim()
    const expectedWorkspaceRoot = params.expectedWorkspaceRoot?.trim()
    if (expectedThreadId || expectedWorkspaceRoot) {
      const { manifest, hasWorkspaceIdentity } = await resolveCheckpointManifest(root, metadata)
      const validation = await validateCheckpointRestoreContext({
        manifest,
        expected: {
          ...(expectedThreadId ? { expectedThreadId } : {}),
          ...(hasWorkspaceIdentity && expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
        }
      })
      if (!validation.ok) {
        return { ok: false, reason: 'error', message: validation.message }
      }
    }
    await assertNoUnmerged(repositoryRoot)
    // Busy guard: a checkpoint restore runs `git reset --hard` + `git clean
    // -fd`, which would destroy files the agent is actively editing. Before
    // those destructive ops, ask the runtime whether any thread is currently
    // running a turn. `GET /v1/threads` serializes ThreadSummary, whose only
    // activity-relevant field is `status` with the enum
    // `idle | running | archived | deleted`; a thread is busy exactly when its
    // status is `running`. Fail closed if the runtime cannot be queried.
    // (An earlier version of this guard read a non-existent `thread.state`
    // field and compared it against turn-level states that never appear on a
    // thread summary; that made the guard a no-op and the race still fired.)
    if (params.runtimeRequest) {
      try {
        const response = await params.runtimeRequest('/v1/threads?limit=500&include=side', { method: 'GET' })
        if (!response.ok) {
          return {
            ok: false,
            reason: 'error',
            message: 'Cannot verify runtime state before checkpoint restore. Please ensure the runtime is healthy and try again.'
          }
        }
        const data = JSON.parse(response.body) as { threads?: Array<{ status?: string }> }
        const hasRunning = data.threads?.some((thread) => thread.status === 'running')
        if (hasRunning) {
          return {
            ok: false,
            reason: 'error',
            message: 'Cannot restore checkpoint while a thread is running. Please wait for the current turn to finish.'
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          reason: 'error',
          message: `Cannot verify runtime state before checkpoint restore: ${message}`
        }
      }
    }

    // The rescue checkpoint is the safety net for `reset --hard` + `clean -fd`.
    // Never bypass the storage budget here: an unbounded rescue reintroduces the
    // disk-exhaustion failure this service is meant to prevent. Instead require a
    // COMPLETE rescue and fail closed before the first destructive git command.
    const rescue = await createGitCheckpoint({
      dataDir: params.dataDir,
      storage: params.storage,
      workspaceRoot: repositoryRoot,
      threadId: `${metadata.threadId}:rollback-rescue`
    })
    if (!rescue.ok) {
      return {
        ok: false,
        reason: rescue.reason,
        message: `Cannot safely restore checkpoint because the rescue snapshot failed: ${rescue.message}`
      }
    }
    const rescueMetadata = await readMetadata(root, rescue.checkpointId)
    if (!rescueMetadata || rescueMetadata.completeness !== 'complete') {
      return {
        ok: false,
        reason: 'partial',
        message:
          'Cannot safely restore checkpoint because the current workspace does not fit the configured rescue snapshot limits. ' +
          'Increase the checkpoint limits or move/remove the oversized untracked files, then retry.',
        skippedUntracked: rescueMetadata?.skippedUntracked ?? []
      }
    }
    const rescueCheckpointId = rescue.checkpointId

    if (metadata.head) {
      const targetRef = await resolveCheckpointTarget(repositoryRoot, root, metadata)
      await runGit(repositoryRoot, ['reset', '--hard'], 30_000)
      await runGit(repositoryRoot, ['clean', '-fd'], 30_000)
      if (metadata.currentBranch) {
        await runGit(repositoryRoot, ['checkout', '-B', metadata.currentBranch, targetRef], 30_000)
      } else {
        await runGit(repositoryRoot, ['checkout', '--detach', targetRef], 30_000)
      }
      await runGit(repositoryRoot, ['reset', '--hard', targetRef], 30_000)
      await runGit(repositoryRoot, ['clean', '-fd'], 30_000)
    } else {
      await restoreUnbornCheckpoint(repositoryRoot, metadata.currentBranch)
    }

    const dir = checkpointDir(root, checkpointId)
    await applyPatchIfPresent(repositoryRoot, join(dir, 'staged.patch'), true)
    await applyPatchIfPresent(repositoryRoot, join(dir, 'unstaged.patch'), false)

    const checkpointUntrackedDir = join(dir, 'untracked')
    // The untracked dir is created at checkpoint time but may legitimately be
    // absent on old checkpoints that had no untracked files. realpath() would
    // throw ENOENT, so canonicalize tolerantly for this non-security-critical
    // anchor (the per-path escape check below still runs).
    let checkpointUntrackedReal: string
    try {
      checkpointUntrackedReal = await realpath(checkpointUntrackedDir)
    } catch {
      checkpointUntrackedReal = normalize(checkpointUntrackedDir)
    }

    for (const relativePath of metadata.untrackedFiles) {
      // `relativePath` comes from persisted, untrusted metadata. Validate it
      // stays inside the repository root (rejecting `..`, absolute, drive
      // forms, null bytes) and inside the checkpoint's untracked dir. Both
      // checks run through realpath/normalize so symlinks cannot redirect the
      // copy outside the validated roots.
      const targetWithinRepo = await resolvePathWithinRepository(repositoryRoot, relativePath)
      if (!isValidWithinBase(relativePath, checkpointUntrackedReal)) {
        throw new Error(`untracked path escapes the checkpoint directory: ${relativePath}`)
      }
      const sourceWithinCheckpoint = normalize(join(checkpointUntrackedReal, relativePath))

      if (!(await fileExists(sourceWithinCheckpoint))) continue
      await mkdir(dirname(targetWithinRepo), { recursive: true })
      await cp(sourceWithinCheckpoint, targetWithinRepo, { recursive: true, force: true, errorOnExist: false })
    }

    return {
      ok: true,
      checkpointId,
      repositoryRoot,
      head: metadata.head,
      currentBranch: metadata.currentBranch,
      rescueCheckpointId
    }
  } catch (error) {
    const failure = restoreFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}
