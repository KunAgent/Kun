import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, basename, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runGit, resolveGitCwd } from './git-service'
import type {
  GitCheckpointCreateResult,
  GitCheckpointRestoreResult
} from '../../shared/git-checkpoint'

type GitCheckpointMetadata = {
  checkpointId: string
  threadId: string
  repositoryRoot: string
  head: string
  checkpointRef?: string | null
  currentBranch: string | null
  createdAt: string
  untrackedFiles: string[]
}

function checkpointFailure(error: unknown): Extract<GitCheckpointCreateResult, { ok: false }> {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

function restoreFailure(error: unknown): Extract<GitCheckpointRestoreResult, { ok: false }> {
  const failure = checkpointFailure(error)
  return { ...failure, reason: failure.reason }
}

function checkpointDir(dataDir: string, checkpointId: string): string {
  return join(resolve(dataDir), 'git-checkpoints', checkpointId)
}

function checkpointHeadBundlePath(dataDir: string, checkpointId: string): string {
  return join(checkpointDir(dataDir, checkpointId), 'head.bundle')
}

function metadataPath(dataDir: string, checkpointId: string): string {
  return join(checkpointDir(dataDir, checkpointId), 'metadata.json')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function splitNul(stdout: string): string[] {
  return stdout.split('\0').map((entry) => entry.trim()).filter(Boolean)
}

async function assertNoUnmerged(repositoryRoot: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ['diff', '--name-only', '--diff-filter=U'])
  const conflicted = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (conflicted.length > 0) {
    throw new Error(`Cannot create or restore a checkpoint while ${conflicted.length} files have merge conflicts.`)
  }
}

async function readMetadata(dataDir: string, checkpointId: string): Promise<GitCheckpointMetadata | null> {
  try {
    const raw = await readFile(metadataPath(dataDir, checkpointId), 'utf-8')
    return JSON.parse(raw) as GitCheckpointMetadata
  } catch {
    return null
  }
}

async function writePatch(repositoryRoot: string, args: string[], path: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, args, 30_000)
  await writeFile(path, stdout, 'utf-8')
}

async function applyPatchIfPresent(repositoryRoot: string, path: string, cached: boolean): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return
  await runGit(repositoryRoot, ['apply', '--binary', ...(cached ? ['--index'] : []), path], 30_000)
}

