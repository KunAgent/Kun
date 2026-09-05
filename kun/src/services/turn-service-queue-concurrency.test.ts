import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { makeUserItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type {
  ThreadStore,
  ThreadStoreConditionalWrite,
  ThreadStoreListOptions
} from '../ports/thread-store.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnConflictError, TurnService } from './turn-service.js'

/**
 * Two independent ThreadStore wrapper instances that delegate to one shared
 * InMemoryThreadStore core. `withThreadStoreMutation` keys its per-process
 * queue on the store instance (a WeakMap), so these two wrappers do not
 * serialize each other — faithfully modeling two Runtime processes sharing a
 * dataDir. The process-local fallback of `withManagerDataMutex` keys on the
 * resource string and therefore DOES serialize them, so the mutex fix is
 * observable within a single test process.
 */
class SharedBackingThreadStore implements ThreadStore {
  reads = 0
  private blockNextCas = false
  private resolveCasStarted: (() => void) | null = null
  private resolveCasRelease: (() => void) | null = null
  private casStarted = Promise.resolve()
  private casRelease = Promise.resolve()

  constructor(
    private readonly backing: InMemoryThreadStore,
    private readonly beforeCas?: (
      thread: ThreadRecord,
      expectedRevision: number
    ) => Promise<void>
  ) {
    this.casStarted = new Promise((resolve) => { this.resolveCasStarted = resolve })
    this.casRelease = new Promise((resolve) => { this.resolveCasRelease = resolve })
  }

  armCasBlock(): void { this.blockNextCas = true }
  releaseCas(): void { this.resolveCasRelease?.() }
  awaitCasStarted(): Promise<void> { return this.casStarted }

  async list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    return this.backing.list(options)
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    this.reads += 1
    return this.backing.get(threadId)
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    return this.backing.upsert(thread)
  }

  async upsertIfRevision(
    thread: ThreadRecord,
    expectedRevision: number
  ): Promise<ThreadStoreConditionalWrite> {
    await this.beforeCas?.(thread, expectedRevision)
    if (this.blockNextCas) {
      this.blockNextCas = false
      this.resolveCasStarted?.()
      await this.casRelease
    }
    return this.backing.upsertIfRevision(thread, expectedRevision)
  }

  async delete(threadId: string): Promise<boolean> {
    return this.backing.delete(threadId)
  }

  async deleteByWorkspace(workspace: string): Promise<string[]> {
    return this.backing.deleteByWorkspace(workspace)
  }
}

function service(
  threadStore: ThreadStore,
  sessionStore = new InMemorySessionStore()
): TurnService {
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-08-24T00:00:00.000Z'
  return new TurnService({
    threadStore,
    sessionStore,
    events: new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    }),
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso
  })
}

/** Seed committed queued turns directly on the shared core. */
async function seedQueuedTurns(
  store: InMemoryThreadStore,
  threadId: string,
  turnIds: string[]
): Promise<void> {
  const thread = createThreadRecord({
    id: threadId,
    title: 'Queue thread',
    workspace: '/tmp/workspace',
    model: 'deepseek-v4-pro'
  })
  const turns = turnIds.map((turnId) => {
    const userItem = makeUserItem({
      id: `item_${turnId}_user`,
      turnId,
      threadId,
      text: 'queued'
    })
    return appendTurnItem(
      createTurnRecord({ id: turnId, threadId, prompt: 'queued' }),
      userItem
    )
  })
  await store.upsert({ ...thread, turns, status: 'running' })
}

