import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  collectReferencedCheckpointIds,
  pruneThreadCheckpoints
} from './git-checkpoint-cleanup'
import { checkpointsTotalBytes, ensureQuotaForCreate } from './git-checkpoint-quota'
import {
  CHECKPOINT_GATE_DIRECTORY,
  DEFAULT_MAX_CHECKPOINTS_PER_THREAD,
  DEFAULT_MAX_UNTRACKED_FILE_BYTES,
  DEFAULT_MAX_UNTRACKED_TOTAL_BYTES,
  DEFERRED_RETENTION_DELAY_MS,
  GitCheckpointMetadata,
  GitCheckpointStorageOptions,
  assertNoUnmerged,
  checkpointDir,
  checkpointFailure,
  checkpointHeadBundlePath,
  deferredRetentionTimers,
  manifestPath,
  resolveCheckpointsRoot,
  resolveHead,
  resolveRepositoryRoot,
  splitNul,
  writeHeadBundle,
  writePatch
} from './git-checkpoint-foundation'

const checkpointCreateQueues = new Map<string, Promise<unknown>>()

async function withCheckpointRootLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = checkpointCreateQueues.get(root) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  checkpointCreateQueues.set(root, run)
  try { return await run } finally { if (checkpointCreateQueues.get(root) === run) checkpointCreateQueues.delete(root) }
}

export async function createGitCheckpoint(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId?: string
  /** Return once the snapshot is safe; run history-based retention in background. */
  deferRetention?: boolean
  storage?: GitCheckpointStorageOptions
}): Promise<GitCheckpointCreateResult> {
  const requestedCheckpointId = params.checkpointId?.trim()
  const checkpointId = requestedCheckpointId || `gcp_${Date.now()}_${randomUUID()}`
  if (requestedCheckpointId) {
    await writeCheckpointGateStatus(params.dataDir, {
      version: 1,
      checkpointId,
      status: 'pending',
      updatedAt: new Date().toISOString()
    }).catch(() => undefined)
  }
  const result = await createGitCheckpointSnapshot({ ...params, checkpointId })
  if (requestedCheckpointId) {
    await writeCheckpointGateStatus(params.dataDir, result.ok
      ? {
          version: 1,
          checkpointId,
          status: 'ready',
          updatedAt: new Date().toISOString()
        }
      : {
          version: 1,
          checkpointId,
          status: 'failed',
          reason: result.reason,
          message: result.message,
          updatedAt: new Date().toISOString()
        }).catch(() => undefined)
  }
  return result
}

export async function createGitCheckpointSnapshot(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId: string
  deferRetention?: boolean
  storage?: GitCheckpointStorageOptions
}): Promise<GitCheckpointCreateResult> {
  const root = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  return withCheckpointRootLock(root, () => createGitCheckpointSnapshotUnlocked(params, root))
}

