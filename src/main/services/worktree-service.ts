import { mkdir, rm, access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { runGit } from './git-service'
import {
  MAX_WORKTREE_POOL_SIZE,
  WORKTREE_BRANCH_PREFIX,
  WORKTREE_HAS_CHANGES_PREFIX,
  type MergeResult,
  type SyncResult,
  type WorktreeChanges,
  type WorktreeInfo,
  type WorktreePoolStatus
} from '../../shared/worktree'

/**
 * In-memory task ownership tracking (replaces TalkCody's Rust
 * WORKTREE_TASK_MAP lazy_static Mutex). Node is single-threaded so no lock
 * is needed; we only guard against async re-entrancy inside acquire/release.
 *
 * Map<projectPath, Map<poolIndex, taskId>>
 */
const taskMap = new Map<string, Map<number, string>>()

function getTaskId(projectPath: string, poolIndex: number): string | null {
  return taskMap.get(projectPath)?.get(poolIndex) ?? null
}

function setTaskId(projectPath: string, poolIndex: number, taskId: string | null): void {
  let inner = taskMap.get(projectPath)
  if (!inner) {
    inner = new Map()
    taskMap.set(projectPath, inner)
  }
  if (taskId === null) inner.delete(poolIndex)
  else inner.set(poolIndex, taskId)
}

function poolBranch(poolIndex: number): string {
  return `${WORKTREE_BRANCH_PREFIX}-${poolIndex}`
}

function worktreePath(poolDir: string, poolIndex: number): string {
  return join(poolDir, `pool-${poolIndex}`)
}

function resolvePoolDir(projectPath: string, worktreeRoot?: string): string {
  const projectBasename = basename(projectPath) || 'project'
  const root = worktreeRoot?.trim() || join(homedir(), '.kun')
  return join(root, projectBasename)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function getHeadCommit(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD'])
  return stdout.trim()
}

async function detectMainBranch(cwd: string): Promise<string> {
  // Prefer 'main', then 'master', fallback to current branch.
  const { stdout } = await runGit(cwd, ['branch', '--list', 'main', 'master', '--format=%(refname:short)'])
  const branches = stdout.split('\n').map((b) => b.trim()).filter(Boolean)
  if (branches.includes('main')) return 'main'
  if (branches.includes('master')) return 'master'
  if (branches.length > 0) return branches[0]
  // Fallback: current branch
  const { stdout: current } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return current.trim() || 'main'
}

async function countChanges(cwd: string): Promise<number> {
  try {
    const { stdout } = await runGit(cwd, ['status', '--porcelain'])
    return stdout.split('\n').filter((line) => line.trim().length > 0).length
  } catch {
    return 0
  }
}

export async function acquireWorktree(params: {
  projectPath: string
  poolIndex: number
  taskId: string
  force?: boolean
  worktreeRoot?: string
}): Promise<WorktreeInfo> {
  const { projectPath, poolIndex, taskId, force = false, worktreeRoot } = params

  if (poolIndex < 0 || poolIndex >= MAX_WORKTREE_POOL_SIZE) {
    throw new Error(`Pool index ${poolIndex} exceeds maximum pool size ${MAX_WORKTREE_POOL_SIZE}`)
  }

  const poolDir = resolvePoolDir(projectPath, worktreeRoot)
  const wtPath = worktreePath(poolDir, poolIndex)
  const branch = poolBranch(poolIndex)
  const headCommit = await getHeadCommit(projectPath)

  const exists = (await pathExists(wtPath)) && (await pathExists(join(wtPath, '.git')))

  if (exists) {
    const changesCount = await countChanges(wtPath)
    if (changesCount > 0 && !force) {
      throw new Error(`${WORKTREE_HAS_CHANGES_PREFIX}${poolIndex}:${changesCount}`)
    }
    // Reset to HEAD, then clean untracked (order matters: reset first).
    // Single -f: removes untracked files/dirs but preserves nested git repos.
    // (Nested repos would need an explicit second -f, which is destructive.)
    await runGit(wtPath, ['reset', '--hard', headCommit])
    await runGit(wtPath, ['clean', '-fd'])
  } else {
    await mkdir(poolDir, { recursive: true })
    try {
      await runGit(projectPath, ['worktree', 'add', '-b', branch, wtPath, headCommit])
    } catch {
      // Branch may already exist from a previous run; retry without -b.
      await runGit(projectPath, ['worktree', 'add', wtPath, branch])
    }
  }

  setTaskId(projectPath, poolIndex, taskId)
  return {
    poolIndex,
    path: wtPath,
    branch,
    inUse: true,
    taskId,
    baseCommit: headCommit,
    changesCount: 0
  }
}

export async function releaseWorktree(params: {
  projectPath: string
  poolIndex: number
}): Promise<void> {
  setTaskId(params.projectPath, params.poolIndex, null)
}

export async function listWorktrees(params: {
  projectPath: string
  worktreeRoot?: string
}): Promise<WorktreePoolStatus> {
  const { projectPath, worktreeRoot } = params
  const poolDir = resolvePoolDir(projectPath, worktreeRoot)

  let mainBranch: string
  let headCommit: string
  try {
    mainBranch = await detectMainBranch(projectPath)
    headCommit = await getHeadCommit(projectPath)
  } catch {
    return { projectPath, poolDir, mainBranch: '', headCommit: '', worktrees: [], inUseCount: 0, isGitRepo: false }
  }

  const worktrees: WorktreeInfo[] = []
  let inUseCount = 0

  for (let i = 0; i < MAX_WORKTREE_POOL_SIZE; i++) {
    const wtPath = worktreePath(poolDir, i)
    const exists = (await pathExists(wtPath)) && (await pathExists(join(wtPath, '.git')))
    if (!exists) continue

    const changesCount = await countChanges(wtPath)
    const baseCommit = await getHeadCommit(wtPath).catch(() => headCommit)
    const taskId = getTaskId(projectPath, i)
    const inUse = taskId !== null
    if (inUse) inUseCount += 1

    worktrees.push({
      poolIndex: i,
      path: wtPath,
      branch: poolBranch(i),
      inUse,
      taskId,
      baseCommit,
      changesCount
    })
  }

  return { projectPath, poolDir, mainBranch, headCommit, worktrees, inUseCount, isGitRepo: true }
}

export async function removeWorktree(params: {
  projectPath: string
  poolIndex: number
  worktreeRoot?: string
}): Promise<void> {
  const { projectPath, poolIndex, worktreeRoot } = params
  setTaskId(projectPath, poolIndex, null)
  const poolDir = resolvePoolDir(projectPath, worktreeRoot)
  const wtPath = worktreePath(poolDir, poolIndex)

  try {
    await runGit(projectPath, ['worktree', 'remove', '--force', wtPath])
  } catch {
    // Fallback: force-remove the directory.
    await rm(wtPath, { recursive: true, force: true })
  }
  // Best-effort branch deletion; ignore failure if branch doesn't exist.
  try {
    await runGit(projectPath, ['branch', '-D', poolBranch(poolIndex)])
  } catch {
    // ignore
  }
}

export async function getWorktreeChanges(params: { worktreePath: string }): Promise<WorktreeChanges> {
  const { worktreePath } = params
  const currentCommit = await getHeadCommit(worktreePath)
  const { stdout } = await runGit(worktreePath, ['status', '--porcelain'])

  const modifiedFiles: string[] = []
  const addedFiles: string[] = []
  const deletedFiles: string[] = []

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const status = line.slice(0, 2)
    const file = line.slice(3).trim()
    if (!file) continue

    if (status === '??') {
      addedFiles.push(file)
    } else if (status[0] === 'A' || status[1] === 'A') {
      addedFiles.push(file)
    } else if (status[0] === 'D' || status[1] === 'D') {
      deletedFiles.push(file)
    } else {
      modifiedFiles.push(file)
    }
  }

  const hasUncommitted = modifiedFiles.length + addedFiles.length + deletedFiles.length > 0
  return {
    worktreePath,
    // We don't track the original base commit; use current as TalkCody does.
    baseCommit: currentCommit,
    currentCommit,
    modifiedFiles,
    addedFiles,
    deletedFiles,
    hasUncommittedChanges: hasUncommitted
  }
}

export async function commitWorktree(params: {
  worktreePath: string
  message: string
}): Promise<string> {
  await runGit(params.worktreePath, ['add', '-A'])
  await runGit(params.worktreePath, ['commit', '-m', params.message])
  return getHeadCommit(params.worktreePath)
}

export async function mergeWorktreeToMain(params: {
  projectPath: string
  poolIndex: number
  commitMessage?: string
  worktreeRoot?: string
}): Promise<MergeResult> {
  const { projectPath, poolIndex, commitMessage, worktreeRoot } = params
  const poolDir = resolvePoolDir(projectPath, worktreeRoot)
  const wtPath = worktreePath(poolDir, poolIndex)
  const branch = poolBranch(poolIndex)
  const mainBranch = await detectMainBranch(projectPath)

  // Auto-commit pending changes in the worktree first.
  const changes = await getWorktreeChanges({ worktreePath: wtPath })
  if (changes.hasUncommittedChanges) {
    await commitWorktree({
      worktreePath: wtPath,
      message: commitMessage ?? `Auto-commit before merge (${branch})`
    })
  }

  // Safety: do NOT checkout main in the user's main repo. That would silently
  // switch the user's working branch. Instead, refuse unless the user is
  // already on the main branch.
  const { stdout: currentBranchOut } = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const currentBranch = currentBranchOut.trim()
  if (currentBranch !== mainBranch) {
    return {
      success: false,
      mergedCommit: null,
      hasConflicts: false,
      conflictedFiles: [],
      message: `Cannot merge: your main repo is on "${currentBranch}", not "${mainBranch}". Switch to "${mainBranch}" first to avoid disrupting your work.`
    }
  }

  // User is already on main; merge the pool branch in place (no checkout needed).
  // Try fast-forward first.
  try {
    await runGit(projectPath, ['merge', '--ff-only', branch])
  } catch {
    // Fast-forward failed; create a merge commit.
    try {
      await runGit(projectPath, ['merge', branch, '-m', commitMessage ?? `Merge ${branch} into ${mainBranch}`])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/CONFLICT|Automatic merge failed/i.test(msg)) {
        const { stdout } = await runGit(projectPath, ['diff', '--name-only', '--diff-filter=U'])
        const conflictedFiles = stdout.split('\n').map((f) => f.trim()).filter(Boolean)
        return {
          success: false,
          mergedCommit: null,
          hasConflicts: true,
          conflictedFiles,
          message: `Merge conflicts detected (${conflictedFiles.length} files)`
        }
      }
      throw err
    }
  }

  const mergedCommit = await getHeadCommit(projectPath)
  return {
    success: true,
    mergedCommit,
    hasConflicts: false,
    conflictedFiles: [],
    message: `Merged ${branch} into ${mainBranch}`
  }
}

