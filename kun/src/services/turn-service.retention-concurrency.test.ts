import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadStoreConditionalWrite } from '../ports/thread-store.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

class BlockingCasThreadStore extends InMemoryThreadStore {
  readonly casStarted: Promise<void>
  private readonly casRelease: Promise<void>
  private resolveCasStarted!: () => void
  private resolveCasRelease!: () => void
  private block = true

  constructor() {
    super()
    this.casStarted = new Promise((resolve) => { this.resolveCasStarted = resolve })
    this.casRelease = new Promise((resolve) => { this.resolveCasRelease = resolve })
  }

  releaseCas(): void { this.resolveCasRelease() }

  override async upsertIfRevision(
    thread: ThreadRecord,
    expectedRevision: number
  ): Promise<ThreadStoreConditionalWrite> {
    if (this.block) {
      this.block = false
      this.resolveCasStarted()
      await this.casRelease
    }
    return super.upsertIfRevision(thread, expectedRevision)
  }
}

function service(threadStore: InMemoryThreadStore, sessionStore = new InMemorySessionStore()): TurnService {
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

describe('ThreadStore conditional writes', () => {
  it('rejects a stale snapshot without replacing the durable record', async () => {
    const store = new InMemoryThreadStore()
    const initial = await store.upsert(createThreadRecord({
      id: 'thr_cas', title: 'Initial', workspace: '/tmp', model: 'test'
    }))
    const first = await store.upsertIfRevision({ ...initial, title: 'Fresh' }, initial.revision ?? 0)
    const stale = await store.upsertIfRevision({ ...initial, title: 'Stale' }, initial.revision ?? 0)

    expect(first).toMatchObject({ applied: true, revision: 1 })
    expect(stale).toEqual({ applied: false, revision: 1 })
    expect((await store.get('thr_cas'))?.title).toBe('Fresh')
  })
})

describe('TurnService retention pruning', () => {
  it('serializes retention CAS with startTurn and preserves the admitted turn', async () => {
    const threadStore = new BlockingCasThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turns = service(threadStore, sessionStore)
    const threadId = 'thr_retention_race'
    await threadStore.upsert(createThreadRecord({
      id: threadId, title: 'Retention', workspace: '/tmp', model: 'test'
    }))

    const pruning = turns.pruneThread({
      threadId,
      request: { keepLastTurns: 1, archiveBeforePrune: true }
    })
    await threadStore.casStarted
    let started = false
    const starting = turns.startTurn({ threadId, request: { prompt: 'must survive pruning' } })
      .then((value) => { started = true; return value })
    await Promise.resolve()
    expect(started).toBe(false)

    threadStore.releaseCas()
    await pruning
    const accepted = await starting
    const record = await threadStore.get(threadId)

    expect(record?.retentionPolicy).toEqual({ keepLastTurns: 1, archiveBeforePrune: true })
    expect(record?.turns).toHaveLength(1)
    expect(record?.turns[0]).toMatchObject({ id: accepted.turnId, status: 'running' })
    expect(await sessionStore.loadItems(threadId)).toContainEqual(expect.objectContaining({
      id: accepted.userMessageItemId,
      kind: 'user_message'
    }))
    await expect(turns.finishTurn({ threadId, turnId: accepted.turnId, status: 'completed' }))
      .resolves.toMatchObject({ kind: 'applied' })
  })
})
