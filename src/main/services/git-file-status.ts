import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type {
  GitFileStatusCode,
  GitFileStatusEntry,
  GitFileStatusResult
} from '../../shared/git-file-status'
import { resolveGitCwd, runGit } from './git-service'

export const MAX_GIT_FILE_STATUS_ENTRIES = 5_000
const GIT_STATUS_TIMEOUT_MS = 8_000
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export function gitStatusCodeFromPorcelain(xy: string): GitFileStatusCode | null {
  if (xy === '??') return 'untracked'
  if (xy === '!!') return 'ignored'
  if (CONFLICT_CODES.has(xy)) return 'conflicted'
  const [index, worktree] = [xy[0] ?? ' ', xy[1] ?? ' ']
  if (index === 'R' || index === 'C') return 'renamed'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'A') return 'added'
  if (index !== ' ' || worktree !== ' ') return 'modified'
  return null
}

export type PorcelainEntry = { path: string; status: GitFileStatusCode; directory: boolean }

/** Parses `git status --porcelain=v1 -z`; renames carry a second NUL-separated source path. */
export function parseGitStatusPorcelainZ(stdout: string): PorcelainEntry[] {
  const fields = stdout.split('\0')
  const entries: PorcelainEntry[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field.length < 4) continue
    const xy = field.slice(0, 2)
    const path = field.slice(3)
    const status = gitStatusCodeFromPorcelain(xy)
    if (xy[0] === 'R' || xy[0] === 'C') index += 1
    if (!status || !path) continue
    entries.push({ path: path.replace(/\/$/, ''), status, directory: path.endsWith('/') })
  }
  return entries
}

function failure(error: unknown): GitFileStatusResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

/**
 * Changed, untracked and ignored paths for a workspace. Paths come back under
 * the workspace root as the caller spelled it, so a symlinked or sub-folder
 * workspace still matches the file tree's own paths.
 */
export async function getGitFileStatus(workspaceRoot: string): Promise<GitFileStatusResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  try {
    const repositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const branch = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim() || null
    const { stdout } = await runGit(
      cwd,
      ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignored=traditional'],
      GIT_STATUS_TIMEOUT_MS,
      GIT_STATUS_MAX_BUFFER
    )
    const [repositoryReal, workspaceReal] = await Promise.all([
      realpath(repositoryRoot).catch(() => repositoryRoot),
      realpath(workspaceRoot).catch(() => workspaceRoot)
    ])
    const entries: GitFileStatusEntry[] = []
    let truncated = false
    for (const entry of parseGitStatusPorcelainZ(stdout)) {
      const fromWorkspace = relative(workspaceReal, join(repositoryReal, entry.path))
      if (!fromWorkspace || fromWorkspace.startsWith(`..${sep}`) || fromWorkspace === '..' || isAbsolute(fromWorkspace)) {
        continue
      }
      if (entries.length >= MAX_GIT_FILE_STATUS_ENTRIES) {
        truncated = true
        break
      }
      entries.push({
        path: join(workspaceRoot, fromWorkspace),
        status: entry.status,
        ...(entry.directory ? { directory: true } : {})
      })
    }
    return { ok: true, branch, entries, truncated }
  } catch (error) {
    return failure(error)
  }
}
