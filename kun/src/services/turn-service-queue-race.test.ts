import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord, finishTurn as finishTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import type { ThreadExecutionLeasePort } from '../ports/thread-execution-lease.js'
import type { StartTurnRequest } from '../contracts/turns.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { QUEUE_CANCELLED_TURN_CODE } from './turn-service-queue-operations.js'

type Harness = {
  turns: TurnService
  threadStore: InMemoryThreadStore
  queued: string[]
}

function createHarness(options: { executionLeases?: ThreadExecutionLeasePort } = {}): Harness {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => new Date().toISOString()
  const turns = new TurnService({
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
    nowIso,
    ...(options.executionLeases ? { executionLeases: options.executionLeases } : {})
  })
  const queued: string[] = []
  turns.setTurnQueuedHook((threadId) => {
    queued.push(threadId)
  })
  return { turns, threadStore, queued }
}

async function createThread(h: Harness, id: string): Promise<void> {
  await h.threadStore.upsert(createThreadRecord({
    id,
    title: 'Race thread',
    workspace: '/tmp/workspace',
    model: 'deepseek-v4-pro'
  }))
}

function startRequest(prompt: string, extras: Partial<StartTurnRequest> = {}): StartTurnRequest {
  return { prompt, model: 'deepseek-v4-pro', ...extras }
}

function noopLeases(): ThreadExecutionLeasePort {
  return {
    acquire: async (threadId, turnId) => busyLease(threadId, turnId),
    release: async () => undefined,
    owner: async () => null,
    shutdown: async () => undefined
  }
}

// A lease shape for tests that need the lock-free pre-check in startTurn to
// observe a busy thread via the lease authority.
function busyLease(threadId: string, turnId: string): ThreadExecutionLease {
  return {
    threadId,
    turnId,
    ownerFlavor: 'production',
    ownerInstanceId: 'owner_test',
    fencingToken: 1,
    acquiredAt: '2026-09-03T00:00:00.000Z',
    expiresAt: '2026-09-03T01:00:00.000Z'
  }
}

