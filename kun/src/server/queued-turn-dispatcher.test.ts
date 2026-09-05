import { describe, expect, it, vi, type Mock } from 'vitest'
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
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { QueuedTurnDispatcher } from './queued-turn-dispatcher.js'

type RunTurnFn = (threadId: string, turnId: string) => Promise<unknown> | void

type DispatcherHarness = {
  turns: TurnService
  threadStore: InMemoryThreadStore
  dispatcher: QueuedTurnDispatcher
  runTurn: Mock<RunTurnFn>
}

async function createThread(h: DispatcherHarness, id: string): Promise<void> {
  await h.threadStore.upsert(createThreadRecord({
    id,
    title: 'Dispatcher thread',
    workspace: '/tmp/workspace',
    model: 'deepseek-v4-pro'
  }))
}

function createDispatcherHarness(options: {
  maxConcurrentTurns?: number
  executionLeases?: ThreadExecutionLeasePort
  runTurn?: RunTurnFn
} = {}): DispatcherHarness {
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
    ...(options.maxConcurrentTurns !== undefined
      ? { maxConcurrentTurns: options.maxConcurrentTurns }
      : {}),
    ids: new SequentialIdGenerator(),
    nowIso,
    ...(options.executionLeases ? { executionLeases: options.executionLeases } : {})
  })
  const fallbackRunTurn: RunTurnFn = async () => undefined
  const runTurn = vi.fn(options.runTurn ?? fallbackRunTurn)
  const dispatcher = new QueuedTurnDispatcher({ turns, threadStore, runTurn })
  turns.setTurnSettledHook((threadId, status) => dispatcher.onTurnSettled(threadId, status))
  turns.setTurnQueuedHook((threadId) => dispatcher.requestDrain(threadId))
  return { turns, threadStore, dispatcher, runTurn }
}

