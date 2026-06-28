import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchesResult,
  GitBranchWorktreeRow,
  GitBranchWorktreesResult,
  GitWorktreeCheckoutResult
} from '../../shared/git-branches'
import { findNearestGitRoot } from './git-discovery'

const execFileAsync = promisify(execFile)

/**
 * Resolve a workspaceRoot to a directory that sits inside a Git working tree.
 *
 * `git rev-parse --show-toplevel` already walks up the directory tree, so it
 * usually finds the right cwd by itself. However, when the user's workspace
 * is set to a sub-folder of a repo AND the git binary is older than 2.28
 * (no `branch --format`) or returns an error string we don't match, the rest
 * of `getGitBranches` falls through to `gitFailure` and the UI shows
 * "未检测到 Git" even though we are clearly inside a repo. See issue #98.
 *
 * We mitigate that by walking up the tree in pure Node first and passing the
 * discovered repo root (or the original cwd if none was found) to git. This
 * is a defensive layer — when git itself works, the result is identical.
 */
export async function resolveGitCwd(workspaceRoot: string): Promise<string> {
  const trimmed = workspaceRoot.trim()
  if (!trimmed) return trimmed
  const discovered = await findNearestGitRoot(trimmed)
  return discovered ?? trimmed
}

export async function runGit(
  cwd: string,
  args: string[],
  timeout = 10_000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    // Force a C locale so git emits English diagnostics. gitFailure() matches
    // messages like "not a git repository"; without this, a localized git
    // (e.g. zh_CN: "不是 Git 仓库") falls through to a generic `error` reason
    // and the UI shows the wrong state instead of "not a Git repository".
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function gitFailure(error: unknown): GitBranchesResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function resolveBranchWorktreeRoot(worktreeRoot?: string): string {
  return worktreeRoot?.trim() || join(homedir(), '.kun', 'worktrees')
}

async function allocateBranchWorktreePath(
  sourceRepositoryRoot: string,
  worktreeRoot?: string
): Promise<string> {
  const repoName = basename(sourceRepositoryRoot) || 'project'
  const root = resolveBranchWorktreeRoot(worktreeRoot)
  for (let i = 0; i < 100; i += 1) {
    const id = randomBytes(2).toString('hex')
    const candidate = join(root, id, repoName)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(`Failed to allocate a free worktree path under ${root}`)
}

async function getPrimaryWorktreeRoot(cwd: string, fallback: string): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, ['worktree', 'list', '--porcelain'])
    const line = stdout.split('\n').find((item) => item.startsWith('worktree '))
    const root = line?.slice('worktree '.length).trim()
    return root || fallback
  } catch {
    return fallback
  }
}

async function allocateDerivedWorktreeBranch(cwd: string): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const branch = `kun/worktree-${randomBytes(3).toString('hex')}`
    try {
      await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    } catch {
      return branch
    }
  }
  throw new Error('Failed to allocate a free worktree branch name.')
}

function parseWorktreeListPorcelain(stdout: string): GitBranchWorktreeRow[] {
  const rows: GitBranchWorktreeRow[] = []
  let path = ''
  let branch: string | null = null
  let head = ''
  const flush = (): void => {
    if (path) rows.push({ path, branch, head })
    path = ''
    branch = null
    head = ''
  }
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      if (path) flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length).trim()
    }
  }
  flush()
  return rows
}

function gitWorktreeFailure(error: unknown): GitWorktreeCheckoutResult {
  const result = gitFailure(error)
  return result.ok
    ? { ok: false, reason: 'error', message: 'Unexpected Git branch result.' }
    : result
}

async function worktreeCheckoutResult(
  worktreePath: string,
  sourceRepositoryRoot: string
): Promise<GitWorktreeCheckoutResult> {
  const resolvedWorktreePath = await realpath(worktreePath).catch(() => worktreePath)
  const result = await getGitBranches(resolvedWorktreePath)
  if (!result.ok) return result
  return {
    ...result,
    sourceRepositoryRoot,
    worktreePath: result.repositoryRoot
  }
}

