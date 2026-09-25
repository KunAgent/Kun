import { constants } from 'node:fs'
import { copyFile, cp, lstat, mkdir, realpath, stat, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { isSameOrInside } from '../skills/skill-runtime-support.js'
import { workspaceGit } from './workspace-git.js'

/** Environment fill for host-created task worktrees (docs/ade/07 §6). */

export type EnvShareMode = 'symlink' | 'clone'
export type EnvFillEntryMode = EnvShareMode | 'copy'

export type EnvFillSkipReason =
  | 'missing'        // path does not exist in the source checkout
  | 'tracked'        // git-tracked (already present in the worktree)
  | 'not_ignored'    // exists but is not gitignored (rule 2, 07 §6)
  | 'unsafe_path'    // `..` traversal, absolute path, or out-of-repo symlink
  | 'exists'         // destination already populated; never overwrite
  | 'error'

export type EnvFillSkipped = { path: string; reason: EnvFillSkipReason }

export type EnvFillResult = {
  /** Repo-relative paths linked into the worktree. */
  shared: string[]
  /** Repo-relative paths copied into the worktree. */
  copied: string[]
  skipped: EnvFillSkipped[]
  warnings: string[]
}

export type EnvironmentFillInput = {
  repoRoot: string
  worktreePath: string
  /** Project `.kun/project.json` worktree section (already schema-parsed). */
  config?: {
    sharedDirectories?: ReadonlyArray<{ path: string; mode?: EnvShareMode }>
    copyFiles?: readonly string[]
  }
  /** User-level `agents.kun.worktrees.sharedPaths[repoRoot]` entries. */
  userSharedPaths?: ReadonlyArray<{ path: string; mode: EnvFillEntryMode }>
  signal?: AbortSignal
  git?: (cwd: string, args: string[], signal?: AbortSignal) => Promise<string>
  platform?: NodeJS.Platform
}

const MAX_RESULT_ENTRIES = 256
const MAX_WARNING_CHARS = 256

function normalizeRel(rel: string): string {
  return rel.replaceAll('\\', '/').replace(/^\.?\//, '').replace(/\/+$/g, '')
}

/** Path safety + ignore-state check (docs/ade/07 §6 rules 1-3). */
export async function environmentFillEligibility(
  repoRoot: string,
  rel: string,
  opts: { signal?: AbortSignal; git?: EnvironmentFillInput['git'] } = {}
): Promise<'ok' | EnvFillSkipReason> {
  const git = opts.git ?? workspaceGit
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return 'unsafe_path'
  // repoRoot itself may live under a symlinked prefix (e.g. /var on macOS);
  // compare real paths so containment checks are not fooled either way.
  const realRoot = await realpath(repoRoot).catch(() => repoRoot)
  const abs = join(realRoot, rel)
  const real = await realpath(abs).catch(() => null)
  if (!real) return 'missing'
  if (!isSameOrInside(realRoot, real)) return 'unsafe_path'
  const tracked = await git(repoRoot, ['ls-files', '--error-unmatch', '--', rel], opts.signal)
    .then(() => true, () => false)
  if (tracked) return 'tracked'
  const ignored = await git(repoRoot, ['check-ignore', '-q', '--', rel], opts.signal)
    .then(() => true, () => false)
  return ignored ? 'ok' : 'not_ignored'
}

async function destinationExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false)
}

async function shareDirectory(
  input: EnvironmentFillInput,
  rel: string,
  mode: EnvShareMode,
  result: EnvFillResult
): Promise<void> {
  const src = join(input.repoRoot, rel)
  const dst = join(input.worktreePath, rel)
  if (await destinationExists(dst)) {
    result.skipped.push({ path: rel, reason: 'exists' })
    return
  }
  await mkdir(dirname(dst), { recursive: true })
  if (mode === 'clone' && input.platform !== 'win32' && input.platform !== 'darwin') {
    // clone is an APFS optimization; other POSIX systems degrade to symlink.
    result.warnings.push(`clone unsupported on ${input.platform ?? process.platform}; linked ${rel}`.slice(0, MAX_WARNING_CHARS))
  }
  if (mode === 'clone' && (input.platform ?? process.platform) === 'darwin') {
    await cp(src, dst, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true })
    result.copied.push(rel)
    return
  }
  await symlink(src, dst, (input.platform ?? process.platform) === 'win32' ? 'junction' : 'dir')
  result.shared.push(rel)
}

async function copyPath(
  input: EnvironmentFillInput,
  rel: string,
  result: EnvFillResult
): Promise<void> {
  const src = join(input.repoRoot, rel)
  const dst = join(input.worktreePath, rel)
  if (await destinationExists(dst)) {
    result.skipped.push({ path: rel, reason: 'exists' })
    return
  }
  await mkdir(dirname(dst), { recursive: true })
  const info = await stat(src)
  if (info.isDirectory()) {
    await cp(src, dst, { recursive: true, force: false, errorOnExist: true })
  } else {
    await copyFile(src, dst, constants.COPYFILE_FICLONE)
  }
  result.copied.push(rel)
}

/** Merge project worktree config with user-level shares and apply fill. */
export async function fillTaskWorktreeEnvironment(
  input: EnvironmentFillInput
): Promise<EnvFillResult> {
  const result: EnvFillResult = { shared: [], copied: [], skipped: [], warnings: [] }
  const git = input.git ?? workspaceGit
  const shares: Array<{ path: string; mode: EnvShareMode }> = []
  const copies: string[] = []
  const seen = new Set<string>()
  for (const entry of input.config?.sharedDirectories ?? []) {
    const rel = normalizeRel(entry.path)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    shares.push({ path: rel, mode: entry.mode ?? 'symlink' })
  }
  for (const entry of input.userSharedPaths ?? []) {
    const rel = normalizeRel(entry.path)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    if (entry.mode === 'copy') copies.push(rel)
    else shares.push({ path: rel, mode: entry.mode })
  }
  for (const file of input.config?.copyFiles ?? []) {
    const rel = normalizeRel(file)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    copies.push(rel)
  }
  input.signal?.throwIfAborted()

  for (const entry of shares.slice(0, MAX_RESULT_ENTRIES)) {
    input.signal?.throwIfAborted()
    const status = await environmentFillEligibility(input.repoRoot, entry.path, { signal: input.signal, git })
    if (status !== 'ok') {
      result.skipped.push({ path: entry.path, reason: status })
      continue
    }
    try {
      await shareDirectory(input, entry.path, entry.mode, result)
    } catch (error) {
      result.skipped.push({ path: entry.path, reason: 'error' })
      result.warnings.push(
        `${entry.path}: ${(error instanceof Error ? error.message : String(error)).slice(0, MAX_WARNING_CHARS)}`
      )
    }
  }
  for (const rel of copies.slice(0, MAX_RESULT_ENTRIES)) {
    input.signal?.throwIfAborted()
    const status = await environmentFillEligibility(input.repoRoot, rel, { signal: input.signal, git })
    if (status !== 'ok') {
      result.skipped.push({ path: rel, reason: status })
      continue
    }
    try {
      await copyPath(input, rel, result)
    } catch (error) {
      result.skipped.push({ path: rel, reason: 'error' })
      result.warnings.push(
        `${rel}: ${(error instanceof Error ? error.message : String(error)).slice(0, MAX_WARNING_CHARS)}`
      )
    }
  }
  return result
}
