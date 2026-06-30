import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
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
  /** Untracked files deliberately NOT snapshotted (too large / over budget). */
  skippedUntracked?: string[]
  /**
   * Whether the snapshot captured every untracked file. `partial` means some
   * untracked files were skipped (see `skippedUntracked`); restoring a partial
   * checkpoint can destroy those never-captured files, so restore refuses a
   * partial checkpoint unless the caller explicitly opts in.
   */
  completeness?: 'complete' | 'partial'
}

/**
 * Snapshot policy that bounds checkpoint disk usage (issue #651). Untracked
 * files are physically copied, so a workspace full of large untracked artifacts
 * (AI models, node_modules, build output) could balloon the checkpoint store by
 * gigabytes per message. These caps + the per-thread retention limit stop that.
 */
export type GitCheckpointStorageOptions = {
  /** Override the checkpoints root (e.g. point it at another drive). */
  checkpointsRoot?: string
  /** Skip snapshotting any single untracked file larger than this. Default 5 MiB. */
  maxUntrackedFileBytes?: number
  /** Stop snapshotting untracked files once this cumulative size is reached. Default 50 MiB. */
  maxUntrackedTotalBytes?: number
  /** Keep at most this many checkpoints per thread (newest first). Default 5. */
  maxPerThread?: number
}

const DEFAULT_MAX_UNTRACKED_FILE_BYTES = 5 * 1_024 * 1_024
const DEFAULT_MAX_UNTRACKED_TOTAL_BYTES = 50 * 1_024 * 1_024
const DEFAULT_MAX_CHECKPOINTS_PER_THREAD = 5

export type GitCheckpointCleanupResult = {
  scanned: number
  kept: number
  deleted: number
  failed: number
  deletedIds: string[]
  failedIds: string[]
}

export type GitCheckpointCleanupDueResult =
  | { due: false, lastRunAt: string | null }
  | { due: true, lastRunAt: string, result: GitCheckpointCleanupResult }

type GitCheckpointCleanupState = {
  lastRunAt?: string
}

const DAY_MS = 24 * 60 * 60 * 1_000
const CHECKPOINT_CLEANUP_STATE_FILE = '.cleanup.json'
const CHECKPOINT_REFERENCE_FILE_EXTENSIONS = new Set(['.json', '.jsonl'])

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

/**
 * Resolve the checkpoints root directory. A user-configured absolute path (e.g.
 * on another drive with more free space) takes precedence; otherwise the
 * default lives under the Kun data dir. Relative configured paths are resolved
 * against the data dir so a stray relative value can't escape unexpectedly.
 */
export function resolveCheckpointsRoot(dataDir: string, configured?: string): string {
  const trimmed = configured?.trim()
  if (trimmed) {
    return isAbsolute(trimmed) ? resolve(trimmed) : resolve(dataDir, trimmed)
  }
  return join(resolve(dataDir), 'git-checkpoints')
}

function checkpointDir(root: string, checkpointId: string): string {
  return join(root, checkpointId)
}

function checkpointRootDir(root: string): string {
  return root
}

function checkpointCleanupStatePath(root: string): string {
  return join(root, CHECKPOINT_CLEANUP_STATE_FILE)
}

function checkpointHeadBundlePath(root: string, checkpointId: string): string {
  return join(checkpointDir(root, checkpointId), 'head.bundle')
}

function metadataPath(root: string, checkpointId: string): string {
  return join(checkpointDir(root, checkpointId), 'metadata.json')
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

async function readMetadata(root: string, checkpointId: string): Promise<GitCheckpointMetadata | null> {
  try {
    const raw = await readFile(metadataPath(root, checkpointId), 'utf-8')
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
  root: string,
  metadata: GitCheckpointMetadata
): Promise<string> {
  const head = metadata.head.trim()
  if (await commitExists(repositoryRoot, head)) return head

  const bundlePath = checkpointHeadBundlePath(root, metadata.checkpointId)
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

function extractWorkspaceCheckpointIds(text: string): Set<string> {
  const ids = new Set<string>()
  const pattern = /"workspaceCheckpointId"\s*:\s*"([^"]+)"/g
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(text)) !== null) {
    const id = match[1]?.trim()
    if (id) ids.add(id)
  }
  return ids
}

