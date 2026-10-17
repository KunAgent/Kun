import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { SourceCommandCapture } from './builtin-tool-types.js'

/**
 * Read-only git access for Fast Context indexes. Commands never take optional
 * locks (so they cannot rewrite the index under the user), never consult a
 * configured fsmonitor hook, and print raw UTF-8 paths.
 */
const SAFE_GIT_FLAGS = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotepath=off'
]

const MAX_PARENT_LEVELS = 40

export type FastContextGitDirectory = {
  /** Directory that contains the work tree's `.git` entry. */
  workTreeRoot: string
  /** Per-worktree git directory (holds HEAD and index). */
  gitDir: string
}

/** Finds the enclosing repository without spawning git (handles worktrees). */
export async function findFastContextGitDirectory(root: string): Promise<FastContextGitDirectory | null> {
  let current = resolve(root)
  for (let level = 0; level < MAX_PARENT_LEVELS; level += 1) {
    const candidate = join(current, '.git')
    try {
      const entry = await stat(candidate)
      if (entry.isDirectory()) return { workTreeRoot: current, gitDir: candidate }
      if (entry.isFile()) {
        const text = await readFile(candidate, 'utf8')
        const match = /^gitdir:\s*(.+)\s*$/m.exec(text)
        if (!match?.[1]) return null
        const gitDir = isAbsolute(match[1]) ? match[1] : resolve(current, match[1])
        return { workTreeRoot: current, gitDir }
      }
    } catch {
      // Not here; keep walking toward the filesystem root.
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * Cheap change stamp: HEAD contents plus the index file's mtime and size.
 * Any commit, checkout, stage, or `git status` index refresh changes it.
 */
export async function fastContextGitStamp(root: string): Promise<string | undefined> {
  const repository = await findFastContextGitDirectory(root)
  if (!repository) return undefined
  try {
    const [head, index] = await Promise.all([
      readFile(join(repository.gitDir, 'HEAD'), 'utf8'),
      stat(join(repository.gitDir, 'index')).catch(() => null)
    ])
    return `${head.trim()}|${index?.mtimeMs ?? 0}|${index?.size ?? 0}`
  } catch {
    return undefined
  }
}

export type FastContextGitResult = { ok: boolean; stdout: string; truncated: boolean }

/** Runs one bounded, low-priority, read-only git command in `root`. */
export async function runFastContextGit(
  root: string,
  args: readonly string[],
  capture: SourceCommandCapture,
  options: { maxOutputBytes?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<FastContextGitResult> {
  try {
    const result = await capture('git', [...SAFE_GIT_FLAGS, ...args], {
      cwd: root,
      lowPriority: true,
      maxOutputBytes: options.maxOutputBytes ?? 32 * 1024 * 1024,
      timeoutMs: options.timeoutMs ?? 15_000,
      ...(options.signal ? { signal: options.signal } : {})
    })
    return {
      ok: result.exitCode === 0 && !result.timedOut,
      stdout: result.stdout,
      truncated: result.outputTruncated
    }
  } catch {
    // git missing from PATH, or the spawn was refused: callers fall back.
    return { ok: false, stdout: '', truncated: false }
  }
}

/** NUL-separated git path output to normalized relative paths. */
export function splitGitPaths(stdout: string): string[] {
  return stdout.split('\0').map((value) => value.trim()).filter(Boolean)
}
