import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'
import { createTurnRecord } from '../domain/turn.js'
import { RoomMemberSchema } from '../contracts/rooms.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { RoomRuntime } from './room-runtime.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { ensureRoomThread } from './room-execution.js'
import { putRoomDocument } from './room-service.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-room-scheduler-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const h = makeHarness(makeFakeModel([]))
  const deps: RoomRuntimeDeps = { store, threads: h.threads, threadStore: h.threadStore,
    turns: h.turns, sessions: h.sessionStore, approvals: h.approvalGate, inputs: h.userInputGate,
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId), dataDir: root,
    model: () => ({ model: 'fake' }), profiles: () => ({}), assertOwnership: async () => {} }
  const runtime = new RoomRuntime(deps)
  cleanups.push(async () => { await runtime.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  const save = async (execution: RoomTaskExecution) => putRoomDocument(store, 'task', execution.task.id,
    execution.task.roomId, execution, await store.get('task', execution.task.id), execution.task.id)
  const get = async (id: string) => (await store.get<RoomTaskExecution>('task', id))!.value
  async function task(id: string, status: RoomTaskExecution['task']['status'], memberId: string,
    turnStatus?: 'running' | 'completed', roomId = 'room') {
    const member = RoomMemberSchema.parse({ id: memberId, displayName: memberId, presetId: 'developer',
      role: 'developer', allowedRepositoryIds: ['repo'], revision: 0 })
    const execution: RoomTaskExecution = { task: RoomTaskSchema.parse({ id, roomId, requestId: id,
      sourceMessageId: id, title: id, ownerMemberId: memberId, memberSnapshot: member, repositoryId: 'repo',
      workspaceId: id, executionThreadId: 'execution-' + id, status, stage: 'develop',
      requirementRevision: 0, revision: 0, updatedAt: new Date().toISOString() }),
      prompt: 'Work on ' + id, attachmentIds: [], dependencyTaskIds: [], attempt: 1, reworkRounds: 0, configuration: null }
    if (turnStatus) {
      const thread = await ensureRoomThread(deps, { id: execution.task.executionThreadId, roomId,
        taskId: id, member, kind: 'execution', workspace: root })
      execution.turnId = 'turn-' + id
      await h.threadStore.upsert({ ...thread, turns: [createTurnRecord({ id: execution.turnId,
        threadId: thread.id, prompt: execution.prompt, clientRequestId: id + '-attempt-1', status: turnStatus })] })
    }
    const workspace: RoomWorkspace = { id, roomId, taskId: id, path: root, state: 'ready',
      branch: 'codex/rooms/' + id, baseRevision: 'a'.repeat(40), repository: { root, commonDir: join(root, '.git'),
        head: 'a'.repeat(40), branch: 'refs/heads/develop', dirty: false, operationInProgress: false } }
    await putRoomDocument(store, 'workspace', id, roomId, workspace, null, id)
    await save(execution)
    return execution
  }
  return { root, store, h, deps, runtime, task, save, get, tick: async () => {
    const driver = runtime as unknown as { stopped: boolean; tick(): Promise<void> }
    driver.stopped = false
    try { await driver.tick() } finally { driver.stopped = true }
  } }
}

describe('room scheduler execution ownership', () => {
  it('honors a room limit of one while admitting another room within global capacity', async () => {
    const f = await fixture()
    const first = (await f.runtime.service.create({ clientRequestId: 'one-at-a-time', name: 'Sequential', maxConcurrentTasks: 1 })).room
    const second = (await f.runtime.service.create({ clientRequestId: 'another-room', name: 'Other', maxConcurrentTasks: 2 })).room
    await f.task('active-first', 'running', 'developer', 'running', first.id)
    await f.task('waiting-first', 'queued', 'reviewer', undefined, first.id)
    await f.task('ready-second', 'queued', 'developer', undefined, second.id)
    await f.task('waiting-second', 'queued', 'reviewer', undefined, second.id)
    await f.tick()
    expect((await f.get('waiting-first')).turnId).toBeUndefined()
    expect((await f.get('ready-second')).turnId).toBeDefined()
    expect((await f.get('waiting-second')).turnId).toBeUndefined()
  })

  it('counts a live recovered execution and resumes only observation of its existing turn', async () => {
    const f = await fixture()
    await f.task('recovered', 'recovery_required', 'developer', 'running')
    await f.task('other', 'running', 'other-member', 'running')
    await f.task('same-member', 'queued', 'developer')
    await f.task('third-member', 'queued', 'third-member')
    await f.tick()
    expect((await f.get('recovered')).task.status).toBe('running')
    expect((await f.get('same-member')).turnId).toBeUndefined()
    expect((await f.get('third-member')).turnId).toBeUndefined()
    expect((await f.h.threads.getMetadata('execution-recovered'))?.turns).toHaveLength(1)
  })

  it('keeps missing and temporarily unreadable execution identities occupied without redispatching', async () => {
    const f = await fixture()
    const missing = await f.task('missing', 'recovery_required', 'developer')
    missing.turnId = 'lost-turn'
    await f.save(missing)
    await f.task('unreadable', 'recovery_required', 'other-member', 'running')
    await f.task('next', 'queued', 'next-member')
    const getMetadata = f.h.threads.getMetadata.bind(f.h.threads)
    vi.spyOn(f.h.threads, 'getMetadata').mockImplementation(async (id) => {
      if (id === 'execution-unreadable') throw new Error('temporary transport failure')
      return getMetadata(id)
    })
    await f.tick()
    expect((await f.get('missing')).task.status).toBe('recovery_required')
    expect((await f.get('unreadable')).task.status).toBe('recovery_required')
    expect((await f.get('next')).turnId).toBeUndefined()
  })

  it('does not replay terminated recovery tasks or let them block an available member slot', async () => {
    const f = await fixture()
    await f.task('settled', 'recovery_required', 'developer', 'completed')
    await f.task('other', 'running', 'other-member', 'running')
    await f.task('next', 'queued', 'developer')
    await f.tick()
    expect((await f.get('settled')).task.status).toBe('recovery_required')
    expect((await f.h.threads.getMetadata('execution-settled'))?.turns).toHaveLength(1)
    expect((await f.get('next')).turnId).toBeDefined()
  })

  it('retains a slot when admission succeeds but saving its task receipt fails', async () => {
    const f = await fixture()
    await f.task('other', 'running', 'other-member', 'running')
    await f.task('lost-receipt', 'queued', 'developer')
    await f.task('same-member', 'queued', 'developer')
    await f.task('third-member', 'queued', 'third-member')
    const commit = f.store.commit.bind(f.store)
    let lost = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!lost && input.puts?.some((put) => put.kind === 'task' && put.id === 'lost-receipt' &&
        (put.value as RoomTaskExecution).turnId)) {
        lost = true
        throw new Error('lost task admission receipt')
      }
      return commit(input)
    })
    await f.tick()
    expect(lost).toBe(true)
    expect((await f.get('lost-receipt')).task.status).toBe('recovery_required')
    expect((await f.h.threads.getMetadata('execution-lost-receipt'))?.turns).toHaveLength(1)
    expect((await f.get('same-member')).turnId).toBeUndefined()
    expect((await f.get('third-member')).turnId).toBeUndefined()
    await f.tick()
    expect((await f.get('lost-receipt')).turnId).toBeDefined()
    expect((await f.h.threads.getMetadata('execution-lost-receipt'))?.turns).toHaveLength(1)
  })

  it('includes active tasks beyond the first pending-task page in its global capacity', async () => {
    const f = await fixture()
    await f.task('next', 'queued', 'next-member')
    const blocked = await f.task('blocked', 'waiting_dependency', 'blocked-member')
    blocked.dependencyTaskIds = ['active-one']
    await f.save(blocked)
    const rows = Array.from({ length: 998 }, (_, index) => {
      const id = 'blocked-' + index
      return { kind: 'task' as const, id, roomId: 'room', taskId: id,
        value: { ...blocked, task: { ...blocked.task, id } } }
    })
    await f.store.commit({ requestId: 'blocked-page', puts: rows,
      checks: rows.map((row) => ({ kind: row.kind, id: row.id, expectedRevision: null })) })
    await f.task('active-one', 'running', 'member-one', 'running')
    await f.task('active-two', 'running', 'member-two', 'running')
    await f.tick()
    expect((await f.get('next')).turnId).toBeUndefined()
    expect((await f.get('next')).task.status).toBe('queued')
  })
})
