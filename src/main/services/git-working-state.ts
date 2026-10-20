import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitChangeEntry, GitChangeStatus, GitWorkingState } from '../../shared/git-commit'
import { execGit, gitFailure, isOutputOverflow } from './git-command'
import { resolveGitCwd } from './git-service'

export const MAX_GIT_CHANGE_ENTRIES = 2_000
const MAX_COUNTED_UNTRACKED = 300
const MAX_COUNTED_BYTES = 1024 * 1024
const STATUS_TIMEOUT_MS = 15_000
const STATUS_MAX_BUFFER = 16 * 1024 * 1024

type ParsedEntry = Omit<GitChangeEntry, 'additions' | 'deletions'>

export type ParsedPorcelainV2 = {
  head: string | null
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: ParsedEntry[]
  unstaged: ParsedEntry[]
}

const STATUS_BY_CODE: Record<string, GitChangeStatus> = {
  M: 'modified',
  T: 'typechange',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied'
}

/** Splits the first `count - 1` space-separated fields off; the rest is the path, spaces and all. */
function fields(record: string, count: number): string[] {
  const parts: string[] = []
  let rest = record
  for (let index = 0; index < count - 1; index += 1) {
    const space = rest.indexOf(' ')
    if (space < 0) return []
    parts.push(rest.slice(0, space))
    rest = rest.slice(space + 1)
  }
  parts.push(rest)
  return parts
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseGitStatusPorcelainV2(stdout: string): ParsedPorcelainV2 {
  const parsed: ParsedPorcelainV2 = {
    head: null, branch: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: []
  }
  const records = stdout.split('\0')
  const push = (target: ParsedEntry[], code: string | undefined, path: string, previousPath?: string): void => {
    const status = code ? STATUS_BY_CODE[code] : undefined
    if (!status || !path) return
    target.push({ path, status, ...(previousPath && (status === 'renamed' || status === 'copied') ? { previousPath } : {}) })
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('# ')) {
      const [key, ...values] = record.slice(2).split(' ')
      const value = values.join(' ')
      if (key === 'branch.oid') parsed.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') parsed.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') parsed.upstream = value || null
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value)
        if (match) {
          parsed.ahead = Number(match[1])
          parsed.behind = Number(match[2])
        }
      }
      continue
    }
    const kind = record[0]
    if (kind === '1') {
      const [, xy, , , , , , , path] = fields(record, 9)
      push(parsed.staged, xy?.[0], path)
      push(parsed.unstaged, xy?.[1], path)
    } else if (kind === '2') {
      const [, xy, , , , , , , , path] = fields(record, 10)
      const previousPath = records[index + 1] ?? ''
      index += 1
      push(parsed.staged, xy?.[0], path, previousPath)
      push(parsed.unstaged, xy?.[1], path, previousPath)
    } else if (kind === 'u') {
      const path = fields(record, 11)[10]
      if (path) parsed.unstaged.push({ path, status: 'conflicted' })
    } else if (kind === '?') {
      const path = record.slice(2).replace(/\/$/, '')
      if (path) parsed.unstaged.push({ path, status: 'untracked' })
    }
  }
  return parsed
}

export type LineCounts = { additions: number | null; deletions: number | null }

/** Parses `git diff --numstat -z`; renames key on the destination path. */
export function parseNumstatZ(stdout: string): Map<string, LineCounts> {
  const counts = new Map<string, LineCounts>()
  const records = stdout.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const [added, deleted, path] = record.split('\t')
    if (added === undefined || deleted === undefined || path === undefined) continue
    let target = path
    if (!target) {
      target = records[index + 2] ?? ''
      index += 2
    }
    if (!target) continue
    counts.set(target, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted)
    })
  }
  return counts
}

/** Line count of a new file, or null for binary and very large files. */
export async function countUntrackedLines(path: string): Promise<number | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_COUNTED_BYTES) return null
    const buffer = Buffer.alloc(info.size)
    await handle.read(buffer, 0, info.size, 0)
    if (buffer.subarray(0, 8_000).includes(0)) return null
    if (buffer.length === 0) return 0
    let lines = 0
    for (const byte of buffer) if (byte === 10) lines += 1
    return buffer[buffer.length - 1] === 10 ? lines : lines + 1
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function gitRepositoryRoot(workspaceRoot: string): Promise<string | null> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return null
  return (await execGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
}

export async function gitConfigValue(root: string, key: string): Promise<string | null> {
  const result = await execGit(root, ['config', '--get', key], { okCodes: [0, 1] })
  return result.code === 0 ? result.stdout.trim() || null : null
}