async function collectReferencedCheckpointIds(dataDir: string): Promise<Set<string>> {
  const referenced = new Set<string>()
  const roots = [join(resolve(dataDir), 'threads')]
  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent<string>[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw error
    }

    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !CHECKPOINT_REFERENCE_FILE_EXTENSIONS.has(extname(entry.name))) continue
      let text = ''
      try {
        text = await readFile(path, 'utf-8')
      } catch {
        continue
      }
      for (const id of extractWorkspaceCheckpointIds(text)) {
        referenced.add(id)
      }
    }
  }

  for (const root of roots) {
    await visit(root)
  }
  return referenced
}

async function readCleanupState(root: string): Promise<GitCheckpointCleanupState> {
  try {
    const raw = await readFile(checkpointCleanupStatePath(root), 'utf-8')
    const parsed = JSON.parse(raw) as GitCheckpointCleanupState
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

async function writeCleanupState(root: string, state: GitCheckpointCleanupState): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(checkpointCleanupStatePath(root), JSON.stringify(state, null, 2), 'utf-8')
}

function isCheckpointCleanupDue(lastRunAt: string | undefined, intervalDays: number, now: Date): boolean {
  if (!lastRunAt) return true
  const lastRunMs = Date.parse(lastRunAt)
  if (!Number.isFinite(lastRunMs)) return true
  return now.getTime() - lastRunMs >= intervalDays * DAY_MS
}

// A checkpoint directory is created before its referencing thread item is
// flushed to disk, so a freshly-created checkpoint can momentarily look
// unreferenced. Skip directories modified within this window so a cleanup pass
// landing in that gap can't delete a checkpoint a concurrent turn just created;
// a genuinely orphaned one is removed on a later pass. Injectable so tests can
// disable it with graceMs: 0.
const CHECKPOINT_CLEANUP_GRACE_MS = 10 * 60 * 1_000

export async function cleanupUnusedGitCheckpoints(params: {
  dataDir: string
  checkpointsRoot?: string
  graceMs?: number
  now?: Date
}): Promise<GitCheckpointCleanupResult> {
  const graceMs = params.graceMs ?? CHECKPOINT_CLEANUP_GRACE_MS
  const nowMs = (params.now ?? new Date()).getTime()
  const root = resolveCheckpointsRoot(params.dataDir, params.checkpointsRoot)
  const referenced = await collectReferencedCheckpointIds(params.dataDir)
  const result: GitCheckpointCleanupResult = {
    scanned: 0,
    kept: 0,
    deleted: 0,
    failed: 0,
    deletedIds: [],
    failedIds: []
  }

  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return result
    throw error
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const checkpointId = entry.name
    result.scanned += 1
    if (referenced.has(checkpointId)) {
      result.kept += 1
      continue
    }
    if (graceMs > 0) {
      try {
        const dirStat = await stat(join(root, checkpointId))
        if (nowMs - dirStat.mtimeMs < graceMs) {
          // Recently touched — may be referenced by an item not yet flushed.
          result.kept += 1
          continue
        }
      } catch {
        // Cannot stat (e.g. removed concurrently); fall through to the delete.
      }
    }
    try {
      await rm(join(root, checkpointId), { recursive: true, force: true })
      result.deleted += 1
      result.deletedIds.push(checkpointId)
    } catch {
      result.failed += 1
      result.failedIds.push(checkpointId)
    }
  }

  return result
}

export async function cleanupUnusedGitCheckpointsIfDue(params: {
  dataDir: string
  checkpointsRoot?: string
  intervalDays: number
  now?: Date
  graceMs?: number
}): Promise<GitCheckpointCleanupDueResult> {
  const now = params.now ?? new Date()
  const root = resolveCheckpointsRoot(params.dataDir, params.checkpointsRoot)
  const state = await readCleanupState(root)
  const lastRunAt = typeof state.lastRunAt === 'string' ? state.lastRunAt : undefined
  if (!isCheckpointCleanupDue(lastRunAt, params.intervalDays, now)) {
    return { due: false, lastRunAt: lastRunAt ?? null }
  }
  const result = await cleanupUnusedGitCheckpoints({
    dataDir: params.dataDir,
    ...(params.checkpointsRoot ? { checkpointsRoot: params.checkpointsRoot } : {}),
    now,
    ...(params.graceMs !== undefined ? { graceMs: params.graceMs } : {})
  })
  const nextLastRunAt = now.toISOString()
  await writeCleanupState(root, { lastRunAt: nextLastRunAt })
  return { due: true, lastRunAt: nextLastRunAt, result }
}

