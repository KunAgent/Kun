import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { type RoomDelivery, type RoomReview } from '../contracts/room-deliveries.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeAssistantTextItem } from '../domain/item.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService, putRoomDocument } from './room-service.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { RoomTaskRunner } from './room-task-runner.js'
import { observeRoomRepository, createRoomTaskWorktree } from './task-workspace-service.js'
import { createRoomDelivery } from './room-delivery-service.js'
import { ensureRoomThread } from './room-execution.js'

const exec = promisify(execFile)
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-runner-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const git = (...args: string[]) => exec('git', args)
  await git('init', '-b', 'develop', source)
  await git('-C', source, 'config', 'user.name', 'Room Test')
  await git('-C', source, 'config', 'user.email', 'room@example.invalid')
  await writeFile(join(source, 'source.txt'), 'baseline\n')
  await git('-C', source, 'add', '.')
  await git('-C', source, 'commit', '-m', 'baseline')
  const repository = await observeRoomRepository(source)
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([{ kind: 'completed', stopReason: 'stop' }]))
  cleanup.push(async () => { await h.turns.interruptActiveTurns(); await store.close() })
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore, turns: h.turns,
    sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (threadId, turnId) => h.loop.runTurn(threadId, turnId), dataDir: join(root, 'data'),
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const service = new RoomService(store, () => {})
  const { room } = await service.create({ clientRequestId: 'create', name: 'Room',
    repositories: [{ id: 'repo', displayPath: source }] })
  const runner = new RoomTaskRunner(deps, service)
  async function save(execution: RoomTaskExecution) {
    const old = await store.get<RoomTaskExecution>('task', execution.task.id)
    await putRoomDocument(store, 'task', execution.task.id, room.id, execution, old, execution.task.id)
    return (await store.get<RoomTaskExecution>('task', execution.task.id))!
  }
  async function task(id: string, dependencies: string[] = [], ready = true) {
    const path = join(root, 'task-' + id)
    const workspace: RoomWorkspace = { id: 'workspace-' + id, roomId: room.id, taskId: id, path,
      branch: 'codex/rooms/' + id, baseRevision: repository.head, repository, state: ready ? 'ready' : 'reserved' }
    if (ready) await createRoomTaskWorktree({ repository, taskId: id, destination: path, assertOwnership: deps.assertOwnership })
    await putRoomDocument(store, 'workspace', workspace.id, room.id, workspace, null, id)
    const execution: RoomTaskExecution = { task: RoomTaskSchema.parse({ id, roomId: room.id,
      requestId: 'request-' + id, sourceMessageId: 'message-' + id, title: id, ownerMemberId: 'developer',
      memberSnapshot: room.members.find((member) => member.id === 'developer'), repositoryId: 'repo',
      workspaceId: workspace.id, executionThreadId: 'room-execution-' + id,
      status: dependencies.length ? 'waiting_dependency' : 'queued', stage: 'develop',
      requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() }),
      prompt: 'Implement ' + id, dependencyTaskIds: dependencies, attachmentIds: [], attempt: 1,
      reworkRounds: 0, configuration: null }
    await save(execution)
    return { execution, workspace }
  }
  async function deliver(execution: RoomTaskExecution, workspace: RoomWorkspace) {
    const id = 'delivery-' + execution.task.id + '-' + execution.attempt
    const delivery = await createRoomDelivery({ id, taskId: execution.task.id, attemptId: 'attempt-' + execution.attempt,
      version: execution.attempt, workspacePath: workspace.path, workspaceBranch: workspace.branch,
      repository, baseRevision: repository.head, summary: 'Delivered ' + execution.task.title,
      assertOwnership: deps.assertOwnership, persistDiff: async (id, value) =>
        putRoomDocument(store, 'artifact', id, room.id, value, await store.get('artifact', id), execution.task.id) })
    await putRoomDocument(store, 'delivery', id, room.id, delivery, null, execution.task.id)
    execution.task.latestDeliveryId = id
    execution.task.status = 'awaiting_acceptance'
    await save(execution)
    return delivery
  }
  async function reviewed(execution: RoomTaskExecution, runId: string, verdict: 'passed' | 'changes_requested') {
    const reviewer = execution.reviewer ?? room.members.find((member) => member.id === 'reviewer')!
    execution.reviewer = reviewer
    execution.reviewThreadId = runId
    execution.reviewTurnId = runId + '-turn'
    execution.task.stage = 'review'
    execution.task.status = 'running'
    const thread = await ensureRoomThread(deps, { id: runId, roomId: room.id, taskId: execution.task.id,
      member: reviewer, kind: 'review' })
    await h.threadStore.upsert({ ...thread, turns: [createTurnRecord({ id: execution.reviewTurnId,
      threadId: thread.id, prompt: 'Review', status: 'completed', clientRequestId: 'review-' + runId })] })
    await h.sessionStore.appendItem(thread.id, makeAssistantTextItem({ id: 'result-' + runId,
      threadId: thread.id, turnId: execution.reviewTurnId, status: 'completed', text: JSON.stringify({ verdict,
        findings: verdict === 'passed' ? [] : [{ severity: 'major', description: 'Repair the defect' }], limitations: [] }) }))
    return save(execution)
  }
  return { root, source, repository, room, store, h, deps, service, runner, task, save, deliver, reviewed }
}