export async function syncWorktreeFromMain(params: {
  projectPath: string
  poolIndex: number
  worktreeRoot?: string
}): Promise<SyncResult> {
  const { projectPath, poolIndex, worktreeRoot } = params
  const poolDir = resolvePoolDir(projectPath, worktreeRoot)
  const wtPath = worktreePath(poolDir, poolIndex)
  const mainBranch = await detectMainBranch(projectPath)
  const { stdout: mainHeadOut } = await runGit(projectPath, ['rev-parse', mainBranch])
  const mainHead = mainHeadOut.trim()

  // Stash pending changes before rebase.
  const changes = await getWorktreeChanges({ worktreePath: wtPath })
  let stashed = false
  if (changes.hasUncommittedChanges) {
    try {
      await runGit(wtPath, ['stash', 'push', '-m', 'Auto-stash before sync'])
      stashed = true
    } catch {
      // If stash fails (e.g. nothing to stash), continue.
    }
  }

  try {
    await runGit(wtPath, ['rebase', mainHead])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/CONFLICT|could not apply/i.test(msg)) {
      const { stdout } = await runGit(wtPath, ['diff', '--name-only', '--diff-filter=U'])
      const conflictedFiles = stdout.split('\n').map((f) => f.trim()).filter(Boolean)
      return {
        success: false,
        syncedCommit: null,
        hasConflicts: true,
        conflictedFiles,
        message: `Rebase conflicts detected (${conflictedFiles.length} files)`
      }
    }
    // Non-conflict failure: abort and rethrow.
    try {
      await runGit(wtPath, ['rebase', '--abort'])
    } catch {
      // ignore — may not be in a rebase
    }
    throw err
  }

  // Restore stash if we created one.
  if (stashed) {
    try {
      await runGit(wtPath, ['stash', 'pop'])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/CONFLICT/i.test(msg)) {
        const { stdout } = await runGit(wtPath, ['diff', '--name-only', '--diff-filter=U'])
        const conflictedFiles = stdout.split('\n').map((f) => f.trim()).filter(Boolean)
        return {
          success: false,
          syncedCommit: null,
          hasConflicts: true,
          conflictedFiles,
          message: `Stash pop conflicts after sync (${conflictedFiles.length} files). The rebase itself succeeded, but your auto-stashed changes conflicted on pop. Run \`git stash pop\` manually in the worktree to resolve.`
        }
      }
      // Non-conflict stash pop failure: stash is still on the stack.
      return {
        success: true,
        syncedCommit: await getHeadCommit(wtPath),
        hasConflicts: false,
        conflictedFiles: [],
        message: `Synced from ${mainBranch}, but auto-stash could not be popped (it remains on the stash stack). Run \`git stash pop\` manually in the worktree.`
      }
    }
  }

  const syncedCommit = await getHeadCommit(wtPath)
  return {
    success: true,
    syncedCommit,
    hasConflicts: false,
    conflictedFiles: [],
    message: `Synced ${wtPath} from ${mainBranch}`
  }
}

