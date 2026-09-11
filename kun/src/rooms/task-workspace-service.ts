import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { RoomIdSchema } from '../contracts/rooms.js'

const exec = promisify(execFile)
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export type RoomRepositoryObservation = {
  root: string
  commonDir: string
  head: string
  branch: string
  dirty: boolean
  operationInProgress: boolean
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  })
  return result.stdout.trim()
}

export async function observeRoomRepository(path: string): Promise<RoomRepositoryObservation> {
  const root = await realpath(await git(path, ['rev-parse', '--show-toplevel']))
  const [commonDir, head, branch, status] = await Promise.all([
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(root, ['rev-parse', '--verify', 'HEAD']),
    git(root, ['symbolic-ref', '--quiet', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ])
  if (!HASH.test(head)) throw new Error('repository has no valid committed baseline')
  const inProgress = await Promise.all(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
    .map(async (ref) => {
      try { await git(root, ['rev-parse', '--verify', ref]); return true } catch { return false }
    }))
  // Git's status reports rebase state even while no conflict files are present.
  const { access } = await import('node:fs/promises')
  for (const name of ['rebase-merge', 'rebase-apply', 'sequencer']) {
    const statePath = await git(root, ['rev-parse', '--path-format=absolute', '--git-path', name])
    try { await access(statePath); inProgress.push(true) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return { root, commonDir: await realpath(commonDir), head, branch,
    dirty: status.length > 0, operationInProgress: inProgress.some(Boolean) }
}

/** Creates only from the pinned committed revision, never from source dirty files. */
export async function createRoomTaskWorktree(input: {
  repository: RoomRepositoryObservation
  taskId: string
  destination: string
  assertOwnership: () => Promise<void>
}): Promise<{ path: string; branch: string; baseRevision: string }> {
  RoomIdSchema.parse(input.taskId)
  if (!isAbsolute(input.destination) || !isAbsolute(input.repository.root)) {
    throw new Error('worktree destination and repository must be absolute paths')
  }
  if (!HASH.test(input.repository.head)) throw new Error('invalid baseline')
  await input.assertOwnership()
  const branch = `codex/rooms/${input.taskId}`
  await git(input.repository.root, ['worktree', 'add', '-b', branch, '--',
    input.destination, input.repository.head])
  // If this verification fails, retain the worktree rather than deleting work
  // whose ownership or creation result is uncertain.
  const path = await realpath(input.destination)
  const head = await git(path, ['rev-parse', '--verify', 'HEAD'])
  if (head !== input.repository.head) throw new Error('worktree baseline mismatch; preserve for recovery')
  return { path, branch, baseRevision: head }
}

/** Fail-closed preflight; it performs no writes, checkout, stash, or merge. */
export function assertRoomApplyPreflight(
  observed: RoomRepositoryObservation,
  expected: Pick<RoomRepositoryObservation, 'root' | 'commonDir' | 'branch' | 'head'>
): void {
  if (observed.root !== expected.root || observed.commonDir !== expected.commonDir ||
    observed.branch !== expected.branch || observed.head !== expected.head) {
    throw new Error('application target changed; repeat preview')
  }
  if (observed.dirty) throw new Error('application target has uncommitted changes')
  if (observed.operationInProgress) throw new Error('application target has an unfinished Git operation')
}
