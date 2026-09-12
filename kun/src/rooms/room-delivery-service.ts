import { isAbsolute } from 'node:path'
import { realpath } from 'node:fs/promises'
import { RoomIdSchema } from '../contracts/rooms.js'
import { RoomDeliverySchema, type RoomDelivery } from '../contracts/room-deliveries.js'
import { assertRoomApplyPreflight, observeRoomRepository,
  type RoomRepositoryObservation } from './task-workspace-service.js'
import { assertRoomAncestor, roomGit, runRoomGit, ROOM_REVISION_HASH } from './room-git.js'

type Ownership = { assertOwnership: () => Promise<void> }
type Repository = { repository: RoomRepositoryObservation }
type Target = Pick<RoomRepositoryObservation, 'root' | 'commonDir' | 'branch' | 'head'>
type Workspace = Repository & {
  taskId: string
  workspacePath: string
  workspaceBranch: string
  baseRevision: string
}

// Serialize local mutations. The ownership callback must also fence the Runtime's
// persisted task lease; this map is deliberately not a substitute for that lease.
const mutations = new Map<string, Promise<void>>()
async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutations.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  mutations.set(key, current)
  await previous
  try { return await operation() } finally {
    release()
    if (mutations.get(key) === current) mutations.delete(key)
  }
}

async function assertRepositoryIdentity(repository: RoomRepositoryObservation): Promise<void> {
  if (!isAbsolute(repository.root) || !isAbsolute(repository.commonDir)) throw new Error('absolute repository paths required')
  const observed = await observeRoomRepository(repository.root, true)
  if (observed.root !== repository.root || observed.commonDir !== repository.commonDir) {
    throw new Error('repository identity changed; preserve for recovery')
  }
}

export async function assertRoomTaskWorkspace(input: Workspace): Promise<RoomRepositoryObservation> {
  RoomIdSchema.parse(input.taskId)
  if (!isAbsolute(input.workspacePath) || !ROOM_REVISION_HASH.test(input.baseRevision)) {
    throw new Error('absolute workspace path and valid baseline required')
  }
  const expectedBranch = `codex/rooms/${input.taskId}`
  if (input.workspaceBranch !== expectedBranch) throw new Error('task branch does not belong to this task')
  await assertRepositoryIdentity(input.repository)
  const workspace = await observeRoomRepository(input.workspacePath)
  if (workspace.root !== await realpath(input.workspacePath) || workspace.root === input.repository.root ||
    workspace.commonDir !== input.repository.commonDir || workspace.branch !== `refs/heads/${expectedBranch}`) {
    throw new Error('task workspace identity changed; preserve for recovery')
  }
  if (workspace.operationInProgress) throw new Error('task workspace has an unfinished Git operation')
  await assertRoomAncestor(workspace.root, input.baseRevision, workspace.head)
  return workspace
}

async function readPin(repositoryRoot: string, pinRef: string): Promise<string | undefined> {
  // --quiet returns exit 1 exclusively for a missing ref; other errors fail closed.
  try { return await roomGit(repositoryRoot, ['rev-parse', '--verify', '--quiet', pinRef]) } catch (error) {
    if ((error as { code?: number }).code === 1) return undefined
    throw error
  }
}

export async function assertRoomDeliveryPin(repository: RoomRepositoryObservation, delivery: RoomDelivery): Promise<void> {
  RoomDeliverySchema.parse(delivery)
  if (delivery.pinRef !== `refs/kun/rooms/${delivery.taskId}/${delivery.id}`) throw new Error('delivery pin ownership mismatch')
  await assertRepositoryIdentity(repository)
  if (await readPin(repository.root, delivery.pinRef) !== delivery.versionHash) {
    throw new Error('immutable delivery pin changed or is missing; preserve for recovery')
  }
  await assertRoomAncestor(repository.root, delivery.baseRevision, delivery.versionHash)
}

export type CreateRoomDeliveryInput = Workspace & Ownership & {
  id: string
  attemptId: string
  version: number
  summary: string
  incomplete?: RoomDelivery['incomplete']
  verification?: RoomDelivery['verification']
  createdAt?: string
  /** Must persist exactly once or verify identical content for an existing id. */
  persistDiff: (id: string, diff: string) => Promise<void>
}