export async function abortMerge(params: { projectPath: string }): Promise<void> {
  await runGit(params.projectPath, ['merge', '--abort'])
}

export async function continueMerge(params: {
  projectPath: string
  message?: string
}): Promise<MergeResult> {
  await runGit(params.projectPath, ['add', '-A'])
  const { stdout } = await runGit(params.projectPath, ['diff', '--name-only', '--diff-filter=U'])
  const conflictedFiles = stdout.split('\n').map((f) => f.trim()).filter(Boolean)
  if (conflictedFiles.length > 0) {
    return {
      success: false,
      mergedCommit: null,
      hasConflicts: true,
      conflictedFiles,
      message: `Still ${conflictedFiles.length} unresolved conflicts`
    }
  }
  await runGit(params.projectPath, ['commit', '-m', params.message ?? 'Merge conflict resolved'])
  const mergedCommit = await getHeadCommit(params.projectPath)
  return { success: true, mergedCommit, hasConflicts: false, conflictedFiles: [], message: 'Merge completed' }
}

export async function abortRebase(params: { worktreePath: string }): Promise<void> {
  try {
    await runGit(params.worktreePath, ['rebase', '--abort'])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/no rebase in progress/i.test(msg)) throw err
  }
}

export async function cleanupWorktrees(params: {
  projectPath: string
  worktreeRoot?: string
}): Promise<void> {
  for (let i = 0; i < MAX_WORKTREE_POOL_SIZE; i++) {
    try {
      await removeWorktree({
        projectPath: params.projectPath,
        poolIndex: i,
        worktreeRoot: params.worktreeRoot
      })
    } catch {
      // best-effort
    }
  }
  const inner = taskMap.get(params.projectPath)
  if (inner) {
    inner.clear()
    taskMap.delete(params.projectPath)
  }
}

export async function findAvailablePoolIndex(params: {
  projectPath: string
  worktreeRoot?: string
}): Promise<number | null> {
  const status = await listWorktrees(params)
  for (let i = 0; i < MAX_WORKTREE_POOL_SIZE; i++) {
    const wt = status.worktrees.find((w) => w.poolIndex === i)
    if (!wt || !wt.inUse) return i
  }
  return null
}
