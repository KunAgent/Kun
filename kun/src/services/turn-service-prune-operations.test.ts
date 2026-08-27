import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

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

describe('prune without snapshots configured', () => {
  it('prunes nothing on a fresh thread but still records the policy', async () => {
    const threadStore = new InMemoryThreadStore()
    const turns = service(threadStore)
    const threadId = 'thr_fresh'
    await threadStore.upsert(createThreadRecord({
      id: threadId, title: 'Fresh', workspace: '/tmp', model: 'test'
    }))
    const response = await turns.pruneThread({
      threadId,
      request: { keepLastTurns: 1, archiveBeforePrune: true }
    })
    expect(response.pruned).toBe(false)
    expect((await threadStore.get(threadId))?.retentionPolicy).toEqual({
      keepLastTurns: 1, archiveBeforePrune: true
    })
  })

  it('preview reports nothing_to_prune on a fresh thread', async () => {
    const threadStore = new InMemoryThreadStore()
    const turns = service(threadStore)
    const threadId = 'thr_preview'
    await threadStore.upsert(createThreadRecord({
      id: threadId, title: 'P', workspace: '/tmp', model: 'test'
    }))
    const preview = await turns.previewThreadPrune({
      threadId,
      request: { keepLastTurns: 1, archiveBeforePrune: true }
    })
    expect(preview.blockedBy).toEqual(['nothing_to_prune'])
    expect(preview.threadRevision).toBeUndefined()
  })

  it('listThreadSnapshots returns empty without a configured store', async () => {
    const threadStore = new InMemoryThreadStore()
    const turns = service(threadStore)
    const threadId = 'thr_snaps'
    await threadStore.upsert(createThreadRecord({
      id: threadId, title: 'S', workspace: '/tmp', model: 'test'
    }))
    const result = await turns.listThreadSnapshots({ threadId })
    expect(result.snapshots).toEqual([])
  })
})
