import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ThreadExecutionLeasePort } from '../ports/thread-execution-lease.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

describe('TurnService host-shutdown admission barrier', () => {
  it('closes new admission and waits for an already-entered start to settle', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-30T12:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    for (const id of ['thread-entered', 'thread-late']) {
      await threadStore.upsert(createThreadRecord({
        id,
        title: id,
        workspace: '/tmp/workspace',
        model: 'test-model'
      }))
    }

    let resolveAcquire!: (lease: ThreadExecutionLease) => void
    const acquireGate = new Promise<ThreadExecutionLease>((resolve) => {
      resolveAcquire = resolve
    })
    const acquire = vi.fn(async () => acquireGate)
    let releaseDispatch!: () => void
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve })
    const onAdmitted = vi.fn(async () => dispatchGate)
    const executionLeases: ThreadExecutionLeasePort = {
      acquire,
      release: vi.fn(async () => undefined),
      owner: vi.fn(async () => null),
      shutdown: vi.fn(async () => undefined)
    }
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso,
      executionLeases
    })

    const entered = turns.startTurn({
      threadId: 'thread-entered',
      request: { prompt: 'already entering' }
    }, { onAdmitted })
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())

    let barrierSettled = false
    const barrier = turns.closeAdmissionForShutdown().then(() => {
      barrierSettled = true
    })
    await Promise.resolve()
    expect(barrierSettled).toBe(false)
    await expect(turns.startTurn({
      threadId: 'thread-late',
      request: { prompt: 'too late' }
    })).rejects.toThrow('runtime is shutting down')
    await expect(turns.resumeGraphPlanningTurn({
      threadId: 'thread-entered',
      turnId: 'turn-late'
    })).rejects.toThrow('runtime is shutting down')

    resolveAcquire({
      threadId: 'thread-entered',
      turnId: 'turn_1',
      ownerFlavor: 'production',
      ownerInstanceId: 'runtime-1',
      fencingToken: 1,
      acquiredAt: nowIso(),
      expiresAt: '2026-08-30T12:01:00.000Z'
    })
    await vi.waitFor(() => expect(onAdmitted).toHaveBeenCalledOnce())
    expect(barrierSettled).toBe(false)
    releaseDispatch()
    await entered
    await barrier
    expect(barrierSettled).toBe(true)
  })

  it('atomically rejects restart recovery after a newer turn becomes latest', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-30T12:00:00.000Z'
    const threadId = 'thread-recovery-race'
    await threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'recovery race',
        workspace: '/tmp/workspace',
        model: 'test-model'
      }),
      turns: [
        createTurnRecord({
          id: 'turn-proven-source',
          threadId,
          prompt: 'interrupted work',
          status: 'failed'
        }),
        createTurnRecord({
          id: 'turn-newer',
          threadId,
          prompt: 'newer work',
          status: 'failed'
        })
      ]
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (id) => eventBus.allocateSeq(id),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })

    await expect(turns.startTurn({
      threadId,
      request: { prompt: 'automatic restart continuation' }
    }, {
      expectedLatestFailedTurnId: 'turn-proven-source'
    })).rejects.toThrow('restart recovery source is no longer latest: turn-proven-source')

    expect((await threadStore.get(threadId))?.turns.map((turn) => turn.id)).toEqual([
      'turn-proven-source',
      'turn-newer'
    ])
    expect(await sessionStore.loadItems(threadId)).toEqual([])
  })
})