async function createGitCheckpointSnapshotUnlocked(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId: string
  deferRetention?: boolean
  storage?: GitCheckpointStorageOptions
}, root: string): Promise<GitCheckpointCreateResult> {
  const stagingId = `.staging-${randomUUID()}`
  const finalId = params.checkpointId
  const stagingDir = checkpointDir(root, stagingId)
  const workspaceRoot = params.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  const maxFileBytes = params.storage?.maxUntrackedFileBytes ?? DEFAULT_MAX_UNTRACKED_FILE_BYTES
  const maxTotalBytes = params.storage?.maxUntrackedTotalBytes ?? DEFAULT_MAX_UNTRACKED_TOTAL_BYTES
  const maxPerThread = params.storage?.maxPerThread ?? DEFAULT_MAX_CHECKPOINTS_PER_THREAD
  try {
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    if (!repositoryRoot) {
      return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    }
    await assertNoUnmerged(repositoryRoot)

    await mkdir(root, { recursive: true })
    const checkpointId = stagingId
    const dir = stagingDir
    await rm(checkpointDir(root, finalId), { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'untracked'), { recursive: true })

    const [head, currentBranchResult, untrackedResult] = await Promise.all([
      resolveHead(repositoryRoot).then(async (resolvedHead) => {
        if (resolvedHead) {
          await writeHeadBundle(repositoryRoot, checkpointHeadBundlePath(root, checkpointId))
        }
        return resolvedHead
      }),
      runGit(repositoryRoot, ['branch', '--show-current']),
      runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
      writePatch(repositoryRoot, ['diff', '--binary'], join(dir, 'unstaged.patch')),
      writePatch(repositoryRoot, ['diff', '--cached', '--binary'], join(dir, 'staged.patch'))
    ])
    const currentBranchRaw = currentBranchResult.stdout.trim()
    const currentBranch = currentBranchRaw || null
    const candidateUntracked = splitNul(untrackedResult.stdout)

    // Bounded untracked snapshot (issue #651): copying every untracked file in
    // full each turn is what ballooned the store by GBs. Skip files over the
    // per-file cap and stop once the cumulative budget is hit; record what was
    // skipped so the model/user know the snapshot is partial.
    const untrackedFiles: string[] = []
    const skippedUntracked: string[] = []
    let copiedBytes = 0
    for (const relativePath of candidateUntracked) {
      const from = join(repositoryRoot, relativePath)
      let size = 0
      try {
        const info = await stat(from)
        if (info.isDirectory()) continue
        size = info.size
      } catch {
        continue
      }
      if (size > maxFileBytes || copiedBytes + size > maxTotalBytes) {
        skippedUntracked.push(relativePath)
        continue
      }
      const to = join(dir, 'untracked', relativePath)
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true, force: true, errorOnExist: false })
      copiedBytes += size
      untrackedFiles.push(relativePath)
    }

    const metadata: GitCheckpointMetadata = {
      checkpointId: finalId,
      threadId: params.threadId,
      repositoryRoot,
      workspaceRoot,
      head,
      currentBranch,
      createdAt: new Date().toISOString(),
      untrackedFiles,
      ...(skippedUntracked.length ? { skippedUntracked } : {}),
      completeness: skippedUntracked.length ? 'partial' : 'complete'
    }
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
    const manifest = await createCheckpointManifestV1({ metadata, workspaceRoot })
    await writeFile(manifestPath(root, stagingId), JSON.stringify(manifest, null, 2), 'utf-8')
    const stagedBytes = await checkpointsTotalBytes(stagingDir)
    const quotaDecision = await ensureQuotaForCreate({
      root,
      quota: params.storage,
      projectedNewBytes: 0,
      protectIds: new Set([stagingId])
    })
    if (stagedBytes > (params.storage?.maxTotalBytes ?? Number.MAX_SAFE_INTEGER)) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, reason: 'quota_exceeded', message: `Git checkpoint needs ${stagedBytes} bytes, exceeding the configured quota.` }
    }
    if (!quotaDecision.allowed) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, reason: 'quota_exceeded', message: quotaDecision.message }
    }
    await rename(stagingDir, checkpointDir(root, finalId))
    // The snapshot is already safe to use. Retention is maintenance work and
    // must not hold the first mutating tool behind a full thread-history scan.
    const runRetention = async (): Promise<void> => {
      const referenced = await collectReferencedCheckpointIds(params.dataDir)
      await pruneThreadCheckpoints(root, params.threadId, maxPerThread, finalId, referenced)
    }
    if (params.deferRetention === true) {
      scheduleDeferredRetention(`${root}:${params.threadId}`, runRetention)
    } else {
      await runRetention().catch(() => undefined)
    }
    return { ok: true, checkpointId: finalId, repositoryRoot, head, currentBranch }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    const failure = checkpointFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}

export function scheduleDeferredRetention(key: string, task: () => Promise<void>): void {
  const existing = deferredRetentionTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    deferredRetentionTimers.delete(key)
    void task().catch(() => undefined)
  }, DEFERRED_RETENTION_DELAY_MS)
  timer.unref?.()
  deferredRetentionTimers.set(key, timer)
}

export async function writeCheckpointGateStatus(
  dataDir: string,
  status: {
    version: 1
    checkpointId: string
    status: 'pending' | 'ready' | 'failed'
    updatedAt: string
    reason?: string
    message?: string
  }
): Promise<void> {
  const root = join(resolve(dataDir), CHECKPOINT_GATE_DIRECTORY)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const name = Buffer.from(status.checkpointId, 'utf8').toString('base64url') || 'empty'
  await writeFile(join(root, `${name}.json`), JSON.stringify(status), {
    encoding: 'utf8',
    mode: 0o600
  })
}

export async function failGitCheckpointGate(
  dataDir: string,
  checkpointId: string,
  reason: string,
  message: string
): Promise<void> {
  await writeCheckpointGateStatus(dataDir, {
    version: 1,
    checkpointId,
    status: 'failed',
    reason,
    message,
    updatedAt: new Date().toISOString()
  })
}
