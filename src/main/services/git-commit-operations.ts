import { lstat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type {
  GitCommitResult,
  GitDiscardResult,
  GitOperationResult,
  GitPathsRequest,
  GitPushResult
} from '../../shared/git-commit'
import { execGit, GitCommandError, gitFailure, isSafeRepositoryPath } from './git-command'
import {
  gitConfigValue,
  gitRemotes,
  gitRepositoryRoot,
  parseGitStatusPorcelainV2,
  readPorcelainStatus,
  resolvePushRemote
} from './git-working-state'

const MUTATION_TIMEOUT_MS = 30_000
const COMMIT_TIMEOUT_MS = 120_000
const PUSH_TIMEOUT_MS = 180_000
const MAX_COMMIT_MESSAGE_CHARS = 64_000

const repositoryQueues = new Map<string, Promise<unknown>>()

/** One mutation per repository at a time, so two clicks never race on `index.lock`. */
function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = repositoryQueues.get(root) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  repositoryQueues.set(root, next)
  void next.finally(() => {
    if (repositoryQueues.get(root) === next) repositoryQueues.delete(root)
  }).catch(() => undefined)
  return next
}

function operationFailure(error: unknown): { ok: false; message: string; output?: string } {
  const output = error instanceof GitCommandError ? error.output : undefined
  return { ok: false, message: gitFailure(error).message, ...(output ? { output } : {}) }
}

async function repositoryRootOrThrow(workspaceRoot: string): Promise<string> {
  const root = await gitRepositoryRoot(workspaceRoot)
  if (!root) throw new Error('No working directory selected.')
  return root
}

function checkedPaths(paths: string[] | undefined): string[] | null {
  if (!paths) return []
  return paths.every(isSafeRepositoryPath) ? paths : null
}

export async function stageGitPaths(request: GitPathsRequest): Promise<GitOperationResult> {
  const paths = checkedPaths(request.paths)
  if (!paths) return { ok: false, message: 'Invalid file path.' }
  try {
    const root = await repositoryRootOrThrow(request.workspaceRoot)
    await serialized(root, () => execGit(
      root,
      paths.length ? ['--literal-pathspecs', 'add', '-A', '--', ...paths] : ['add', '-A'],
      { timeout: MUTATION_TIMEOUT_MS }
    ))
    return { ok: true }
  } catch (error) {
    return operationFailure(error)
  }
}

/** `git reset` rather than `restore --staged`, which refuses to run before the first commit. */
export async function unstageGitPaths(request: GitPathsRequest): Promise<GitOperationResult> {
  const paths = checkedPaths(request.paths)
  if (!paths) return { ok: false, message: 'Invalid file path.' }
  try {
    const root = await repositoryRootOrThrow(request.workspaceRoot)
    await serialized(root, () => execGit(
      root,
      paths.length ? ['--literal-pathspecs', 'reset', '-q', '--', ...paths] : ['reset', '-q'],
      { timeout: MUTATION_TIMEOUT_MS }
    ))
    return { ok: true }
  } catch (error) {
    return operationFailure(error)
  }
}

/**
 * Tracked paths go back to their staged (or committed) content; untracked
 * ones are handed to `trashItem` so a wrong click stays recoverable. Paths
 * that no longer have unstaged changes are skipped, so a list confirmed a
 * moment ago never reaches files that changed since.
 */
export async function discardGitPaths(
  request: { workspaceRoot: string; paths: string[] },
  trashItem: (absolutePath: string) => Promise<void>
): Promise<GitDiscardResult> {
  const paths = checkedPaths(request.paths)
  if (!paths || paths.length === 0) return { ok: false, message: 'Invalid file path.' }
  try {
    const root = await repositoryRootOrThrow(request.workspaceRoot)
    return await serialized(root, async () => {
      const status = await readPorcelainStatus(root, false)
      const current = new Map(parseGitStatusPorcelainV2(status.stdout).unstaged.map((entry) => [entry.path, entry.status]))
      const requested = new Set(paths)
      const tracked = [...requested].filter((path) => current.has(path) && current.get(path) !== 'untracked')
      const untracked = [...requested].filter((path) => current.get(path) === 'untracked')
      if (tracked.some((path) => current.get(path) === 'conflicted')) {
        return { ok: false as const, message: 'Resolve the merge conflict before discarding this file.' }
      }
      if (tracked.length) {
        await execGit(root, ['--literal-pathspecs', 'checkout', '--', ...tracked], { timeout: MUTATION_TIMEOUT_MS })
      }
      for (const path of untracked) {
        const absolute = join(root, path)
        const fromRoot = relative(root, absolute)
        if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..') continue
        await lstat(absolute)
        await trashItem(absolute)
      }
      return { ok: true as const, restored: tracked.length, trashed: untracked.length }
    })
  } catch (error) {
    return operationFailure(error)
  }
}