describe('queue mutation cross-process serialization', () => {
  it('serializes cancel behind an in-flight promotion and rejects once promoted', async () => {
    const backing = new InMemoryThreadStore()
    const storeA = new SharedBackingThreadStore(backing)
    const storeB = new SharedBackingThreadStore(backing)
    const a = service(storeA)
    const b = service(storeB)
    const threadId = 'thr_q'

    await backing.upsert(createThreadRecord({
      id: threadId,
      title: 'Queue thread',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const first = await a.startTurn({ threadId, request: { prompt: 'first' } })
    const queued = await a.startTurn({
      threadId,
      request: { prompt: 'second', enqueueIfBusy: true }
    })
    await a.finishTurn({ threadId, turnId: first.turnId, status: 'completed' })

    storeA.armCasBlock()
    const promote = a.startNextQueuedTurn(threadId)
    await storeA.awaitCasStarted()

    const cancel = b.cancelQueuedTurn({ threadId, turnId: queued.turnId })
      .then((value) => ({ kind: 'resolved' as const, value }))
      .catch((error: unknown) => ({ kind: 'rejected' as const, error }))

    // B must not have entered its critical section while A holds the mutex.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(storeB.reads).toBe(0)

    storeA.releaseCas()
    await promote

    const result = await cancel
    expect(result.kind).toBe('rejected')
    if (result.kind !== 'rejected') throw new Error('expected rejection')
    expect(result.error).toBeInstanceOf(TurnConflictError)

    // Final durable state is running, never a stale aborted overwrite.
    const record = await backing.get(threadId)
    expect(record?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('running')
  })

  it('serializes enqueue behind an in-flight reorder without losing an entry', async () => {
    const backing = new InMemoryThreadStore()
    const storeA = new SharedBackingThreadStore(backing)
    const storeB = new SharedBackingThreadStore(backing)
    const a = service(storeA)
    const b = service(storeB)
    const threadId = 'thr_q'

    await backing.upsert(createThreadRecord({
      id: threadId,
      title: 'Queue thread',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const first = await a.startTurn({ threadId, request: { prompt: 'first' } })
    const turnA = await a.startTurn({ threadId, request: { prompt: 'a', enqueueIfBusy: true } })
    const turnB = await a.startTurn({ threadId, request: { prompt: 'b', enqueueIfBusy: true } })

    storeA.armCasBlock()
    const move = a.moveQueuedTurn({
      threadId,
      turnId: turnB.turnId,
      beforeTurnId: turnA.turnId
    })
    await storeA.awaitCasStarted()

    const enqueue = b.enqueueTurn({ threadId, request: { prompt: 'c' } })
      .then((value) => ({ kind: 'resolved' as const, value }))
      .catch((error: unknown) => ({ kind: 'rejected' as const, error }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(storeB.reads).toBe(0)

    storeA.releaseCas()
    await move
    const enqueued = await enqueue
    expect(enqueued.kind).toBe('resolved')
    if (enqueued.kind !== 'resolved') throw new Error('expected resolution')

    const record = await backing.get(threadId)
    const queuedIds = record?.turns
      .filter((turn) => turn.status === 'queued')
      .map((turn) => turn.id)
    expect(queuedIds).toEqual([turnB.turnId, turnA.turnId, enqueued.value.turnId])
    // The running turn must still be present and first.
    expect(record?.turns[0].id).toBe(first.turnId)
  })

  it('rejects a stale cancel via CAS instead of overwriting a running turn', async () => {
    const backing = new InMemoryThreadStore()
    const threadId = 'thr_cas'
    const turnId = 'turn_q'
    await seedQueuedTurns(backing, threadId, [turnId])

    const store = new SharedBackingThreadStore(backing, async () => {
      const current = await backing.get(threadId)
      if (!current) return
      await backing.upsert({
        ...current,
        turns: current.turns.map((turn) =>
          turn.id === turnId ? { ...turn, status: 'running' as const } : turn
        )
      })
    })
    const svc = service(store)

    await expect(
      svc.cancelQueuedTurn({ threadId, turnId })
    ).rejects.toBeInstanceOf(TurnConflictError)

    const record = await backing.get(threadId)
    expect(record?.turns.find((turn) => turn.id === turnId)?.status).toBe('running')
  })

  it('rejects a stale reorder via CAS instead of clobbering a promoted target', async () => {
    const backing = new InMemoryThreadStore()
    const threadId = 'thr_move_cas'
    await backing.upsert(createThreadRecord({
      id: threadId,
      title: 'Queue thread',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    await seedQueuedTurns(backing, threadId, ['turn_a', 'turn_b'])

    const store = new SharedBackingThreadStore(backing, async () => {
      const current = await backing.get(threadId)
      if (!current) return
      await backing.upsert({
        ...current,
        turns: current.turns.map((turn) =>
          turn.id === 'turn_a' ? { ...turn, status: 'running' as const } : turn
        )
      })
    })
    const svc = service(store)

    await expect(
      svc.moveQueuedTurn({
        threadId,
        turnId: 'turn_b',
        beforeTurnId: 'turn_a'
      })
    ).rejects.toBeInstanceOf(TurnConflictError)

    const record = await backing.get(threadId)
    expect(record?.turns.find((turn) => turn.id === 'turn_a')?.status).toBe('running')
  })

  it('keeps cancel-then-promote consistent: promotion returns null', async () => {
    const backing = new InMemoryThreadStore()
    const store = new SharedBackingThreadStore(backing)
    const svc = service(store)
    const threadId = 'thr_seq'

    await backing.upsert(createThreadRecord({
      id: threadId,
      title: 'Queue thread',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const first = await svc.startTurn({ threadId, request: { prompt: 'first' } })
    const queued = await svc.startTurn({
      threadId,
      request: { prompt: 'second', enqueueIfBusy: true }
    })
    await svc.finishTurn({ threadId, turnId: first.turnId, status: 'completed' })

    await svc.cancelQueuedTurn({ threadId, turnId: queued.turnId })
    expect(await svc.startNextQueuedTurn(threadId)).toBeNull()

    const record = await backing.get(threadId)
    expect(record?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('aborted')
  })
})
