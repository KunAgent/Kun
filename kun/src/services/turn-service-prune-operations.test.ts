import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { createTurnRecord } from '../domain/turn.js'
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
  it('prunes completed history without reacquiring its own thread mutation lock', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const turns = service(threadStore, sessionStore)
    const threadId = 'thr_completed_prune'
    const first = createTurnRecord({ id: 'old', threadId, prompt: 'older request', status: 'completed' })
    const second = createTurnRecord({ id: 'recent', threadId, prompt: 'retain this request', status: 'completed' })
    const items = [
      makeUserItem({ id: 'old-user', threadId, turnId: first.id, text: first.prompt }),
      makeAssistantTextItem({ id: 'old-answer', threadId, turnId: first.id, text: 'completed answer' }),
      makeUserItem({ id: 'recent-user', threadId, turnId: second.id, text: second.prompt })
    ]
    await sessionStore.rewriteItems(threadId, items)
    await threadStore.upsert({
      ...createThreadRecord({ id: threadId, title: 'Prune', workspace: '/tmp', model: 'test' }),
      turns: [first, second].map((turn) => ({ ...turn, items: items.filter((item) => item.turnId === turn.id) }))
    })
    const result = await turns.pruneThread({
      threadId, request: { throughTurnId: first.id, archiveBeforePrune: false }
    })
    expect(result).toMatchObject({ pruned: true, removedTurns: 1 })
    expect((await sessionStore.loadItems(threadId)).filter((item) => item.kind === 'user_message'))
      .toEqual([expect.objectContaining({ turnId: second.id, text: 'retain this request' })])
  })

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