export async function commitGitChanges(request: {
  workspaceRoot: string
  message: string
  stageAll?: boolean
}): Promise<GitCommitResult> {
  const message = request.message.replace(/\r\n?/g, '\n').trim()
  if (!message) return { ok: false, reason: 'empty_message', message: 'Commit message is empty.' }
  if (message.length > MAX_COMMIT_MESSAGE_CHARS) {
    return { ok: false, reason: 'error', message: 'Commit message is too long.' }
  }
  try {
    const root = await repositoryRootOrThrow(request.workspaceRoot)
    return await serialized(root, async () => {
      if (request.stageAll) await execGit(root, ['add', '-A'], { timeout: MUTATION_TIMEOUT_MS })
      const staged = await execGit(root, ['diff', '--cached', '--quiet'], { okCodes: [0, 1] })
      if (staged.code === 0) {
        return { ok: false as const, reason: 'nothing_to_commit' as const, message: 'Nothing is staged to commit.' }
      }
      await execGit(root, ['commit', '-m', message], { timeout: COMMIT_TIMEOUT_MS })
      const [sha, subject] = (await execGit(root, ['log', '-1', '--format=%h%x1f%s'])).stdout.trim().split('\x1f')
      return { ok: true as const, sha, subject: subject ?? '' }
    })
  } catch (error) {
    return { reason: 'error', ...operationFailure(error) }
  }
}

function pushFailureReason(output: string): 'rejected' | 'auth' | 'error' {
  if (/\[rejected\]|non-fast-forward|fetch first|\[remote rejected\]/i.test(output)) return 'rejected'
  if (/authentication failed|permission denied|could not read (username|password)|terminal prompts disabled|returned error: 40[13]|publickey/i.test(output)) {
    return 'auth'
  }
  return 'error'
}

/**
 * Pushes the current branch. With a tracking branch it pushes there; the
 * first push of a branch runs `push -u <remote> <branch>` so later pushes,
 * ahead/behind and pulls all follow it.
 */
export async function pushGitBranch(request: { workspaceRoot: string }): Promise<GitPushResult> {
  let command = 'git push'
  try {
    const root = await repositoryRootOrThrow(request.workspaceRoot)
    return await serialized(root, async () => {
      const branch = (await execGit(root, ['branch', '--show-current'])).stdout.trim()
      if (!branch) {
        return { ok: false as const, reason: 'detached' as const, message: 'HEAD is detached; create a branch before pushing.', command, output: '' }
      }
      const remotes = await gitRemotes(root)
      const upstreamRemote = await gitConfigValue(root, `branch.${branch}.remote`)
      const upstreamMerge = await gitConfigValue(root, `branch.${branch}.merge`)
      const explicitPushRemote = (await gitConfigValue(root, `branch.${branch}.pushRemote`)) ?? (await gitConfigValue(root, 'remote.pushDefault'))
      const remote = await resolvePushRemote(root, branch, remotes)
      if (!remote || remote.startsWith('-')) {
        return { ok: false as const, reason: 'no_remote' as const, message: 'This repository has no remote to push to.', command, output: '' }
      }
      const hasUpstream = Boolean(upstreamRemote && upstreamMerge && remotes.includes(upstreamRemote))
      let args: string[]
      if (hasUpstream && !(explicitPushRemote && explicitPushRemote !== upstreamRemote)) {
        args = ['push', upstreamRemote as string, `HEAD:${upstreamMerge as string}`]
      } else if (hasUpstream) {
        args = ['push', remote, `HEAD:refs/heads/${branch}`]
      } else {
        args = ['push', '-u', remote, branch]
      }
      command = `git ${args.join(' ')}`
      try {
        const result = await execGit(root, args, { timeout: PUSH_TIMEOUT_MS })
        const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
        return { ok: true as const, remote: args[args.length - 2], branch, setUpstream: !hasUpstream, output }
      } catch (error) {
        const output = error instanceof GitCommandError ? error.output : gitFailure(error).message
        return { ok: false as const, reason: pushFailureReason(output), message: gitFailure(error).message, command, output }
      }
    })
  } catch (error) {
    const failure = gitFailure(error)
    return { ok: false, reason: 'error', message: failure.message, command, output: failure.message }
  }
}
