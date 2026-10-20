import type {
  GitBranchCommit,
  GitBranchComparison,
  GitChangeStatus,
  GitFileDiffRequest,
  GitFileDiffResult
} from '../../shared/git-commit'
import { execGit, FULL_COMMIT_ID, gitFailure, isSafeRepositoryPath } from './git-command'
import {
  gitRemotes,
  gitRepositoryRoot,
  MAX_GIT_CHANGE_ENTRIES,
  parseNumstatZ,
  resolvePushRemote,
  withLineCounts
} from './git-working-state'

const BASE_NAMES = ['develop', 'main', 'master']
const MAX_BRANCH_COMMITS = 50
const MAX_DIFF_CHARS = 400_000
const DIFF_MAX_BUFFER = 16 * 1024 * 1024

async function refExists(root: string, ref: string): Promise<boolean> {
  const result = await execGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { okCodes: [0, 1, 128] })
  return result.code === 0
}

async function symbolicRef(root: string, ref: string): Promise<string | null> {
  const result = await execGit(root, ['symbolic-ref', '--quiet', ref], { okCodes: [0, 1, 128] })
  return result.code === 0 ? result.stdout.trim() || null : null
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
}

/**
 * Candidate bases: the remote's default branch, then develop / main / master
 * locally and on that remote. The nearest one (fewest commits ahead) wins, so
 * a feature branch cut from develop is compared with develop even when the
 * remote's default is main.
 */
export async function pickComparisonBase(
  root: string,
  branch: string | null
): Promise<{ ref: string; ahead: number; behind: number } | null> {
  const remotes = await gitRemotes(root)
  const remote = await resolvePushRemote(root, branch, remotes)
  const upstream = branch
    ? await execGit(root, ['rev-parse', '--symbolic-full-name', '@{upstream}'], { okCodes: [0, 128] })
    : null
  const excluded = new Set([branch ? `refs/heads/${branch}` : '', upstream?.code === 0 ? upstream.stdout.trim() : ''])
  const candidates: string[] = []
  const remoteHead = remote ? await symbolicRef(root, `refs/remotes/${remote}/HEAD`) : null
  if (remoteHead) candidates.push(remoteHead)
  for (const name of BASE_NAMES) {
    candidates.push(`refs/heads/${name}`)
    if (remote) candidates.push(`refs/remotes/${remote}/${name}`)
  }
  let best: { ref: string; ahead: number; behind: number } | null = null
  for (const ref of [...new Set(candidates)]) {
    if (excluded.has(ref) || !(await refExists(root, ref))) continue
    const counts = await execGit(root, ['rev-list', '--left-right', '--count', `${ref}...HEAD`])
    const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number)
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) continue
    if (!best || ahead < best.ahead) best = { ref, ahead, behind }
  }
  return best
}

const NAME_STATUS: Record<string, GitChangeStatus> = {
  M: 'modified', T: 'typechange', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflicted'
}

/** Parses `git diff --name-status -z`. */
export function parseNameStatusZ(stdout: string): Array<{ path: string; previousPath?: string; status: GitChangeStatus }> {
  const records = stdout.split('\0')
  const entries: Array<{ path: string; previousPath?: string; status: GitChangeStatus }> = []
  for (let index = 0; index < records.length; index += 1) {
    const code = records[index]
    if (!code) continue
    const status = NAME_STATUS[code[0]]
    if (code[0] === 'R' || code[0] === 'C') {
      const previousPath = records[index + 1] ?? ''
      const path = records[index + 2] ?? ''
      index += 2
      if (status && path) entries.push({ path, previousPath, status })
      continue
    }
    const path = records[index + 1] ?? ''
    index += 1
    if (status && path) entries.push({ path, status })
  }
  return entries
}

