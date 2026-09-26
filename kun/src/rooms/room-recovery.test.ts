import { afterEach, describe, expect, it, vi } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import { inspectRoomRecovery, recoverRoomTask } from './room-recovery.js'

const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close() })
async function fixture() { const f = await productServiceFixture(); fixtures.push(f); return f }
async function missingExecution(f: Awaited<ReturnType<typeof fixture>>) {
  await f.updateTask({ task: { ...f.execution.task, status: 'recovery_required' }, turnId: 'missing_turn' })
  return { action: 'retry', clientRequestId: 'recover-once', expectedRevision: (await f.task()).revision }
}

describe('room recovery proof and continuation receipts', () => {
  it('does not free unknown execution solely because its metadata and lease are absent', async () => {
    const f = await fixture()
    const input = await missingExecution(f)
    expect(await inspectRoomRecovery(f.deps, f.room.id, f.execution.task.id))
      .toMatchObject({ state: 'unknown', canRetry: false, canAbandon: false })
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)).rejects.toThrow()
    f.deps.proveStopped = async () => false
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, { ...input, action: 'abandon' })).rejects.toThrow()
    expect((await f.task()).value).toMatchObject({ attempt: 1, task: { status: 'recovery_required' } })
    expect(await f.store.list('recovery')).toHaveLength(0)
  })

  it.each(['prepare', 'continuation', 'final'] as const)('replays one retry when the %s response is lost after durable storage', async (phase) => {
    const f = await fixture()
    const input = await missingExecution(f)
    f.deps.proveStopped = async () => true
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (mutation) => {
      const result = await commit(mutation)
      const matches = phase === 'prepare' ? mutation.requestId.endsWith('-prepare') :
        phase === 'continuation' ? mutation.requestId.startsWith('action:') :
          mutation.requestId.startsWith('recover-') && !mutation.requestId.endsWith('-prepare')
      if (fail && matches) { fail = false; throw new Error('response lost') }
      return result
    })
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)).rejects.toThrow('response lost')
    // A continuation that already committed can now be running; the original recovery must replay it.
    if (phase !== 'prepare') f.deps.proveStopped = async () => false
    const result = await recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)
    expect(result).toMatchObject({ state: 'stopped' })
    expect((await f.task()).value).toMatchObject({ attempt: 2, recoveryResolved: false, abandoned: false,
      previousExecutionThreadIds: ['execution_one'], task: { status: 'queued' } })
    const thread = (await f.task()).value.task.executionThreadId
    expect(thread).toMatch(/^room-recovered-/)
    expect(await recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)).toEqual(result)
    expect((await f.task()).value.attempt).toBe(2)
    expect((await f.store.list<{ state: string }>('recovery'))[0].value.state).toBe('completed')
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, { ...input, action: 'abandon' }))
      .rejects.toThrow('identity conflict')
  })

  it('rechecks stopped proof before an unacknowledged prepared continuation can start', async () => {
    const f = await fixture()
    const input = await missingExecution(f)
    let stopped = true
    f.deps.proveStopped = async () => stopped
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (mutation) => {
      const result = await commit(mutation)
      if (fail && mutation.requestId.endsWith('-prepare')) { fail = false; stopped = false; throw new Error('restart before continuation') }
      return result
    })
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)).rejects.toThrow('restart before continuation')
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)).rejects.toThrow()
    expect((await f.task()).value.attempt).toBe(1)
    stopped = true
    await recoverRoomTask(f.deps, f.room.id, f.execution.task.id, input)
    expect((await f.task()).value.attempt).toBe(2)
  })

  it('reassociates a known queued original execution without allocating a replacement', async () => {
    const f = await fixture()
    await f.h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent' }, { id: f.execution.task.executionThreadId })
    const turn = await f.h.turns.enqueueTurn({ threadId: f.execution.task.executionThreadId,
      request: { prompt: 'Original task', clientRequestId: f.execution.task.id + '-attempt-1' } })
    await f.updateTask({ task: { ...f.execution.task, status: 'recovery_required' }, turnId: turn.turnId })
    const inspected = await inspectRoomRecovery(f.deps, f.room.id, f.execution.task.id)
    expect(inspected).toMatchObject({ state: 'active', canRetry: false, canAbandon: false, turnId: turn.turnId })
    await recoverRoomTask(f.deps, f.room.id, f.execution.task.id, {
      clientRequestId: 'reassociate', expectedRevision: (await f.task()).revision, action: 'reconcile' })
    expect((await f.task()).value).toMatchObject({ attempt: 1, turnId: turn.turnId, task: { executionThreadId: f.execution.task.executionThreadId } })
    expect((await f.h.threads.getMetadata(f.execution.task.executionThreadId))?.turns).toHaveLength(1)
  })

  it('persists explicit abandonment only after proof and rejects ownership loss', async () => {
    const f = await fixture()
    const input = await missingExecution(f)
    f.deps.proveStopped = async () => true
    const original = f.deps.assertOwnership
    f.deps.assertOwnership = async () => { throw new Error('lease lost') }
    await expect(recoverRoomTask(f.deps, f.room.id, f.execution.task.id, { ...input, action: 'abandon' })).rejects.toThrow('lease lost')
    expect((await f.task()).value.abandoned).not.toBe(true)
    f.deps.assertOwnership = original
    await recoverRoomTask(f.deps, f.room.id, f.execution.task.id, { ...input, action: 'abandon' })
    expect((await f.task()).value).toMatchObject({ abandoned: true, task: { status: 'cancelled' } })
  })
})
