import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { currentTurnMutationFence, runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ExecutionTaskService } from '../services/execution-task-service.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { createExecutionTaskTurnSettledHook } from './execution-task-turn-settlement.js'
import { QueuedTurnDispatcher } from './queued-turn-dispatcher.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => new Date().toISOString()
  const events = new RuntimeEventRecorder({ sessionStore, eventBus, nowIso,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId) })
  const turns = new TurnService({ threadStore, sessionStore, events, nowIso,
    inflight: new InflightTracker(), steering: new SteeringQueue(),
    compactor: new ContextCompactor(), ids: new SequentialIdGenerator() })
  const tasks = new ExecutionTaskService({ threadStore, events, nowIso })
  const createThread = (id: string, parentThreadId?: string) => threadStore.upsert(createThreadRecord({
    id, title: id, workspace: '/tmp', model: 'test', ...(parentThreadId ? { parentThreadId } : {})
  }))
  return { threadStore, sessionStore, turns, tasks, createThread }
}

describe('execution task turn settlement', () => {
  it('pauses the dispatcher before delayed reconciliation and clears the settled turn fence', async () => {
    const gate = deferred()
    const onTurnSettled = vi.fn()
    const reconcileAfterTurn = vi.fn(async () => {
      expect(currentTurnMutationFence()).toBeUndefined()
      expect(onTurnSettled).toHaveBeenCalledWith('thread', 'aborted')
      await gate.promise
    })
    const hook = createExecutionTaskTurnSettledHook({ reconcileAfterTurn }, { onTurnSettled })
    const pending = runWithTurnMutationFence({ threadId: 'thread', turnId: 'old-turn',
      ownerFlavor: 'production', ownerInstanceId: 'runtime', fencingToken: 1 },
    () => hook('thread', 'aborted'))
    expect(onTurnSettled).toHaveBeenCalledOnce()
    gate.resolve()
    await pending
    expect(onTurnSettled).toHaveBeenCalledOnce()
  })

  it.each(['completed', 'failed'] as const)('still wakes the dispatcher when %s reconciliation fails', async (status) => {
    const onTurnSettled = vi.fn()
    const hook = createExecutionTaskTurnSettledHook({ reconcileAfterTurn: async () => {
      throw new Error('store unavailable')
    } }, { onTurnSettled })
    await expect(hook('thread', status)).rejects.toThrow('store unavailable')
    expect(onTurnSettled).toHaveBeenCalledExactlyOnceWith('thread', status)
  })

  it('keeps a real interrupted thread queued while reconciliation is delayed and another thread wakes', async () => {
    const f = fixture()
    await f.createThread('thread')
    const gate = deferred(), hooks: Promise<void>[] = []
    const runTurn = vi.fn()
    const dispatcher = new QueuedTurnDispatcher({ turns: f.turns, threadStore: f.threadStore, runTurn })
    const hook = createExecutionTaskTurnSettledHook({ reconcileAfterTurn: () => gate.promise }, dispatcher)
    f.turns.setTurnSettledHook((threadId, status) => {
      const pending = hook(threadId, status)
      hooks.push(pending)
      return pending
    })
    f.turns.setTurnQueuedHook((threadId) => dispatcher.requestDrain(threadId))
    try {
      const running = await f.turns.startTurn({ threadId: 'thread', request: { prompt: 'Work', model: 'test' } })
      const queued = await f.turns.enqueueTurn({ threadId: 'thread', request: { prompt: 'Later', model: 'test' } })
      await setImmediate()
      await f.turns.interruptTurn({ threadId: 'thread', turnId: running.turnId })
      dispatcher.onTurnSettled('another-thread', 'completed')
      await setImmediate()
      expect(hooks).toHaveLength(1)
      expect(runTurn).not.toHaveBeenCalled()
      expect((await f.threadStore.get('thread'))?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('queued')
    } finally {
      gate.resolve()
      await Promise.allSettled(hooks)
      await dispatcher.dispose()
    }
  })

  it('waits for a real child interrupt commit before reconciling parent-owned task state', async () => {
    const f = fixture()
    await f.createThread('parent')
    await f.createThread('child', 'parent')
    const running = await f.turns.startTurn({ threadId: 'child', request: { prompt: 'Work', model: 'test' } })
    const { task } = await f.tasks.create('parent', { title: 'Assigned work', ownerThreadId: 'child', clientRequestId: 'assigned' })
    await f.tasks.update('parent', task.id, { status: 'running', expectedRevision: 0, clientRequestId: 'start' },
      { threadId: 'child', turnId: running.turnId })
    expect((await f.threadStore.get('child'))?.executionTasks).toBeUndefined()

    const enteredWrite = deferred(), releaseWrite = deferred(), enteredHook = deferred(), hookDone = deferred()
    const originalUpsert = f.threadStore.upsert.bind(f.threadStore)
    const write = vi.spyOn(f.threadStore, 'upsert').mockImplementation(async (thread) => {
      if (thread.id === 'child' && thread.turns.some((turn) => turn.id === running.turnId && turn.status === 'aborted')) {
        enteredWrite.resolve()
        await releaseWrite.promise
      }
      return originalUpsert(thread)
    })
    const hook = createExecutionTaskTurnSettledHook(f.tasks, { onTurnSettled: vi.fn() })
    let hookFailure: unknown
    f.turns.setTurnSettledHook(async (threadId, status) => {
      enteredHook.resolve()
      try { await hook(threadId, status) } catch (error) { hookFailure = error }
      finally { hookDone.resolve() }
    })
    const stop = f.turns.interruptTurn({ threadId: 'child', turnId: running.turnId })
    try {
      await Promise.all([enteredWrite.promise, enteredHook.promise])
      await setImmediate()
      expect((await f.threadStore.get('child'))?.turns[0].status).toBe('running')
      releaseWrite.resolve()
      await stop
      await hookDone.promise
      expect(hookFailure).toBeUndefined()
      expect((await f.threadStore.get('parent'))?.executionTasks?.tasks[0]).toMatchObject({
        id: task.id, status: 'paused', revision: 2
      })
      expect((await f.sessionStore.loadEventsSince('parent', 0)).at(-1)).toMatchObject({
        kind: 'todos_updated', todos: { items: [{ taskStatus: 'paused' }] }
      })
    } finally {
      releaseWrite.resolve()
      await stop
      write.mockRestore()
    }
  })
})