export async function getGitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const currentRaw = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentRaw || null
    const branchLines = (await runGit(cwd, ['branch', '--format=%(refname:short)'])).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)
    const worktreeRows = parseWorktreeListPorcelain(
      (await runGit(cwd, ['worktree', 'list', '--porcelain'])).stdout
    )
    const primaryRepositoryRoot = worktreeRows[0]?.path || repositoryRoot
    const worktreeByBranch = new Map<string, { path: string; primary: boolean }>()
    for (const row of worktreeRows) {
      if (row.branch && !worktreeByBranch.has(row.branch)) {
        worktreeByBranch.set(row.branch, { path: row.path, primary: row.path === primaryRepositoryRoot })
      }
    }
    const branches = [...branchSet].map((name) => {
      // A branch checked out in *another* worktree cannot be switched to here.
      // (The current branch lives in this worktree, so it's never "elsewhere".)
      const elsewhere = name === currentBranch ? undefined : worktreeByBranch.get(name)
      const offsite = elsewhere && elsewhere.path !== repositoryRoot ? elsewhere : undefined
      return {
        name,
        current: currentBranch === name,
        ...(offsite ? { worktreePath: offsite.path, worktreePrimary: offsite.primary } : {})
      }
    })
    const dirtyCount = (await runGit(cwd, ['status', '--porcelain=v1'])).stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length
    return { ok: true, repositoryRoot, primaryRepositoryRoot, currentBranch, branches, dirtyCount }
  } catch (error) {
    return gitFailure(error)
  }
}

export async function switchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    try {
      await runGit(cwd, ['switch', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function createAndSwitchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    try {
      await runGit(cwd, ['switch', '-c', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', '-b', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function checkoutGitBranchWorktree(
  workspaceRoot: string,
  branchName: string,
  worktreeRoot?: string
): Promise<GitWorktreeCheckoutResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    const currentRepositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const wtPath = await allocateBranchWorktreePath(sourceRepositoryRoot, worktreeRoot)
    const worktreeBranch = await allocateDerivedWorktreeBranch(cwd)
    await mkdir(join(wtPath, '..'), { recursive: true })
    // Always add from the primary checkout so multiple derived worktrees can be
    // created from the same source branch regardless of the caller's cwd.
    await runGit(sourceRepositoryRoot, ['worktree', 'add', '-b', worktreeBranch, wtPath, branch], 30_000)
    return worktreeCheckoutResult(wtPath, sourceRepositoryRoot)
  } catch (error) {
    return gitWorktreeFailure(error)
  }
}

export async function createGitBranchWorktree(
  workspaceRoot: string,
  branchName: string,
  worktreeRoot?: string
): Promise<GitWorktreeCheckoutResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    const currentRepositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const wtPath = await allocateBranchWorktreePath(sourceRepositoryRoot, worktreeRoot)
    await mkdir(join(wtPath, '..'), { recursive: true })
    await runGit(sourceRepositoryRoot, ['worktree', 'add', '-b', branch, wtPath, 'HEAD'], 30_000)
    return worktreeCheckoutResult(wtPath, sourceRepositoryRoot)
  } catch (error) {
    return gitWorktreeFailure(error)
  }
}

export async function listGitBranchWorktrees(
  workspaceRoot: string,
  worktreeRoot?: string
): Promise<GitBranchWorktreesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  try {
    const currentRepositoryRoot = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const root = await realpath(resolveBranchWorktreeRoot(worktreeRoot)).catch(() => resolveBranchWorktreeRoot(worktreeRoot))
    const { stdout } = await runGit(cwd, ['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktreeListPorcelain(stdout)
      .filter((row) => row.path !== sourceRepositoryRoot)
      .filter((row) => row.path === root || row.path.startsWith(`${root}/`))
    return {
      ok: true,
      repositoryRoot: sourceRepositoryRoot,
      worktreeRoot: root,
      worktrees
    }
  } catch (error) {
    const result = gitFailure(error)
    return result.ok ? { ok: false, reason: 'error', message: 'Unexpected Git branch result.' } : result
  }
}

export async function removeGitBranchWorktree(params: {
  workspaceRoot: string
  worktreePath: string
}): Promise<void> {
  const cwd = await resolveGitCwd(params.workspaceRoot)
  if (!cwd) throw new Error('No working directory selected.')
  await runGit(cwd, ['worktree', 'remove', '--force', params.worktreePath], 30_000)
}
