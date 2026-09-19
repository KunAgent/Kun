import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { RoomIdSchema } from '../contracts/rooms.js'
import { roomGit as git, ROOM_REVISION_HASH as HASH } from './room-git.js'

export type RoomRepositoryObservation = {
  root: string
  commonDir: string
  head: string
  branch: string
  dirty: boolean
  operationInProgress: boolean
}

export async function observeRoomRepository(path: string, allowDetached = false): Promise<RoomRepositoryObservation> {
  const root = await realpath(await git(path, ['rev-parse', '--show-toplevel']))
  const [commonDir, head, branch, status] = await Promise.all([
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(root, ['rev-parse', '--verify', 'HEAD']),
    git(root, ['symbolic-ref', '--quiet', 'HEAD']).catch((error: unknown) => {
      if (allowDetached && (error as { code?: number }).code === 1) return ''
      throw error
    }),
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
  const source = await observeRoomRepository(input.repository.root)
  if (source.root !== input.repository.root || source.commonDir !== input.repository.commonDir ||
    source.branch !== input.repository.branch) {
    throw new Error('repository identity changed; preserve for recovery')
  }
  if (source.operationInProgress) throw new Error('repository has an unfinished Git operation')
  await git(source.root, ['cat-file', '-e', `${input.repository.head}^{commit}`])
  const branch = `codex/rooms/${input.taskId}`
  await git(input.repository.root, ['worktree', 'add', '-b', branch, '--',
    input.destination, input.repository.head])
  // If this verification fails, retain the worktree rather than deleting work
  // whose ownership or creation result is uncertain.
  const path = await realpath(input.destination)
  const created = await observeRoomRepository(path)
  if (created.head !== input.repository.head || created.commonDir !== input.repository.commonDir ||
    created.root !== path || created.branch !== `refs/heads/${branch}`) {
    throw new Error('worktree baseline mismatch; preserve for recovery')
  }
  return { path, branch, baseRevision: created.head }
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