describe('room dependency and review lifecycle', () => {
  it('freezes and materializes the predecessor version before dispatch, retaining source dirt and later parent repairs', async () => {
    const f = await fixture()
    const parent = await f.task('parent')
    await writeFile(join(parent.workspace.path, 'dependency.txt'), 'version one\n')
    const first = await f.deliver(parent.execution, parent.workspace)
    const child = await f.task('child', ['parent'], false)
    await writeFile(join(f.source, 'source.txt'), 'user dirty\n')
    await f.runner.tick((await f.store.get<RoomTaskExecution>('task', 'child'))!, true)
    parent.execution.attempt = 2
    await writeFile(join(parent.workspace.path, 'dependency.txt'), 'version two\n')
    await f.deliver(parent.execution, parent.workspace)
    await f.runner.tick((await f.store.get<RoomTaskExecution>('task', 'child'))!, true)
    expect(await readFile(join(child.workspace.path, 'dependency.txt'), 'utf8')).toBe('version one\n')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('user dirty\n')
    expect(await readFile(join(parent.workspace.path, 'dependency.txt'), 'utf8')).toBe('version two\n')
    const saved = (await f.store.get<RoomTaskExecution>('task', 'child'))!.value
    expect(saved.dependencyDeliveries?.[0].versionHash).toBe(first.versionHash)
    const thread = await f.h.threads.getMetadata(saved.task.executionThreadId)
    expect(thread?.turns[0].prompt).toContain(first.versionHash)
    expect((await observeRoomRepository(f.source)).head).toBe(f.repository.head)
  })

  it('processes a review verdict once, clears obsolete acceptance on repair, and stops after two authorized repairs', async () => {
    const f = await fixture()
    const value = await f.task('repair')
    const delivery = await f.deliver(value.execution, value.workspace)
    value.execution.task.acceptedDeliveryId = delivery.id
    value.execution.task.applicationStatus = 'applied'
    value.execution.task.memberSnapshot.reviewPolicy = {
      reviewerMemberId: 'reviewer', allowAutomaticRework: true, maxReworkRounds: 2 }
    await f.runner.tick(await f.reviewed(value.execution, 'review-first', 'changes_requested'), true)
    const repairing = (await f.store.get<RoomTaskExecution>('task', 'repair'))!.value
    expect(repairing).toMatchObject({ attempt: 2, reworkRounds: 1, task: { stage: 'fix', status: 'queued',
      applicationStatus: 'not_applied', verificationStatus: 'not_run' } })
    expect(repairing.task.latestDeliveryId).toBeUndefined()
    expect(repairing.task.acceptedDeliveryId).toBeUndefined()
    expect((await f.store.get<RoomDelivery>('delivery', delivery.id))?.value.versionHash).toBe(delivery.versionHash)
    repairing.reworkRounds = 2
    repairing.task.latestDeliveryId = delivery.id
    await f.runner.tick(await f.reviewed(repairing, 'review-limit', 'changes_requested'), true)
    const blocked = (await f.store.get<RoomTaskExecution>('task', 'repair'))!
    expect(blocked.value.task.status).toBe('needs_input')
    expect(blocked.value.reworkRounds).toBe(2)
    await f.runner.tick(blocked, true)
    expect((await f.store.get('task', 'repair'))?.revision).toBe(blocked.revision)
    expect(await f.store.list('review', { taskId: 'repair' })).toHaveLength(2)
  })

  it('retains divergent dependency branches for recovery instead of dispatching without prerequisite content', async () => {
    const f = await fixture()
    const first = await f.task('first')
    const second = await f.task('second')
    await writeFile(join(first.workspace.path, 'first.txt'), 'first branch\n')
    await writeFile(join(second.workspace.path, 'second.txt'), 'second branch\n')
    await f.deliver(first.execution, first.workspace)
    await f.deliver(second.execution, second.workspace)
    const child = await f.task('dependent', ['first', 'second'], false)
    await f.runner.tick((await f.store.get<RoomTaskExecution>('task', 'dependent'))!, true)
    const row = (await f.store.get<RoomTaskExecution>('task', 'dependent'))!
    let failure: unknown
    try { await f.runner.tick(row, true) } catch (error) { failure = error }
    expect(String(failure)).toContain('not a fast-forward')
    await f.runner.fail(row, failure)
    expect((await f.store.get<RoomTaskExecution>('task', 'dependent'))?.value.task.status).toBe('recovery_required')
    expect(await f.h.threads.getMetadata(child.execution.task.executionThreadId)).toBeNull()
    expect(await readFile(join(first.workspace.path, 'first.txt'), 'utf8')).toBe('first branch\n')
    expect(await readFile(join(second.workspace.path, 'second.txt'), 'utf8')).toBe('second branch\n')
    expect((await observeRoomRepository(f.source)).head).toBe(f.repository.head)
  })

  it('keeps separate reviews of the same delivery and stops at changes requested without automatic authorization', async () => {
    const f = await fixture()
    const value = await f.task('reviewed')
    const delivery = await f.deliver(value.execution, value.workspace)
    await f.runner.tick(await f.reviewed(value.execution, 'review-one', 'changes_requested'), true)
    const first = (await f.store.get<RoomTaskExecution>('task', 'reviewed'))!.value
    expect(first.task.status).toBe('needs_input')
    expect(first.attempt).toBe(1)
    first.reviewer = { ...first.reviewer!, id: 'reviewer-two' }
    await f.runner.tick(await f.reviewed(first, 'review-two', 'passed'), true)
    const done = (await f.store.get<RoomTaskExecution>('task', 'reviewed'))!
    expect(done.value.task.status).toBe('awaiting_acceptance')
    const reviews = await f.store.list<RoomReview>('review', { taskId: 'reviewed' })
    expect(reviews.map((row) => row.value.reviewerMemberId).sort()).toEqual(['reviewer', 'reviewer-two'])
    expect(reviews.every((row) => row.value.versionHash === delivery.versionHash)).toBe(true)
    await f.runner.tick(done, true)
    expect((await f.store.get('task', 'reviewed'))?.revision).toBe(done.revision)
  })

  it('reconciles a lost queued admission before confirming cancellation', async () => {
    const f = await fixture()
    const value = await f.task('cancelled')
    await ensureRoomThread(f.deps, { id: value.execution.task.executionThreadId,
      roomId: f.room.id, taskId: value.execution.task.id, member: value.execution.task.memberSnapshot,
      kind: 'execution', workspace: value.workspace.path })
    const admitted = await f.h.turns.enqueueTurn({ threadId: value.execution.task.executionThreadId,
      request: { prompt: 'Do work', clientRequestId: 'cancelled-attempt-1' } })
    value.execution.task.status = 'stopping'
    await f.runner.tick(await f.save(value.execution), false)
    const identified = (await f.store.get<RoomTaskExecution>('task', 'cancelled'))!
    expect(identified.value.turnId).toBe(admitted.turnId)
    expect(identified.value.task.status).toBe('stopping')
    await f.runner.tick(identified, false)
    await f.runner.tick((await f.store.get<RoomTaskExecution>('task', 'cancelled'))!, false)
    expect((await f.store.get<RoomTaskExecution>('task', 'cancelled'))?.value.task.status).toBe('cancelled')
  })
})