export async function gitRemotes(root: string): Promise<string[]> {
  return (await execGit(root, ['remote'])).stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

/** Remote a push of `branch` goes to: configured push remote, tracking remote, `origin`, or the only remote. */
export async function resolvePushRemote(root: string, branch: string | null, remotes: string[]): Promise<string | null> {
  if (remotes.length === 0) return null
  const configured = [
    branch ? await gitConfigValue(root, `branch.${branch}.pushRemote`) : null,
    await gitConfigValue(root, 'remote.pushDefault'),
    branch ? await gitConfigValue(root, `branch.${branch}.remote`) : null
  ].find((name) => name && remotes.includes(name))
  if (configured) return configured
  if (remotes.includes('origin')) return 'origin'
  return remotes.length === 1 ? remotes[0] : null
}

async function numstat(root: string, args: string[]): Promise<Map<string, LineCounts>> {
  const result = await execGit(
    root,
    ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-color', '--numstat', '-z', ...args],
    { timeout: STATUS_TIMEOUT_MS, maxBuffer: STATUS_MAX_BUFFER }
  )
  return parseNumstatZ(result.stdout)
}

export async function withLineCounts(
  root: string,
  entries: ParsedEntry[],
  counts: Map<string, LineCounts>
): Promise<GitChangeEntry[]> {
  let counted = 0
  return Promise.all(entries.map(async (entry) => {
    if (entry.status === 'untracked') {
      counted += 1
      const lines = counted <= MAX_COUNTED_UNTRACKED ? await countUntrackedLines(join(root, entry.path)) : null
      return { ...entry, additions: lines, deletions: lines === null ? null : 0 }
    }
    const count = counts.get(entry.path)
    return { ...entry, additions: count?.additions ?? null, deletions: count?.deletions ?? null }
  }))
}

/**
 * `git status` with every untracked file listed. A tree whose untracked files
 * overflow the buffer (an unignored dependency folder) falls back to one
 * entry per untracked directory.
 */
export async function readPorcelainStatus(root: string, branch: boolean): Promise<{ stdout: string; collapsed: boolean }> {
  const args = ['-c', 'core.quotePath=false', 'status', '--porcelain=v2', ...(branch ? ['--branch'] : []), '-z']
  const options = { timeout: STATUS_TIMEOUT_MS, maxBuffer: STATUS_MAX_BUFFER }
  try {
    return { stdout: (await execGit(root, [...args, '--untracked-files=all'], options)).stdout, collapsed: false }
  } catch (error) {
    if (!isOutputOverflow(error)) throw error
    return { stdout: (await execGit(root, [...args, '--untracked-files=normal'], options)).stdout, collapsed: true }
  }
}

/** Branch, tracking and the staged / unstaged split for the repository holding `workspaceRoot`. */
export async function getGitWorkingState(workspaceRoot: string): Promise<GitWorkingState> {
  if (!workspaceRoot.trim()) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  try {
    const root = await gitRepositoryRoot(workspaceRoot)
    if (!root) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    const status = await readPorcelainStatus(root, true)
    const parsed = parseGitStatusPorcelainV2(status.stdout)
    const truncated = status.collapsed ||
      parsed.staged.length > MAX_GIT_CHANGE_ENTRIES || parsed.unstaged.length > MAX_GIT_CHANGE_ENTRIES
    const [stagedCounts, unstagedCounts, remotes] = await Promise.all([
      parsed.staged.length ? numstat(root, ['--cached', '-M']) : new Map<string, LineCounts>(),
      parsed.unstaged.some((entry) => entry.status !== 'untracked') ? numstat(root, []) : new Map<string, LineCounts>(),
      gitRemotes(root)
    ])
    const pushRemote = await resolvePushRemote(root, parsed.branch, remotes)
    let unpushed = parsed.ahead
    if (!parsed.upstream && parsed.head && remotes.length > 0) {
      const count = await execGit(root, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
      unpushed = Number(count.stdout.trim()) || 0
    }
    return {
      ok: true,
      repositoryRoot: root,
      branch: parsed.branch,
      head: parsed.head ? parsed.head.slice(0, 7) : null,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      unpushed,
      pushRemote,
      staged: await withLineCounts(root, parsed.staged.slice(0, MAX_GIT_CHANGE_ENTRIES), stagedCounts),
      unstaged: await withLineCounts(root, parsed.unstaged.slice(0, MAX_GIT_CHANGE_ENTRIES), unstagedCounts),
      truncated
    }
  } catch (error) {
    return { ok: false, ...gitFailure(error) }
  }
}