/** Everything on this branch since it left its base: commits ahead plus uncommitted work. */
export async function getGitBranchComparison(workspaceRoot: string): Promise<GitBranchComparison> {
  try {
    const root = await gitRepositoryRoot(workspaceRoot)
    if (!root) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
    if (!(await refExists(root, 'HEAD'))) {
      return { ok: false, reason: 'no_base', message: 'This branch has no commits yet.' }
    }
    const branch = (await execGit(root, ['branch', '--show-current'])).stdout.trim() || null
    const base = await pickComparisonBase(root, branch)
    if (!base) return { ok: false, reason: 'no_base', message: 'No base branch to compare with.' }
    const mergeBase = (await execGit(root, ['merge-base', base.ref, 'HEAD'])).stdout.trim()
    const diffArgs = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-color', '-M', '-z']
    const [names, counts, untracked, log, remotes] = await Promise.all([
      execGit(root, [...diffArgs, '--name-status', mergeBase], { maxBuffer: DIFF_MAX_BUFFER }),
      execGit(root, [...diffArgs, '--numstat', mergeBase], { maxBuffer: DIFF_MAX_BUFFER }),
      execGit(root, ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'], { maxBuffer: DIFF_MAX_BUFFER }),
      execGit(root, ['log', '--format=%H%x1f%s%x1e', '-n', String(MAX_BRANCH_COMMITS), `${mergeBase}..HEAD`]),
      gitRemotes(root)
    ])
    const unpushed = remotes.length
      ? new Set((await execGit(root, ['rev-list', '-n', '500', 'HEAD', '--not', '--remotes'])).stdout.split('\n').map((line) => line.trim()))
      : null
    const entries = [
      ...parseNameStatusZ(names.stdout),
      ...untracked.stdout.split('\0').filter(Boolean).map((path) => ({ path, status: 'untracked' as const }))
    ]
    const commits: GitBranchCommit[] = log.stdout.split('\x1e').map((row) => row.trim()).filter(Boolean).map((row) => {
      const [sha, subject] = row.split('\x1f')
      return { sha, subject: subject ?? '', pushed: unpushed ? !unpushed.has(sha) : false }
    })
    return {
      ok: true,
      base: shortRef(base.ref),
      mergeBase,
      ahead: base.ahead,
      behind: base.behind,
      files: await withLineCounts(root, entries.slice(0, MAX_GIT_CHANGE_ENTRIES), parseNumstatZ(counts.stdout)),
      commits,
      truncated: entries.length > MAX_GIT_CHANGE_ENTRIES
    }
  } catch (error) {
    return { ok: false, ...gitFailure(error) }
  }
}

function diffResult(text: string): GitFileDiffResult {
  const truncated = text.length > MAX_DIFF_CHARS
  const diff = truncated ? text.slice(0, MAX_DIFF_CHARS) : text
  return { ok: true, diff, truncated, binary: /^Binary files .* differ$/m.test(diff) && !/^@@ /m.test(diff) }
}

/** Unified diff of one file on one side of the commit flow. */
export async function getGitFileDiff(request: GitFileDiffRequest): Promise<GitFileDiffResult> {
  const paths = [request.previousPath, request.path].filter((path): path is string => Boolean(path))
  if (!paths.every(isSafeRepositoryPath)) return { ok: false, message: 'Invalid file path.' }
  if (request.side === 'branch' && !(request.mergeBase && FULL_COMMIT_ID.test(request.mergeBase))) {
    return { ok: false, message: 'Missing branch fork point.' }
  }
  try {
    const root = await gitRepositoryRoot(request.workspaceRoot)
    if (!root) return { ok: false, message: 'No working directory selected.' }
    const options = { timeout: 15_000, maxBuffer: DIFF_MAX_BUFFER }
    const base = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-color']
    if (request.untracked) {
      const result = await execGit(root, [...base, '--no-index', '--', '/dev/null', request.path], { ...options, okCodes: [0, 1] })
      return diffResult(result.stdout)
    }
    const args = request.side === 'staged'
      ? [...base, '--cached', '-M']
      : request.side === 'branch'
        ? [...base, '-M', request.mergeBase as string]
        : base
    const result = await execGit(root, ['--literal-pathspecs', ...args, '--', ...paths], options)
    return diffResult(result.stdout)
  } catch (error) {
    return { ok: false, message: gitFailure(error).message }
  }
}