export async function createGitCheckpoint(params: {
  dataDir: string
  workspaceRoot: string
  threadId: string
  checkpointId?: string
  storage?: GitCheckpointStorageOptions
}): Promise<GitCheckpointCreateResult> {
  const workspaceRoot = params.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  const root = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const maxFileBytes = params.storage?.maxUntrackedFileBytes ?? DEFAULT_MAX_UNTRACKED_FILE_BYTES
  const maxTotalBytes = params.storage?.maxUntrackedTotalBytes ?? DEFAULT_MAX_UNTRACKED_TOTAL_BYTES
  const maxPerThread = params.storage?.maxPerThread ?? DEFAULT_MAX_CHECKPOINTS_PER_THREAD
  try {
    const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
    if (!repositoryRoot) {
      return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    }
    await assertNoUnmerged(repositoryRoot)

    const checkpointId = params.checkpointId?.trim() || `gcp_${Date.now()}_${randomUUID()}`
    const dir = checkpointDir(root, checkpointId)
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, 'untracked'), { recursive: true })

    const head = (await runGit(repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim()
    await writeHeadBundle(repositoryRoot, checkpointHeadBundlePath(root, checkpointId))
    const currentBranchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentBranchRaw || null
    const candidateUntracked = splitNul(
      (await runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
    )

    await writePatch(repositoryRoot, ['diff', '--binary'], join(dir, 'unstaged.patch'))
    await writePatch(repositoryRoot, ['diff', '--cached', '--binary'], join(dir, 'staged.patch'))

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
      checkpointId,
      threadId: params.threadId,
      repositoryRoot,
      head,
      currentBranch,
      createdAt: new Date().toISOString(),
      untrackedFiles,
      ...(skippedUntracked.length ? { skippedUntracked } : {}),
      completeness: skippedUntracked.length ? 'partial' : 'complete'
    }
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
    // Bound per-thread retention so an active thread cannot grow unboundedly.
    await pruneThreadCheckpoints(root, params.threadId, maxPerThread, checkpointId).catch(() => undefined)
    return { ok: true, checkpointId, repositoryRoot, head, currentBranch }
  } catch (error) {
    const failure = checkpointFailure(error)
    if (/merge conflicts/i.test(failure.message)) {
      return { ...failure, reason: 'conflict' }
    }
    return failure
  }
}

/**
 * Keep at most `max` checkpoints for a thread (issue #651, per-thread cap).
 * Oldest checkpoints (by createdAt, falling back to the `gcp_<ts>_` name) are
 * removed first; `keepId` (the just-created checkpoint) is always retained.
 */
export async function pruneThreadCheckpoints(
  root: string,
  threadId: string,
  max: number,
  keepId?: string
): Promise<{ deleted: string[] }> {
  if (max <= 0) return { deleted: [] }
  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { deleted: [] }
  }
  const owned: Array<{ id: string; order: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metadata = await readMetadata(root, entry.name)
    if (!metadata || metadata.threadId !== threadId) continue
    const createdMs = Date.parse(metadata.createdAt)
    const order = Number.isFinite(createdMs) ? createdMs : checkpointNameTimestamp(entry.name)
    owned.push({ id: entry.name, order })
  }
  // Newest first; keep the first `max`, delete the rest (never the keepId).
  owned.sort((a, b) => b.order - a.order)
  const deleted: string[] = []
  for (let i = 0; i < owned.length; i += 1) {
    const { id } = owned[i]
    if (i < max || id === keepId) continue
    try {
      await rm(checkpointDir(root, id), { recursive: true, force: true })
      deleted.push(id)
    } catch {
      // best-effort
    }
  }
  return { deleted }
}

/** Extract the `gcp_<timestamp>_<uuid>` creation epoch for ordering fallback. */
function checkpointNameTimestamp(name: string): number {
  const match = name.match(/^gcp_(\d+)_/)
  return match ? Number(match[1]) : 0
}

export async function restoreGitCheckpoint(params: {
  dataDir: string
  checkpointId: string
  storage?: GitCheckpointStorageOptions
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

  // Partial-checkpoint data-loss guard (P0-01). If the snapshot skipped any
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
    await assertNoUnmerged(repositoryRoot)
    const targetRef = await resolveCheckpointTarget(repositoryRoot, root, metadata)

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

    await runGit(repositoryRoot, ['reset', '--hard'], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)
    if (metadata.currentBranch) {
      await runGit(repositoryRoot, ['checkout', '-B', metadata.currentBranch, targetRef], 30_000)
    } else {
      await runGit(repositoryRoot, ['checkout', '--detach', targetRef], 30_000)
    }
    await runGit(repositoryRoot, ['reset', '--hard', targetRef], 30_000)
    await runGit(repositoryRoot, ['clean', '-fd'], 30_000)

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