async function commitExists(repositoryRoot: string, rev: string): Promise<boolean> {
  if (!rev.trim()) return false
  try {
    await runGit(repositoryRoot, ['cat-file', '-e', `${rev}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function writeHeadBundle(repositoryRoot: string, path: string): Promise<void> {
  await runGit(repositoryRoot, ['bundle', 'create', path, 'HEAD'], 30_000)
}

async function resolveCheckpointTarget(
  repositoryRoot: string,
  dataDir: string,
  metadata: GitCheckpointMetadata
): Promise<string> {
  const head = metadata.head.trim()
  if (await commitExists(repositoryRoot, head)) return head

  const bundlePath = checkpointHeadBundlePath(dataDir, metadata.checkpointId)
  if (await fileExists(bundlePath)) {
    await runGit(repositoryRoot, ['bundle', 'unbundle', bundlePath], 30_000)
    if (await commitExists(repositoryRoot, head)) return head
  }

  const legacyRef = metadata.checkpointRef?.trim() ?? ''
  if (await commitExists(repositoryRoot, legacyRef)) return legacyRef

  throw new Error(`Git checkpoint target commit is unavailable: ${head || metadata.checkpointId}`)
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string | null> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return null
  const { stdout } = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return stdout.trim()
}

/**
 * Validates that `relativePath` (taken from checkpoint metadata, which is
 * persisted JSON and therefore untrusted) stays inside `repositoryRoot` when
 * joined to it. Defends the restore path against a tampered metadata.json that
 * smuggles `..` segments, absolute paths, or symlink-anchored escapes.
 *
 * Returns the canonical absolute target so callers reuse the same resolved
 * path for both the existence check and the copy, avoiding a second resolution
 * that could disagree with the validated one.
 *
 * Fail closed: if `repositoryRoot` cannot be canonicalized (missing, EACCES,
 * ELOOP, …) the check throws rather than letting an unchecked path through.
 */
async function resolvePathWithinRepository(
  repositoryRoot: string,
  relativePath: string
): Promise<string> {
  // Reject empty / current / parent / absolute, plus null bytes and Windows
  // drive-relative forms ("C:file") that bypass isAbsolute().
  if (!relativePath || relativePath === '.' || relativePath === '..' || isAbsolute(relativePath)) {
    throw new Error(`invalid untracked path: ${relativePath}`)
  }
  if (relativePath.includes('\0') || /^[a-zA-Z]:/.test(relativePath)) {
    throw new Error(`invalid untracked path: ${relativePath}`)
  }

  const repoReal = await realpath(repositoryRoot)
  const targetNormalized = normalize(join(repoReal, relativePath))
  // startsWith with a trailing separator prevents prefix attacks where
  // repoReal is a textual prefix of an unrelated dir (e.g. "/repo" vs
  // "/repo-evil"). Exact equality covers the (already-rejected) root case.
  if (targetNormalized !== repoReal && !targetNormalized.startsWith(repoReal + sep)) {
    throw new Error(`untracked path escapes the repository root: ${relativePath}`)
  }

  // The lexical check above is necessary but NOT sufficient: an in-repo
  // symlink (e.g. repo/link -> /outside) makes `link/payload.txt` lexically
  // contained while cp() follows the link and writes outside the repo. Resolve
  // the target via realpath to defeat any symlink on the path. The target may
  // not exist yet (cp creates it), so when the direct realpath fails with
  // ENOENT we canonicalize the nearest existing ancestor (the parent dir) and
  // re-join the remaining suffix, then re-assert containment on the resolved
  // pair. Any other realpath failure (EACCES/ELOOP/ENOTDIR/…) fails closed.
  const targetReal = await resolveSymlinkSafe(targetNormalized)
  if (targetReal !== repoReal && !targetReal.startsWith(repoReal + sep)) {
    throw new Error(`untracked path escapes the repository root: ${relativePath}`)
  }

  // Return the lexical target so downstream mkdir/cp operate on the path the
  // caller asked for; the escape check above already proved it cannot leave
  // the repository root through any symlink on the path.
  return targetNormalized
}

/**
 * Exported for tests. Validates an untracked-file relative path (from
 * persisted metadata) stays inside `repositoryRoot`, defeating `..`,
 * absolute, drive-relative, null-byte, AND in-repo-symlink escapes.
 */
export async function testResolvePathWithinRepository(
  repositoryRoot: string,
  relativePath: string
): Promise<string> {
  return resolvePathWithinRepository(repositoryRoot, relativePath)
}

/**
 * Canonicalizes `lexicalPath`, tolerating a not-yet-existing leaf (the
 * write/create case) by realpath-ing the nearest existing ancestor and
 * re-joining the non-existent suffix. Fail-closed on realpath errors other
 * than ENOENT. Mirrors the approach used by the workspace tool escape check.
 */
async function resolveSymlinkSafe(lexicalPath: string): Promise<string> {
  const direct = await safeRealpath(lexicalPath)
  if (direct !== null) return direct
  const segments: string[] = []
  let current = lexicalPath
  let ancestor: string | null = null
  for (let i = 0; i < 128 && current !== dirname(current); i += 1) {
    const resolved = await safeRealpath(current)
    if (resolved !== null) {
      ancestor = resolved
      break
    }
    segments.unshift(basename(current))
    current = dirname(current)
  }
  if (ancestor === null) {
    throw new Error(`cannot canonicalize path (no existing ancestor): ${lexicalPath}`)
  }
  return segments.length > 0 ? normalize(join(ancestor, ...segments)) : ancestor
}

async function safeRealpath(target: string): Promise<string | null> {
  try {
    return await realpath(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ELOOP' || code === 'ENOTDIR') {
      return null
    }
    throw error
  }
}

/**
 * Lexical containment check used against an already-realpath'd base (the
 * checkpoint untracked dir, whose realpath may be a fallback when the dir is
 * absent). Shares the same rejection rules as {@link resolvePathWithinRepository}
 * so a traversal path cannot slip through on the source side.
 */
function isValidWithinBase(relativePath: string, baseReal: string): boolean {
  if (!relativePath || relativePath === '.' || relativePath === '..' || isAbsolute(relativePath)) {
    return false
  }
  if (relativePath.includes('\0') || /^[a-zA-Z]:/.test(relativePath)) {
    return false
  }
  const targetNormalized = normalize(join(baseReal, relativePath))
  return targetNormalized === baseReal || targetNormalized.startsWith(baseReal + sep)
}

export async function createGitCheckpoint(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId?: string
}): Promise<GitCheckpointCreateResult> {
  const workspaceRoot = params.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    if (!repositoryRoot) {
      return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    }
    await assertNoUnmerged(repositoryRoot)

    const checkpointId = params.checkpointId?.trim() || `gcp_${Date.now()}_${randomUUID()}`
    const dir = checkpointDir(params.dataDir, checkpointId)
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'untracked'), { recursive: true })

    const head = (await runGit(repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    await writeHeadBundle(repositoryRoot, checkpointHeadBundlePath(params.dataDir, checkpointId))
    const currentBranchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentBranchRaw || null
    const untrackedFiles = splitNul(
      (await runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
    )

    await writePatch(repositoryRoot, ['diff', '--binary'], join(dir, 'unstaged.patch'))
    await writePatch(repositoryRoot, ['diff', '--cached', '--binary'], join(dir, 'staged.patch'))

    for (const relativePath of untrackedFiles) {
      const from = join(repositoryRoot, relativePath)
      const to = join(dir, 'untracked', relativePath)
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true, force: true, errorOnExist: false })
    }

    const metadata: GitCheckpointMetadata = {
      checkpointId,
      threadId: params.threadId,
      repositoryRoot,
      head,
      currentBranch,
      createdAt: new Date().toISOString(),
      untrackedFiles
    }
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
    return { ok: true, checkpointId, repositoryRoot, head, currentBranch }
  } catch (error) {
    const failure = checkpointFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}

export async function restoreGitCheckpoint(params: {
  dataDir: string
  checkpointId: string
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
  const metadata = await readMetadata(params.dataDir, checkpointId)
  if (!metadata) {
    return { ok: false, reason: 'not_found', message: `Git checkpoint not found: ${checkpointId}` }
  }
  try {
    const repositoryRoot = metadata.repositoryRoot
    await assertNoUnmerged(repositoryRoot)
    const targetRef = await resolveCheckpointTarget(repositoryRoot, params.dataDir, metadata)

    // Busy guard: a checkpoint restore runs `git reset --hard` + `git clean
    // -fd`, which would destroy files the agent is actively editing. Before
    // those destructive ops, ask the runtime whether any thread is currently
    // running a turn. `GET /v1/threads` serializes ThreadSummary, whose only
    // activity-relevant field is `status` with the enum
    // `idle | running | archived | deleted`; a thread is busy exactly when its
    // status is `running`. Fail closed if the runtime cannot be queried.
    //
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

    const rescue = await createGitCheckpoint({
      dataDir: params.dataDir,
      workspaceRoot: repositoryRoot,
      threadId: `${metadata.threadId}:rollback-rescue`
    })
    const rescueCheckpointId = rescue.ok ? rescue.checkpointId : null

    await runGit(repositoryRoot, ['reset', '--hard'], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)
    if (metadata.currentBranch) {
      await runGit(repositoryRoot, ['checkout', '-B', metadata.currentBranch, targetRef], 30_000)
    } else {
      await runGit(repositoryRoot, ['checkout', '--detach', targetRef], 30_000)
    }
    await runGit(repositoryRoot, ['reset', '--hard', targetRef], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)

    const dir = checkpointDir(params.dataDir, checkpointId)
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
