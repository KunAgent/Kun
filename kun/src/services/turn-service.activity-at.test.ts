import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ThreadListSummarySchema, ThreadSchema } from '../contracts/threads.js'
import { makeAssistantTextItem, makeToolCallItem } from '../domain/item.js'
import { createThreadRecord, toThreadSummary } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { rowFromIndexRecord, summaryFromRow } from '../adapters/hybrid/hybrid-thread-index-mapping.js'

async function harness() {
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  const nowIso = () => new Date(now).toISOString()
  const threads = new InMemoryThreadStore()
  const sessions = new InMemorySessionStore()
  const events = new InMemoryEventBus()
  const turns = new TurnService({
    threadStore: threads,
    sessionStore: sessions,
    steering: new SteeringQueue(),
    events: new RuntimeEventRecorder({
      eventBus: events,
      sessionStore: sessions,
      allocateSeq: (id: string) => events.allocateSeq(id),
      nowIso
    }),
    inflight: new InflightTracker(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso
  })
  await threads.upsert(createThreadRecord({ id: 'thread', title: 'Activity', workspace: '/tmp', model: 'test', createdAt: nowIso() }))
  return { threads, turns, nowIso, advance: () => { now += 1000 } }
}

describe('stable conversation activity timestamp', () => {
  it('survives durable and lean index projections without reading history', () => {
    const thread = createThreadRecord({ id: 'thread', title: 'Fresh', workspace: '/tmp', model: 'test', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(thread.activityAt).toBe(thread.createdAt)
    expect(toThreadSummary(thread).activityAt).toBe(thread.createdAt)
    expect(ThreadListSummarySchema.parse(toThreadSummary(thread)).activityAt).toBe(thread.createdAt)
    expect(ThreadSchema.parse(JSON.parse(JSON.stringify(thread))).activityAt).toBe(thread.createdAt)
    const row = rowFromIndexRecord({ thread, messageCount: 0, eventSeqHighWater: 0, preview: '' }, {
      metadataPath: '/tmp/thread', messagesPath: '/tmp/messages', eventsPath: '/tmp/events'
    })
    expect(summaryFromRow(row).activityAt).toBe(thread.createdAt)
  })

  it('does not move for assistant and tool item writes', async () => {
    const h = await harness()
    const started = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Ship it' } })
    const acceptedAt = (await h.threads.get('thread'))!.activityAt
    h.advance()
    await h.turns.applyItem('thread', makeAssistantTextItem({
      id: 'item_text', threadId: 'thread', turnId: started.turnId, text: 'Working', createdAt: h.nowIso()
    }))
    await h.turns.applyItem('thread', makeToolCallItem({
      id: 'item_tool', threadId: 'thread', turnId: started.turnId,
      callId: 'call_1', toolName: 'read_file', arguments: { path: '/tmp/file.txt' }
    }))
    const after = (await h.threads.get('thread'))!
    expect(after.updatedAt).toBe(h.nowIso())
    expect(after.activityAt).toBe(acceptedAt)
  })

  it('moves for accepted input, steering and a completed turn', async () => {
    const h = await harness()
    h.advance()
    const started = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'First' } })
    expect((await h.threads.get('thread'))!.activityAt).toBe(h.nowIso())
    h.advance()
    await h.turns.steerTurn({ threadId: 'thread', turnId: started.turnId, text: 'Also this' })
    expect((await h.threads.get('thread'))!.activityAt).toBe(h.nowIso())
    h.advance()
    await h.turns.finishTurn({ threadId: 'thread', turnId: started.turnId, status: 'completed' })
    expect((await h.threads.get('thread'))!.activityAt).toBe(h.nowIso())
  })

  it('moves once for an accepted queued send and not for its idempotent replay', async () => {
    const h = await harness()
    await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Working' } })
    h.advance()
    const request = { prompt: 'Queued', clientRequestId: 'queued-activity', enqueueIfBusy: true }
    const queued = await h.turns.startTurn({ threadId: 'thread', request })
    const acceptedAt = h.nowIso()
    expect(queued.status).toBe('queued')
    expect((await h.threads.get('thread'))!.activityAt).toBe(acceptedAt)
    h.advance()
    expect((await h.turns.startTurn({ threadId: 'thread', request })).turnId).toBe(queued.turnId)
    expect((await h.threads.get('thread'))!.activityAt).toBe(acceptedAt)
  })

  it('moves for Stop, but not for cancelling an unstarted queued turn', async () => {
    const h = await harness()
    const started = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Working' } })
    const queued = await h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Queued', clientRequestId: 'queued-1', enqueueIfBusy: true
    } })
    const acceptedAt = (await h.threads.get('thread'))!.activityAt
    h.advance()
    await h.turns.interruptTurn({ threadId: 'thread', turnId: queued.turnId })
    expect((await h.threads.get('thread'))!.activityAt).toBe(acceptedAt)
    h.advance()
    await h.turns.interruptTurn({ threadId: 'thread', turnId: started.turnId })
    expect((await h.threads.get('thread'))!.activityAt).toBe(h.nowIso())
  })
})
