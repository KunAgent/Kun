import { access, readFile, writeFile, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { productGitFixture } from '../../tests/room-product-git-test-fixture.js'
import { cleanupRoomTask, roomCleanupPreview } from './room-cleanup.js'
import { prepareRoomReviewWorktree, applyRoomDelivery } from './room-delivery-service.js'
import { roomGit } from './room-git.js'
import type { RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { RoomTaskRunner } from './room-task-runner.js'
import { RoomService } from './room-service.js'

const fixtures: Awaited<ReturnType<typeof productGitFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture() { const f = await productGitFixture(); fixtures.push(f); return f }
async function taskUpdate(f: Awaited<ReturnType<typeof fixture>>, update: Partial<RoomTaskExecution>) {
  const row = (await f.store.get<RoomTaskExecution>('task', f.taskId))!
  await f.store.commit({ requestId: 'update-' + row.revision, checks: [{ kind: 'task', id: f.taskId, expectedRevision: row.revision }],
    puts: [{ kind: 'task', id: f.taskId, roomId: f.roomId, taskId: f.taskId, value: { ...row.value, ...update } }] })
}
async function apply(f: Awaited<ReturnType<typeof fixture>>) {
  await applyRoomDelivery({ repository: f.repository, delivery: f.delivery, expectedTarget: f.repository, assertOwnership: f.deps.assertOwnership })
  await taskUpdate(f, { task: { ...f.execution.task, applicationStatus: 'applied' } })
}

describe('room worktree cleanup safety and recovery', () => {
  it('preserves unaccepted or merely cancelled work; explicit abandonment allows clean artifacts', async () => {
    const f = await fixture()
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: false })
    await taskUpdate(f, { task: { ...f.execution.task, status: 'cancelled' } })
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: false })
    await taskUpdate(f, { abandoned: true })
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: true })
  })

  it('cleans only managed directories and restores the retained task branch on continuation', async () => {
    const f = await fixture()
    await apply(f)
    const reviewPath = join(f.deps.dataDir, 'rooms', 'reviews', f.delivery.id)
    await mkdir(join(f.deps.dataDir, 'rooms', 'reviews'), { recursive: true })
    await prepareRoomReviewWorktree({ repository: f.repository, delivery: f.delivery,
      destination: reviewPath, assertOwnership: f.deps.assertOwnership })
    await writeFile(join(f.source, 'personal.txt'), 'source stays untouched\n')
    const preview = await roomCleanupPreview(f.deps, f.roomId, f.taskId)
    expect(preview.paths).toHaveLength(2)
    const input = { clientRequestId: 'cleanup_one', expectedRevision: preview.revision, token: preview.token }
    const result = await cleanupRoomTask(f.deps, f.roomId, f.taskId, input)
    expect(await cleanupRoomTask(f.deps, f.roomId, f.taskId, input)).toEqual(result)
    await expect(access(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(reviewPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.source, 'personal.txt'), 'utf8')).toBe('source stays untouched\n')
    expect(await roomGit(f.source, ['rev-parse', f.delivery.pinRef])).toBe(f.delivery.versionHash)
    expect(await roomGit(f.source, ['rev-parse', 'refs/heads/' + f.workspace.branch])).toBe(f.delivery.versionHash)
    await taskUpdate(f, { task: { ...f.execution.task, status: 'queued', latestDeliveryId: undefined,
      acceptedDeliveryId: undefined, applicationStatus: 'not_applied' }, attempt: 2, turnId: undefined })
    const runner = new RoomTaskRunner(f.deps, new RoomService(f.store, () => {}))
    await runner.tick((await f.store.get<RoomTaskExecution>('task', f.taskId))!, true)
    expect(await roomGit(f.workspace.path, ['rev-parse', 'HEAD'])).toBe(f.delivery.versionHash)
    expect(await readFile(join(f.workspace.path, 'source.txt'), 'utf8')).toBe('delivered\n')
    expect(await readFile(join(f.source, 'personal.txt'), 'utf8')).toBe('source stays untouched\n')
  }, 20000)

  it('resumes after Git removal succeeds but persisting the progress fails', async () => {
    const f = await fixture()
    await apply(f)
    const preview = await roomCleanupPreview(f.deps, f.roomId, f.taskId)
    const input = { clientRequestId: 'cleanup_interrupted', expectedRevision: preview.revision, token: preview.token }
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (fail && input.requestId.includes('-removed-')) { fail = false; throw new Error('storage disconnected') }
      return commit(input)
    })
    await expect(cleanupRoomTask(f.deps, f.roomId, f.taskId, input)).rejects.toThrow('storage disconnected')
    await expect(access(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' })
    const refreshed = await roomCleanupPreview(f.deps, f.roomId, f.taskId)
    expect(await cleanupRoomTask(f.deps, f.roomId, f.taskId, { clientRequestId: 'fresh-cleanup-click',
      expectedRevision: refreshed.revision, token: refreshed.token })).toMatchObject({ taskId: f.taskId, eligible: true })
    expect(await cleanupRoomTask(f.deps, f.roomId, f.taskId, input)).toMatchObject({ taskId: f.taskId, eligible: true })
    expect(await f.store.list('cleanup', { status: 'removing' })).toHaveLength(0)
    expect(await roomGit(f.source, ['rev-parse', f.delivery.pinRef])).toBe(f.delivery.versionHash)
  })

  it('rejects stale previews and dirty managed files without deleting anything', async () => {
    const f = await fixture()
    await apply(f)
    const preview = await roomCleanupPreview(f.deps, f.roomId, f.taskId)
    await writeFile(join(f.workspace.path, 'notes.txt'), 'uncommitted artifact\n')
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: false })
    await expect(cleanupRoomTask(f.deps, f.roomId, f.taskId, {
      clientRequestId: 'cleanup_dirty', token: preview.token, expectedRevision: preview.revision })).rejects.toThrow('uncommitted')
    expect(await readFile(join(f.workspace.path, 'notes.txt'), 'utf8')).toBe('uncommitted artifact\n')
  })

  it('preserves workspaces referenced by unfinished dependencies and in-progress discussions', async () => {
    const f = await fixture()
    await apply(f)
    await f.store.commit({ requestId: 'dependent', checks: [{ kind: 'task', id: 'dependent', expectedRevision: null }],
      puts: [{ kind: 'task', id: 'dependent', roomId: f.roomId, taskId: 'dependent', value: {
        ...f.execution, task: { ...f.execution.task, id: 'dependent', status: 'waiting_dependency' }, dependencyTaskIds: [f.taskId] } }] })
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: false, reason: expect.stringContaining('depends') })
    await f.store.commit({ requestId: 'complete-dependent', checks: [{ kind: 'task', id: 'dependent', expectedRevision: 0 }],
      puts: [{ kind: 'task', id: 'dependent', roomId: f.roomId, taskId: 'dependent', value: {
        ...f.execution, task: { ...f.execution.task, id: 'dependent', status: 'completed' }, dependencyTaskIds: [f.taskId] } }] })
    await f.store.commit({ requestId: 'discussion', checks: [{ kind: 'request', id: 'discussion', expectedRevision: null }],
      puts: [{ kind: 'request', id: 'discussion', roomId: f.roomId, value: { status: 'running', referencedTask: { task: f.execution.task } } }] })
    expect(await roomCleanupPreview(f.deps, f.roomId, f.taskId)).toMatchObject({ eligible: false, reason: expect.stringContaining('discussion') })
  })

  it('fails closed on corrupted source targets, symlinks and missing retention pins', async () => {
    const f = await fixture()
    await apply(f)
    const row = (await f.store.get<RoomWorkspace>('workspace', f.workspace.id))!
    await f.store.commit({ requestId: 'corrupt-source-target', checks: [{ kind: 'workspace', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'workspace', id: row.id, roomId: f.roomId, taskId: f.taskId, value: { ...row.value, path: f.source } }] })
    await expect(roomCleanupPreview(f.deps, f.roomId, f.taskId)).rejects.toThrow('outside managed')
    const linked = join(f.deps.dataDir, 'rooms', 'linked')
    await symlink(f.workspace.path, linked)
    await f.store.commit({ requestId: 'corrupt-symlink', checks: [{ kind: 'workspace', id: row.id, expectedRevision: row.revision + 1 }],
      puts: [{ kind: 'workspace', id: row.id, roomId: f.roomId, taskId: f.taskId, value: { ...row.value, path: linked } }] })
    await expect(roomCleanupPreview(f.deps, f.roomId, f.taskId)).rejects.toThrow('symlink')
    await roomGit(f.source, ['update-ref', '-d', f.delivery.pinRef])
    await expect(roomCleanupPreview(f.deps, f.roomId, f.taskId)).rejects.toThrow('pin changed or is missing')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('delivered\n')
  })
})
