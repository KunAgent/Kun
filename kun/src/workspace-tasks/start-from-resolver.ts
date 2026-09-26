import { workspaceGit } from './workspace-git.js'
import type { StartFrom } from '../contracts/task-workspace.js'

export type ResolvedStartFrom = {
  sha: string
  /** Human-readable ref the sha came from, when one exists. */
  ref?: string
  /** Fetch fell back to the already-known remote ref. */
  warning?: string
}

export type ResolveStartFromOptions = {
  signal?: AbortSignal
  fetchTimeoutMs?: number
}

const DEFAULT_FETCH_TIMEOUT_MS = 60_000

async function assertBranchName(repoRoot: string, name: string): Promise<void> {
  try {
    await workspaceGit(repoRoot, ['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`invalid branch name: ${name}`)
  }
}

async function assertRemoteName(repoRoot: string, remote: string): Promise<void> {
  try {
    await workspaceGit(repoRoot, ['check-ref-format', `refs/remotes/${remote}`])
  } catch {
    throw new Error(`invalid remote name: ${remote}`)
  }
}

async function fetchRemote(
  repoRoot: string,
  remote: string,
  args: string[],
  options: ResolveStartFromOptions
): Promise<string | undefined> {
  try {
    await workspaceGit(
      repoRoot,
      ['fetch', '--quiet', remote, ...args],
      options.signal,
      options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    )
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 256) : 'fetch failed'
  }
}

/**
 * Resolve a start-from selector to a concrete commit sha (docs/ade/07
 * §5). All git calls go through `workspaceGit`; ref names are validated
 * with `git check-ref-format` before use.
 */
export async function resolveStartFrom(
  repo: { root: string },
  startFrom: StartFrom,
  options: ResolveStartFromOptions = {}
): Promise<ResolvedStartFrom> {
  const { signal } = options
  switch (startFrom.kind) {
    case 'current-head': {
      return {
        sha: (await workspaceGit(repo.root, ['rev-parse', 'HEAD'], signal)).trim()
      }
    }
    case 'default-branch': {
      const originHead = await workspaceGit(repo.root, [
        'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'
      ], signal).then((out) => out.trim()).catch(() => '')
      if (originHead.startsWith('origin/')) {
        const ref = `refs/remotes/${originHead}`
        const warning = await fetchRemote(repo.root, 'origin', [], options)
        const sha = await workspaceGit(repo.root, [
          'rev-parse', '--verify', `${ref}^{commit}`
        ], signal).then((out) => out.trim()).catch(() => '')
        if (sha) {
          return {
            sha,
            ref: originHead,
            ...(warning ? { warning: `fetch failed; using last known ${originHead}: ${warning}` } : {})
          }
        }
      }
      const branch = await workspaceGit(repo.root, [
        'symbolic-ref', '--quiet', '--short', 'HEAD'
      ], signal).then((out) => out.trim()).catch(() => '')
      if (!branch) {
        throw new Error('start_from_unresolved: detached HEAD and no origin/HEAD')
      }
      return {
        sha: (await workspaceGit(repo.root, ['rev-parse', `${branch}^{commit}`], signal)).trim(),
        ref: branch
      }
    }
    case 'branch': {
      await assertBranchName(repo.root, startFrom.name)
      const sha = await workspaceGit(repo.root, [
        'rev-parse', '--verify', `${startFrom.name}^{commit}`
      ], signal).then((out) => out.trim()).catch(() => '')
      if (!sha) throw new Error(`start_from_unresolved: unknown branch ${startFrom.name}`)
      return { sha, ref: startFrom.name }
    }
    case 'commit': {
      const sha = await workspaceGit(repo.root, [
        'rev-parse', '--verify', `${startFrom.sha}^{commit}`
      ], signal).then((out) => out.trim()).catch(() => '')
      if (!sha) throw new Error(`start_from_unresolved: unknown commit ${startFrom.sha}`)
      return { sha }
    }
    case 'remote-branch': {
      await assertRemoteName(repo.root, startFrom.remote)
      await assertBranchName(repo.root, startFrom.name)
      const failure = await fetchRemote(repo.root, startFrom.remote, [startFrom.name], options)
      if (failure) {
        throw new Error(`start_from_unresolved: fetch ${startFrom.remote}/${startFrom.name} failed: ${failure}`)
      }
      const sha = await workspaceGit(repo.root, [
        'rev-parse', '--verify', 'FETCH_HEAD^{commit}'
      ], signal).then((out) => out.trim()).catch(() => '')
      if (!sha) throw new Error('start_from_unresolved: FETCH_HEAD missing after fetch')
      return { sha, ref: `${startFrom.remote}/${startFrom.name}` }
    }
    case 'change-request':
      throw new Error('start_from_unsupported: change-request starts land in P2')
  }
}
