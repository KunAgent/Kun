import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomMemberSchema } from '../contracts/rooms.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { roomTaskAction } from './room-task-actions.js'
import { createRoomDelivery } from './room-delivery-service.js'
import { createRoomTaskWorktree, observeRoomRepository } from './task-workspace-service.js'
import { roomGit } from './room-git.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-action-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const member = RoomMemberSchema.parse({ id: 'developer', displayName: 'Developer', presetId: 'developer',
    role: 'developer', allowedRepositoryIds: ['repository'], revision: 0 })
  const execution: RoomTaskExecution = { task: { id: 'task-a', roomId: 'room-a', requestId: 'request-a',
    sourceMessageId: 'message-a', title: 'Task A', ownerMemberId: member.id, memberSnapshot: member,
    repositoryId: 'repository', workspaceId: 'workspace-a', executionThreadId: 'execution-a', status: 'queued',
    stage: 'develop', requirementRevision: 0, revision: 0, latestProgress: '', verificationStatus: 'not_run',
    applicationStatus: 'not_applied', updatedAt: new Date().toISOString() }, prompt: 'Task A',
    attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null }
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), dataDir: root,
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: () => store.assertOwnership() }
  const save = async () => {
    const previous = await store.get('task', execution.task.id)
    await store.commit({ requestId: `task-fixture-${previous?.revision ?? 'initial'}`,
      checks: [{ kind: 'task', id: execution.task.id, expectedRevision: previous?.revision ?? null }],
      puts: [{ kind: 'task', id: execution.task.id, roomId: 'room-a', taskId: execution.task.id, value: execution }] })
  }
  const current = async () => (await store.get<RoomTaskExecution>('task', execution.task.id))!
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, h, execution, deps, save, current,
    action: (action: string, clientRequestId: string, expectedRevision: number) =>
      roomTaskAction(deps, 'room-a', execution.task.id, action, { clientRequestId, expectedRevision }) }
}

async function delivered() {
  const f = await fixture()
  const source = join(f.root, 'source project')
  await mkdir(source)
  await roomGit(source, ['init', '-b', 'develop'])
  await roomGit(source, ['config', 'user.name', 'Test'])
  await roomGit(source, ['config', 'user.email', 'test@example.invalid'])
  await writeFile(join(source, 'source.txt'), 'baseline\n')
  await roomGit(source, ['add', '.'])
  await roomGit(source, ['commit', '-m', 'baseline'])
  const repository = await observeRoomRepository(source)
  const worktree = await createRoomTaskWorktree({ repository, taskId: 'task-a', destination: join(f.root, 'worktree'),
    assertOwnership: f.deps.assertOwnership })
  await writeFile(join(worktree.path, 'source.txt'), 'delivery\n')
  const delivery = await createRoomDelivery({ repository, taskId: 'task-a', workspacePath: worktree.path,
    workspaceBranch: worktree.branch, baseRevision: worktree.baseRevision, id: 'delivery-a', attemptId: 'attempt-a',
    version: 1, summary: 'Delivery', assertOwnership: f.deps.assertOwnership, persistDiff: async () => {} })
  const workspace: RoomWorkspace = { id: 'workspace-a', roomId: 'room-a', taskId: 'task-a',
    ...worktree, repository, state: 'ready' }
  await f.store.commit({ requestId: 'delivery-fixture', checks: [
    { kind: 'delivery', id: delivery.id, expectedRevision: null }, { kind: 'workspace', id: workspace.id, expectedRevision: null }],
    puts: [{ kind: 'delivery', id: delivery.id, roomId: 'room-a', taskId: 'task-a', value: delivery },
      { kind: 'workspace', id: workspace.id, roomId: 'room-a', taskId: 'task-a', value: workspace }] })
  f.execution.task.latestDeliveryId = delivery.id
  f.execution.task.status = 'awaiting_acceptance'
  await f.save()
  return { ...f, source, delivery, workspace }
}