describe('enqueue race at turn-end boundaries', () => {
  it('queues instead of failing when the active turn completed between the busy decision and the queue write', async () => {
    // Path A replay: the lock-free lease pre-check sees the thread busy and
    // routes to enqueue; by the time the queue write runs, the previous turn
    // has already settled. The store wrapper delays the settle write until
    // startTurn's busy check has observed the running turn. Old code threw
    // "cannot enqueue: no active turn"; the atomic section must queue.
    const lease = busyLease('thr_race', 'turn_prev')
    const owner = vi.fn<() => Promise<ThreadExecutionLease | null>>(async () => lease)
    const h = createHarness({ executionLeases: { ...noopLeases(), owner } })
    await createThread(h, 'thr_race')
    const prevTurn = createTurnRecord({ id: 'turn_prev', threadId: 'thr_race', prompt: 'previous' })
    // First store read inside startTurn's mutation sees the running turn.
    let settled = false
    let busyObserved = false
    const realGet = h.threadStore.get.bind(h.threadStore)
    const realUpsert = h.threadStore.upsert.bind(h.threadStore)
    h.threadStore.get = (async (id: string) => {
      const record = await realGet(id)
      if (id !== 'thr_race' || !record || settled || busyObserved) return record
      busyObserved = true
      return { ...record, turns: [{ ...prevTurn, status: 'running' as const }] }
    }) as typeof h.threadStore.get
    h.threadStore.upsert = (async (next: Parameters<typeof realUpsert>[0]) => {
      // Once the busy check observed running, flip the store to settled so
      // the queue write and every later read see a completed previous turn.
      if (next.id === 'thr_race' && busyObserved && !settled &&
          next.turns.some((turn) => turn.status === 'queued')) {
        settled = true
        return realUpsert({
          ...next,
          turns: next.turns.map((turn) => turn.id === 'turn_prev'
            ? finishTurnRecord(prevTurn, 'completed', '2026-09-03T00:00:01.000Z')
            : turn)
        })
      }
      return realUpsert(next)
    }) as typeof h.threadStore.upsert
    const queued = await h.turns.startTurn({
      threadId: 'thr_race',
      request: startRequest('follow-up at settle boundary', { enqueueIfBusy: true })
    })
    expect(queued.status).toBe('queued')
    expect(queued.turnId).not.toBe('turn_prev')
    expect(h.queued).toEqual(['thr_race'])
    // The settled turn's lease is released; promotion can now admit.
    owner.mockResolvedValue(null)
    // Idle thread: promotion is a direct start.
    const started = await h.turns.startNextQueuedTurn('thr_race')
    expect(started).toEqual({ turnId: queued.turnId })
    const after = await h.threadStore.get('thr_race')
    expect(after?.turns.map((turn) => turn.status)).toEqual(['completed', 'running'])
  })

  it('queues when the active turn was cancelled before the queue record persisted', async () => {
    const lease = busyLease('thr_cancel', 'turn_prev')
    const owner = vi.fn<() => Promise<ThreadExecutionLease | null>>(async () => lease)
    const h = createHarness({ executionLeases: { ...noopLeases(), owner } })
    await createThread(h, 'thr_cancel')
    const prevTurn = createTurnRecord({ id: 'turn_prev', threadId: 'thr_cancel', prompt: 'previous' })
    let cancelled = false
    let busyObserved = false
    const realGet = h.threadStore.get.bind(h.threadStore)
    const realUpsert = h.threadStore.upsert.bind(h.threadStore)
    h.threadStore.get = (async (id: string) => {
      const record = await realGet(id)
      if (id !== 'thr_cancel' || !record || cancelled || busyObserved) return record
      busyObserved = true
      return { ...record, turns: [{ ...prevTurn, status: 'running' as const }] }
    }) as typeof h.threadStore.get
    h.threadStore.upsert = (async (next: Parameters<typeof realUpsert>[0]) => {
      if (next.id === 'thr_cancel' && busyObserved && !cancelled &&
          next.turns.some((turn) => turn.status === 'queued')) {
        cancelled = true
        return realUpsert({
          ...next,
          turns: next.turns.map((turn) => turn.id === 'turn_prev'
            ? {
                ...finishTurnRecord(prevTurn, 'aborted', '2026-09-03T00:00:01.000Z'),
                terminalCode: QUEUE_CANCELLED_TURN_CODE
              }
            : turn)
        })
      }
      return realUpsert(next)
    }) as typeof h.threadStore.upsert
    const queued = await h.turns.startTurn({
      threadId: 'thr_cancel',
      request: startRequest('follow-up after cancel', { enqueueIfBusy: true })
    })
    expect(queued.status).toBe('queued')
    expect(h.queued).toEqual(['thr_cancel'])
    owner.mockResolvedValue(null)
    expect(await h.turns.startNextQueuedTurn('thr_cancel')).toEqual({ turnId: queued.turnId })
  })

  it('two concurrent follow-ups enqueue without losing either record', async () => {
    const h = createHarness()
    await createThread(h, 'thr_q')
    await h.turns.startTurn({ threadId: 'thr_q', request: startRequest('first') })
    const [a, b] = await Promise.all([
      h.turns.startTurn({
        threadId: 'thr_q',
        request: startRequest('follow-a', { enqueueIfBusy: true, clientRequestId: 'ra' })
      }),
      h.turns.startTurn({
        threadId: 'thr_q',
        request: startRequest('follow-b', { enqueueIfBusy: true, clientRequestId: 'rb' })
      })
    ])
    expect(new Set([a.turnId, b.turnId]).size).toBe(2)
    const thread = await h.threadStore.get('thr_q')
    const queuedIds = thread!.turns.filter((turn) => turn.status === 'queued').map((t) => t.id)
    expect(queuedIds).toEqual([a.turnId, b.turnId])
    // FIFO promotion order follows record order.
    const runningFirst = thread!.turns.find((turn) => turn.status === 'running')!
    await h.turns.finishTurn({ threadId: 'thr_q', turnId: runningFirst.id, status: 'completed' })
    expect(await h.turns.startNextQueuedTurn('thr_q')).toEqual({ turnId: a.turnId })
    expect(await h.turns.startNextQueuedTurn('thr_q')).toBeNull()
    await h.turns.finishTurn({ threadId: 'thr_q', turnId: a.turnId, status: 'completed' })
    expect(await h.turns.startNextQueuedTurn('thr_q')).toEqual({ turnId: b.turnId })
  })

  it('a queue write followed by runtime shutdown stays durable across a restart', async () => {
    // Queue commit on the first service instance, immediate shutdown, then a
    // fresh service over the same stores simulates a runtime restart.
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => new Date().toISOString()
    const build = () => new TurnService({
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
    const first = build()
    await threadStore.upsert(createThreadRecord({
      id: 'thr_restart',
      title: 'Restart thread',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const running = await first.startTurn({
      threadId: 'thr_restart',
      request: startRequest('running when queued')
    })
    const queued = await first.startTurn({
      threadId: 'thr_restart',
      request: startRequest('durable across restart', { enqueueIfBusy: true })
    })
    await first.closeAdmissionForShutdown()
    const restarted = build()
    await restarted.reconcileOrphanedTurns()
    const after = await threadStore.get('thr_restart')
    expect(after?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('queued')
    // The parked running turn was swept; the queued record still promotes
    // exactly once.
    const promoted = await restarted.startNextQueuedTurn('thr_restart')
    expect(promoted).toEqual({ turnId: queued.turnId })
    expect(await restarted.startNextQueuedTurn('thr_restart')).toBeNull()
    await restarted.finishTurn({
      threadId: 'thr_restart',
      turnId: queued.turnId,
      status: 'completed'
    })
    expect(await restarted.startNextQueuedTurn('thr_restart')).toBeNull()
    expect(running.turnId).not.toBe(queued.turnId)
  })

  it('a settled thread does not re-consume an old queue on later turns', async () => {
    const h = createHarness()
    await createThread(h, 'thr_q')
    const first = await h.turns.startTurn({ threadId: 'thr_q', request: startRequest('first') })
    const queued = await h.turns.startTurn({
      threadId: 'thr_q',
      request: startRequest('only queued', { enqueueIfBusy: true })
    })
    await h.turns.finishTurn({ threadId: 'thr_q', turnId: first.turnId, status: 'completed' })
    expect(await h.turns.startNextQueuedTurn('thr_q')).toEqual({ turnId: queued.turnId })
    await h.turns.finishTurn({ threadId: 'thr_q', turnId: queued.turnId, status: 'completed' })
    // Queue is empty: a fresh turn starts directly and drains nothing.
    const fresh = await h.turns.startTurn({ threadId: 'thr_q', request: startRequest('fresh') })
    expect(fresh.status).toBeUndefined()
    expect(await h.turns.startNextQueuedTurn('thr_q')).toBeNull()
    const thread = await h.threadStore.get('thr_q')
    expect(thread?.turns.every((turn) => turn.status !== 'queued')).toBe(true)
  })
})
