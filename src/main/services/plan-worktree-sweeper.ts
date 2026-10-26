import { readdir, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { runGit } from './git-service'
import { logInfo, logWarn } from '../logger'

/**
 * Reclaims `~/.kun/worktrees/plan-prompt/*` worktrees that plan builds left
 * behind. Only worktrees that are clean, idle, and fully contained in another
 * local branch are removed, and always without force, so no unique work is lost.
 */

const IDLE_MS = 60 * 60 * 1000
const EMPTY_DIR_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 30 * 60 * 1000

export type PlanWorktreeSweepResult = { removed: string[]; skipped: number }

type GitRunner = (cwd: string, args: string[]) => Promise<string>

const defaultGit: GitRunner = async (cwd, args) => (await runGit(cwd, args, 30_000)).stdout

export function planWorktreeRoot(): string {
  return join(homedir(), '.kun', 'worktrees', 'plan-prompt')
}

async function mtimeMs(path: string): Promise<number | null> {
  return stat(path).then((info) => info.mtimeMs, () => null)
}

async function sweepWorktree(path: string, git: GitRunner, now: number): Promise<boolean> {
  const gitdir = (await git(path, ['rev-parse', '--absolute-git-dir'])).trim()
  const stamps = await Promise.all([path, gitdir, join(gitdir, 'HEAD'), join(gitdir, 'index')].map(mtimeMs))
  const newest = Math.max(...stamps.filter((value): value is number => value !== null))
  if (now - newest < IDLE_MS) return false
  if ((await git(path, ['status', '--porcelain'])).trim()) return false
  const branch = (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const containing = (await git(path, [
    'for-each-ref', '--contains', 'HEAD', 'refs/heads', '--format=%(refname:short)'
  ])).split('\n').map((line) => line.trim()).filter((name) => name && name !== branch)
  if (containing.length === 0) return false
  const commonDir = (await git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  const repo = dirname(commonDir)
  await git(repo, ['worktree', 'remove', path])
  if (branch && branch !== 'HEAD') await git(repo, ['branch', '-d', branch]).catch(() => '')
  await git(repo, ['worktree', 'prune']).catch(() => '')
  return true
}

export async function sweepPlanWorktrees(options: {
  root?: string
  now?: number
  git?: GitRunner
} = {}): Promise<PlanWorktreeSweepResult> {
  const root = options.root ?? planWorktreeRoot()
  const now = options.now ?? Date.now()
  const git = options.git ?? defaultGit
  const result: PlanWorktreeSweepResult = { removed: [], skipped: 0 }
  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    const dir = join(root, name)
    try {
      const children = await readdir(dir)
      if (children.length === 0) {
        const age = now - ((await mtimeMs(dir)) ?? now)
        if (age >= EMPTY_DIR_MS) await rmdir(dir)
        continue
      }
      let removedAny = false
      for (const child of children) {
        const path = join(dir, child)
        if ((await mtimeMs(join(path, '.git'))) === null) continue
        if (await sweepWorktree(path, git, now)) {
          result.removed.push(path)
          removedAny = true
        } else {
          result.skipped += 1
        }
      }
      if (removedAny && (await readdir(dir)).length === 0) await rmdir(dir)
    } catch (error) {
      result.skipped += 1
      logWarn('plan-worktree-sweep', 'Skipped a plan worktree.', {
        dir, message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  if (result.removed.length > 0) {
    logInfo('plan-worktree-sweep', 'Removed merged plan worktrees.', { removed: result.removed })
  }
  return result
}

/** First sweep shortly after startup, then every 30 minutes. Returns a disposer. */
export function startPlanWorktreeSweeper(): () => void {
  const run = (): void => { void sweepPlanWorktrees().catch(() => undefined) }
  const first = setTimeout(run, 60_000)
  const timer = setInterval(run, SWEEP_INTERVAL_MS)
  first.unref()
  timer.unref()
  return () => { clearTimeout(first); clearInterval(timer) }
}