describe('durable room task user actions', () => {
  it('persists stopping before queued cancellation and repeats the signal after an interrupted response', async () => {
    const f = await fixture()
    await f.h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent' }, { id: 'execution-a' })
    const turn = await f.h.turns.enqueueTurn({ threadId: 'execution-a', request: { prompt: 'queued', clientRequestId: 'task-a-attempt-1' } })
    await f.save()
    const signal = vi.spyOn(f.h.turns, 'cancelQueuedTurn').mockImplementationOnce(async () => {
      expect((await f.current()).value.task.status).toBe('stopping')
      throw new Error('crash before cancellation signal')
    })
    await expect(f.action('cancel', 'cancel-once', 0)).rejects.toThrow('crash before cancellation')
    expect((await f.current()).value.turnId).toBe(turn.turnId)
    signal.mockRestore()
    await f.action('cancel', 'cancel-once', 0)
    expect((await f.h.threads.getMetadata('execution-a'))!.turns.find((entry) => entry.id === turn.turnId)?.status).toBe('aborted')
  })

  it('requires actual stopped execution before retry and invalidates the previous delivery selection', async () => {
    const f = await fixture()
    await f.h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent' }, { id: 'execution-a' })
    const turn = await f.h.turns.enqueueTurn({ threadId: 'execution-a', request: { prompt: 'queued' } })
    f.execution.task.status = 'failed'
    f.execution.task.latestDeliveryId = 'old-delivery'
    f.execution.task.acceptedDeliveryId = 'old-delivery'
    f.execution.task.applicationStatus = 'applied'
    f.execution.turnId = turn.turnId
    await f.save()
    await expect(f.action('retry', 'retry-once', 0)).rejects.toThrow('existing execution')
    await f.h.turns.cancelQueuedTurn({ threadId: 'execution-a', turnId: turn.turnId })
    await f.action('retry', 'retry-once', 0)
    expect((await f.current()).value).toMatchObject({ attempt: 2, task: { stage: 'fix', status: 'queued', applicationStatus: 'not_applied' } })
    expect((await f.current()).value.task.latestDeliveryId).toBeUndefined()
    expect((await f.current()).value.task.acceptedDeliveryId).toBeUndefined()
  })

  it('checks acceptance revision and allocates a new review thread for each explicit review request', async () => {
    const f = await delivered()
    f.execution.reviewer = { ...f.execution.task.memberSnapshot, id: 'reviewer', role: 'reviewer' }
    await f.save()
    await expect(f.action('accept', 'stale-accept', 0)).rejects.toThrow('task changed')
    await f.action('accept', 'accept', 1)
    expect((await f.current()).value.task.acceptedDeliveryId).toBe(f.delivery.id)
    await f.action('review', 'review-first', 2)
    const first = (await f.current()).value.reviewThreadId
    await f.action('review', 'review-first', 2)
    expect((await f.current()).value.reviewThreadId).toBe(first)
    const next = await f.current()
    next.value.task.status = 'awaiting_acceptance'
    await f.store.commit({ requestId: 'review-completed', checks: [{ kind: 'task', id: 'task-a', expectedRevision: next.revision }],
      puts: [{ kind: 'task', id: 'task-a', roomId: 'room-a', taskId: 'task-a', value: next.value }] })
    await f.action('review', 'review-second', next.revision + 1)
    expect((await f.current()).value.reviewThreadId).not.toBe(first)
  })

  it('persists a dirty-source conflict, preserves source files, and allows a refreshed new apply request', async () => {
    const f = await delivered()
    await writeFile(join(f.source, 'local.txt'), 'user work\n')
    await expect(f.action('apply', 'apply-first', 0)).rejects.toThrow('uncommitted')
    expect((await f.current()).value.task.applicationStatus).toBe('conflict')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('baseline\n')
    expect(await readFile(join(f.source, 'local.txt'), 'utf8')).toBe('user work\n')
    await rm(join(f.source, 'local.txt'))
    await expect(f.action('apply', 'apply-first', 0)).rejects.toThrow('uncommitted')
    await f.action('apply', 'apply-refreshed', (await f.current()).revision)
    expect((await f.current()).value.task.applicationStatus).toBe('applied')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('delivery\n')
  })

  it('recovers an already merged immutable SHA when the final application receipt was not saved', async () => {
    const f = await delivered()
    const commit = f.store.commit.bind(f.store)
    const failure = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.requestId.startsWith('action:')) throw new Error('disk unavailable after merge')
      return commit(input)
    })
    await expect(f.action('apply', 'apply-ambiguous', 0)).rejects.toThrow('disk unavailable')
    expect((await f.current()).value.task.applicationStatus).toBe('applying')
    expect((await observeRoomRepository(f.source)).head).toBe(f.delivery.versionHash)
    failure.mockRestore()
    await f.action('apply', 'apply-ambiguous', 0)
    expect((await f.current()).value.task.applicationStatus).toBe('applied')
    expect(await f.store.list('attempt', { taskId: 'task-a' })).toHaveLength(1)
  })
})