/** Called only after the task executor has confirmed it stopped writing. */
export async function createRoomDelivery(input: CreateRoomDeliveryInput): Promise<RoomDelivery> {
  // Validate public metadata before staging files or creating an immutable ref.
  RoomDeliverySchema.parse({ id: input.id, taskId: input.taskId, attemptId: input.attemptId,
    version: input.version, baseRevision: input.baseRevision, summary: input.summary,
    pinRef: `refs/kun/rooms/${input.taskId}/${input.id}`, versionHash: input.baseRevision,
    changedFiles: [], diffArtifactId: input.id, incomplete: input.incomplete ?? [],
    verification: input.verification ?? [], createdAt: input.createdAt ?? new Date().toISOString() })
  return serialize(input.repository.commonDir, async () => {
    await input.assertOwnership()
    const workspace = await assertRoomTaskWorkspace(input)
    const pinRef = `refs/kun/rooms/${input.taskId}/${input.id}`
    let versionHash = await readPin(workspace.root, pinRef)
    if (!versionHash) {
      if (workspace.dirty) {
        await input.assertOwnership()
        await assertRoomTaskWorkspace(input)
        // Only this task's isolated worktree is staged. Source checkout files,
        // index, branch and untracked files are never manipulated here.
        await roomGit(workspace.root, ['add', '--all', '--', '.'])
        const staged = await runRoomGit(workspace.root, ['diff', '--cached', '--name-only', '-z'])
        if (staged.length > 0) {
          await input.assertOwnership()
          await roomGit(workspace.root, ['-c', 'user.name=Kun Rooms', '-c', 'user.email=kun-rooms@localhost',
            'commit', '--no-verify', '-m', `feat(rooms): deliver ${input.taskId} v${input.version}`])
        }
      }
      const committed = await assertRoomTaskWorkspace(input)
      if (committed.dirty) throw new Error('task changed during delivery; preserve worktree and retry after execution stops')
      versionHash = committed.head
      await input.assertOwnership()
      await roomGit(workspace.root, ['update-ref', pinRef, versionHash, '0'.repeat(versionHash.length)])
    }
    await assertRoomAncestor(workspace.root, input.baseRevision, versionHash)
    const changedFiles = (await runRoomGit(workspace.root,
      ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', input.baseRevision, versionHash, '--']))
      .split('\0').filter(Boolean)
    const delivery = RoomDeliverySchema.parse({
      id: input.id, taskId: input.taskId, attemptId: input.attemptId, version: input.version,
      baseRevision: input.baseRevision, versionHash, pinRef, changedFiles, diffArtifactId: input.id,
      summary: input.summary, incomplete: input.incomplete ?? [], verification: input.verification ?? [],
      createdAt: input.createdAt ?? new Date().toISOString()
    })
    const diff = await runRoomGit(workspace.root,
      ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index', input.baseRevision, versionHash, '--'])
    await input.assertOwnership()
    await input.persistDiff(delivery.diffArtifactId, diff)
    return delivery
  })
}

/** Tool execution for this detached snapshot must separately enforce read-only policy. */
export async function prepareRoomReviewWorktree(input: Repository & Ownership & {
  delivery: RoomDelivery
  destination: string
}): Promise<{ path: string; versionHash: string }> {
  if (!isAbsolute(input.destination)) throw new Error('absolute review destination required')
  return serialize(input.repository.commonDir, async () => {
    await input.assertOwnership()
    await assertRoomDeliveryPin(input.repository, input.delivery)
    let existing: string | undefined
    try { existing = await realpath(input.destination) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!existing) {
      await roomGit(input.repository.root, ['worktree', 'add', '--detach', '--',
        input.destination, input.delivery.versionHash])
    }
    const path = await realpath(input.destination)
    const review = await observeRoomRepository(path, true)
    if (review.root !== path || review.root === input.repository.root ||
      review.commonDir !== input.repository.commonDir || review.branch !== '' ||
      review.head !== input.delivery.versionHash || review.dirty || review.operationInProgress) {
      throw new Error('review snapshot identity mismatch; preserve for recovery')
    }
    return { path, versionHash: review.head }
  })
}

/** Explicit user action only. Never rebases, switches branches, stashes, or cleans. */
export async function applyRoomDelivery(input: Repository & Ownership & {
  delivery: RoomDelivery
  expectedTarget: Target
}): Promise<{ head: string; alreadyApplied: boolean }> {
  return serialize(input.repository.commonDir, async () => {
    await input.assertOwnership()
    await assertRoomDeliveryPin(input.repository, input.delivery)
    if (input.expectedTarget.root !== input.repository.root ||
      input.expectedTarget.commonDir !== input.repository.commonDir ||
      input.expectedTarget.branch !== input.repository.branch) throw new Error('application target ownership mismatch')
    let observed = await observeRoomRepository(input.repository.root)
    if (observed.head === input.delivery.versionHash) {
      assertRoomApplyPreflight(observed, { ...input.expectedTarget, head: observed.head })
      return { head: observed.head, alreadyApplied: true }
    }
    assertRoomApplyPreflight(observed, input.expectedTarget)
    await assertRoomAncestor(observed.root, observed.head, input.delivery.versionHash)
    await input.assertOwnership()
    observed = await observeRoomRepository(input.repository.root)
    assertRoomApplyPreflight(observed, input.expectedTarget)
    await roomGit(observed.root, ['merge', '--ff-only', '--no-edit', '--no-stat', '--', input.delivery.versionHash])
    const after = await observeRoomRepository(observed.root)
    assertRoomApplyPreflight(after, { ...input.expectedTarget, head: input.delivery.versionHash })
    return { head: after.head, alreadyApplied: false }
  })
}

/** Bring a completed prerequisite into this task's isolated branch, never the source checkout. */
export async function materializeRoomDependency(input: Workspace & Ownership & {
  delivery: RoomDelivery
}): Promise<void> {
  await serialize(input.repository.commonDir, async () => {
    await input.assertOwnership()
    await assertRoomDeliveryPin(input.repository, input.delivery)
    const workspace = await assertRoomTaskWorkspace(input)
    if (workspace.dirty) throw new Error('dependency handoff requires a clean task worktree; preserve for recovery')
    try {
      await assertRoomAncestor(workspace.root, input.delivery.versionHash, workspace.head)
      return
    } catch { /* A newer prerequisite must fast-forward the isolated branch. */ }
    await assertRoomAncestor(workspace.root, workspace.head, input.delivery.versionHash)
    await input.assertOwnership()
    await roomGit(workspace.root, ['merge', '--ff-only', '--no-edit', '--no-stat', '--', input.delivery.versionHash])
    const after = await assertRoomTaskWorkspace(input)
    if (after.head !== input.delivery.versionHash || after.dirty) {
      throw new Error('dependency handoff changed unexpectedly; preserve worktree for recovery')
    }
  })
}