describe('QueuedTurnDispatcher queue-commit trigger', () => {
  it('promotes a turn queued onto an idle thread exactly once via the queued hook', async () => {
    // A busy lease forces the enqueue path; after the pre-check the settled
    // turn's lease is released, which is exactly the boundary the queued
    // hook exists for.
    let preCheckCalls = 0
    const executionLeases: ThreadExecutionLeasePort = {
      acquire: async (threadId, turnId) => ({
        threadId,
        turnId,
        ownerFlavor: 'production',
        ownerInstanceId: 'owner_test',
        fencingToken: 1,
        acquiredAt: '2026-09-03T00:00:00.000Z',
        expiresAt: '2026-09-03T01:00:00.000Z'
      }),
      release: async () => undefined,
      owner: async () => {
        preCheckCalls += 1
        return preCheckCalls <= 1
          ? ({
              threadId: 'thr_disp',
              turnId: 'turn_prev',
              ownerFlavor: 'production',
              ownerInstanceId: 'owner_test',
              fencingToken: 1,
              acquiredAt: '2026-09-03T00:00:00.000Z',
              expiresAt: '2026-09-03T01:00:00.000Z'
            } as ThreadExecutionLease)
          : null
      },
      shutdown: async () => undefined
    }
    const h = createDispatcherHarness({ executionLeases })
    await createThread(h, 'thr_disp')

    // The race this guards: the busy decision saw a running turn, but it
    // settled before the queue record committed. The commit trigger must
    // promote the durable record as a direct start — no user-visible conflict.
    const thread = (await h.threadStore.get('thr_disp'))!
    await h.threadStore.upsert({
      ...thread,
      turns: [finishTurnRecord(
        createTurnRecord({ id: 'turn_prev', threadId: 'thr_disp', prompt: 'previous' }),
        'completed',
        '2026-09-03T00:00:01.000Z'
      )]
    })

    const queued = await h.turns.startTurn({
      threadId: 'thr_disp',
      request: { prompt: 'follow-up at settle boundary', model: 'deepseek-v4-pro', enqueueIfBusy: true }
    })
    expect(queued.status).toBe('queued')

    // The lease was already released when the record committed; the queued
    // hook's pass must promote it as a direct start without any further
    // trigger.
    await vi.waitFor(() => {
      expect(h.runTurn).toHaveBeenCalledOnce()
    })
    expect(h.runTurn).toHaveBeenCalledWith('thr_disp', queued.turnId)
    // Promotion happened exactly once: the record is running, not duplicated.
    const after = await h.threadStore.get('thr_disp')
    expect(after?.turns.filter((turn) => turn.status === 'running')).toHaveLength(1)
    expect(after?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('running')
  })
})

describe('QueuedTurnDispatcher global scheduling', () => {
  it('promotes another thread\'s queued turn after global capacity frees (maxConcurrentTurns=1)', async () => {
    const h = createDispatcherHarness({ maxConcurrentTurns: 1 })
    await createThread(h, 'thr_a')
    await createThread(h, 'thr_b')

    // Thread A holds the single global slot.
    const running = await h.turns.startTurn({
      threadId: 'thr_a',
      request: { prompt: 'long task on A', model: 'deepseek-v4-pro' }
    })
    expect(running.status).toBeUndefined()

    // Thread B queues while capacity is exhausted; the queued hook runs a
    // pass, promotion hits capacity, and B stays parked in the ready queue.
    const queued = await h.turns.enqueueTurn({
      threadId: 'thr_b',
      request: { prompt: 'waiting on B', model: 'deepseek-v4-pro' }
    })
    expect(queued.status).toBe('queued')

    // A settles: the settled hook wakes the scheduler; the freed slot must
    // now promote B's queued turn without any further B-side event.
    await h.turns.finishTurn({
      threadId: 'thr_a',
      turnId: running.turnId,
      status: 'completed'
    })

    await vi.waitFor(() => {
      expect(h.runTurn).toHaveBeenCalledWith('thr_b', queued.turnId)
    })
    const bThread = await h.threadStore.get('thr_b')
    expect(bThread?.turns.find((turn) => turn.id === queued.turnId)?.status).toBe('running')
  })

  it('abort wakes other threads but evicts the aborted thread from the ready queue', async () => {
    const h = createDispatcherHarness({ maxConcurrentTurns: 1 })
    await createThread(h, 'thr_a')
    await createThread(h, 'thr_b')

    const running = await h.turns.startTurn({
      threadId: 'thr_a',
      request: { prompt: 'interruptible task', model: 'deepseek-v4-pro' }
    })
    // Both A and B own queued turns; both stay ready-blocked on capacity.
    const aQueued = await h.turns.enqueueTurn({
      threadId: 'thr_a',
      request: { prompt: 'A follow-up', model: 'deepseek-v4-pro' }
    })
    const bQueued = await h.turns.enqueueTurn({
      threadId: 'thr_b',
      request: { prompt: 'B follow-up', model: 'deepseek-v4-pro' }
    })
    expect(aQueued.status).toBe('queued')
    expect(bQueued.status).toBe('queued')

    // Aborting A's running turn frees the slot: B must be promoted (wake),
    // while A's own queue is paused (evict) so Stop reliably stops A.
    await h.turns.finishTurn({
      threadId: 'thr_a',
      turnId: running.turnId,
      status: 'aborted'
    })

    await vi.waitFor(() => {
      expect(h.runTurn).toHaveBeenCalledWith('thr_b', bQueued.turnId)
    })
    const aThread = await h.threadStore.get('thr_a')
    expect(aThread?.turns.find((turn) => turn.id === aQueued.turnId)?.status).toBe('queued')
  })

  it('schedules a queued turn committed while a pass is already running (lost-wakeup window)', async () => {
    // Gate runTurn so the first promotion is still in flight when the next
    // queue commit fires — the exact window where the old per-thread
    // draining guard dropped the hook.
    let releaseFirst: (() => void) | undefined
    const runTurn = vi.fn((threadId: string, turnId: string) => {
      if (runTurn.mock.calls.length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      return undefined
    })
    const h = createDispatcherHarness({ runTurn })
    await createThread(h, 'thr_gate')

    const first = await h.turns.enqueueTurn({
      threadId: 'thr_gate',
      request: { prompt: 'first', model: 'deepseek-v4-pro' }
    })
    // The queued hook promotes `first`; runTurn is now suspended inside the
    // scheduling pass.
    await vi.waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(1)
    })
    expect(first.status).toBe('queued')
    const thread = await h.threadStore.get('thr_gate')
    const firstRunning = thread?.turns.find((turn) => turn.status === 'running')
    expect(firstRunning).toBeDefined()

    // A second queue commit lands mid-pass: the hook must append to the
    // fresh ready queue and force another pass, not get swallowed.
    const second = await h.turns.enqueueTurn({
      threadId: 'thr_gate',
      request: { prompt: 'second', model: 'deepseek-v4-pro' }
    })
    expect(second.status).toBe('queued')

    // Let the suspended turn finish and settle; the queued `second` must be
    // promoted afterwards.
    releaseFirst?.()
    await h.turns.finishTurn({
      threadId: 'thr_gate',
      turnId: firstRunning!.id,
      status: 'completed'
    })

    await vi.waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(2)
    })
    expect(runTurn.mock.calls[1]).toEqual(['thr_gate', second.turnId])
    const after = await h.threadStore.get('thr_gate')
    expect(after?.turns.find((turn) => turn.id === second.turnId)?.status).toBe('running')
  })
})
