import { access, mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomIntegration } from '../contracts/rooms-product.js'
import type { RoomRuntimeDeps, RoomWorkspace } from './room-runtime-types.js'
import { roomGit, runRoomGit, assertRoomAncestor, serializeRoomGitMutation } from './room-git.js'
import { observeRoomRepository } from './task-workspace-service.js'

export function integrationDelivery(value: RoomIntegration, original: RoomDelivery): RoomDelivery {
  if (!value.candidateSha || !value.candidatePinId) throw new Error('integration candidate is missing')
  return { ...original, id: value.candidatePinId, versionHash: value.candidateSha,
    baseRevision: value.targetSha, pinRef: `refs/kun/rooms/${value.taskId}/${value.candidatePinId}` }
}

export async function assertIntegrationWorkspace(deps: RoomRuntimeDeps, value: RoomIntegration,
  workspace: RoomWorkspace) {
  const expected = join(deps.dataDir, 'rooms', 'integrations', value.id)
  if (resolve(value.path) !== resolve(expected) || value.branch !== 'codex/room-integration/' + value.id) {
    throw new Error('integration workspace ownership mismatch')
  }
  const path = await realpath(value.path)
  // Do not follow a replaced worktree root or parent symlink into another directory.
  if (path !== join(await realpath(dirname(expected)), value.id)) throw new Error('integration path changed')
  const observed = await observeRoomRepository(path)
  if (observed.root !== path || path === workspace.repository.root ||
    observed.commonDir !== workspace.repository.commonDir || observed.branch !== 'refs/heads/' + value.branch) {
    throw new Error('integration workspace identity mismatch')
  }
  return observed
}

/** A merge failure without conflicts is a failure, never a candidate made from target alone. */
export async function prepareIntegrationGit(deps: RoomRuntimeDeps, value: RoomIntegration,
  workspace: RoomWorkspace): Promise<void> {
  await serializeRoomGitMutation(workspace.repository.commonDir, async () => {
    await deps.assertOwnership()
    await mkdir(dirname(value.path), { recursive: true })
    let present = false
    try { await access(value.path); present = true } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!present) {
      let branchExists = false
      try { await roomGit(workspace.repository.root, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + value.branch]); branchExists = true }
      catch (error) { if ((error as { code?: number }).code !== 1) throw error }
      await deps.assertOwnership()
      await roomGit(workspace.repository.root, ['worktree', 'add', ...(branchExists ? [] : ['-b', value.branch]),
        '--', value.path, branchExists ? value.branch : value.targetSha])
    }
    const observed = await assertIntegrationWorkspace(deps, value, workspace)
    if (observed.head === value.targetSha && !observed.operationInProgress && !observed.dirty) {
      await deps.assertOwnership()
      try {
        await roomGit(value.path, ['-c', 'user.name=Kun Rooms', '-c', 'user.email=kun-rooms@localhost',
          'merge', '--no-ff', '--no-commit', '--no-edit', '--', value.sourceSha])
      } catch (error) {
        const conflicts = await roomGit(value.path, ['diff', '--name-only', '--diff-filter=U'])
        if (!conflicts.trim()) throw error
      }
    }
    value.conflicts = (await runRoomGit(value.path, ['diff', '--name-only', '-z', '--diff-filter=U']))
      .split('\0').filter(Boolean)
  })
}

export async function freezeIntegrationCandidate(deps: RoomRuntimeDeps, value: RoomIntegration,
  workspace: RoomWorkspace): Promise<void> {
  await serializeRoomGitMutation(workspace.repository.commonDir, async () => {
    await deps.assertOwnership()
    const observed = await assertIntegrationWorkspace(deps, value, workspace)
    if ((await roomGit(value.path, ['diff', '--name-only', '--diff-filter=U'])).trim()) {
      throw new Error('unresolved integration conflicts')
    }
    await assertRoomAncestor(value.path, value.targetSha, observed.head)
    if (observed.operationInProgress) {
      // Only the merge we prepared can be finalized. A rebase or unrelated merge is retained.
      const mergeHead = await roomGit(value.path, ['rev-parse', '--verify', 'MERGE_HEAD'])
      if (mergeHead !== value.sourceSha) throw new Error('unexpected integration Git operation')
    } else {
      await assertRoomAncestor(value.path, value.sourceSha, observed.head)
    }
    if (observed.dirty || observed.operationInProgress) {
      await deps.assertOwnership()
      await roomGit(value.path, ['add', '--all', '--', '.'])
      const staged = await roomGit(value.path, ['diff', '--cached', '--name-only'])
      if (staged || observed.operationInProgress) {
        await deps.assertOwnership()
        await roomGit(value.path, ['-c', 'user.name=Kun Rooms', '-c', 'user.email=kun-rooms@localhost',
          'commit', '--no-verify', '-m', 'Integrate room delivery ' + value.deliveryId])
      }
    }
    const after = await assertIntegrationWorkspace(deps, value, workspace)
    if (after.dirty || after.operationInProgress) throw new Error('integration changed while freezing candidate')
    await assertRoomAncestor(value.path, value.sourceSha, after.head)
    await assertRoomAncestor(value.path, value.targetSha, after.head)
    const candidatePinId = value.id + '-' + after.head
    const pin = `refs/kun/rooms/${value.taskId}/${candidatePinId}`
    let pinned: string | undefined
    try { pinned = await roomGit(value.path, ['rev-parse', '--verify', '--quiet', pin]) }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error }
    if (pinned && pinned !== after.head) throw new Error('immutable candidate pin changed')
    if (!pinned) {
      await deps.assertOwnership()
      await roomGit(value.path, ['update-ref', pin, after.head, '0'.repeat(after.head.length)])
    }
    const diff = await runRoomGit(value.path, ['diff', '--no-ext-diff', '--no-textconv', '--binary',
      '--full-index', value.targetSha, after.head, '--'])
    if (value.candidateSha !== after.head) {
      value.validation = []
      value.validationVersionHash = undefined
      value.review = undefined
    }
    value.candidateSha = after.head
    value.candidatePinId = candidatePinId
    value.diff = diff
    if (!value.candidates?.some((candidate) => candidate.sha === after.head)) {
      value.candidates = [...(value.candidates ?? []), { sha: after.head, pinId: candidatePinId,
        targetSha: value.targetSha, createdAt: new Date().toISOString(), diff }]
    }
    value.conflicts = []
  })
}
