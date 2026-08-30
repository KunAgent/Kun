import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import type { StartTurnRequest } from '../../contracts/turns.js'
import { createThreadRecord } from '../../domain/thread.js'
import { ContextCompactor } from '../../loop/context-compactor.js'
import { InflightTracker } from '../../loop/inflight-tracker.js'
import { SteeringQueue } from '../../loop/steering-queue.js'
import { SequentialIdGenerator } from '../../ports/id-generator.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { TurnService } from '../../services/turn-service.js'
import type { JsonResponse } from '../response.js'
import { startTurn } from './turns.js'

describe('scheduled send turn admission', () => {
  it('admits repeated wakeups with the same key exactly once', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-30T10:00:00.000Z'
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
      nowIso
    })
    const threadId = 'thread-scheduled-send'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Existing conversation',
      workspace: '/tmp/workspace',
      model: 'model-a',
      providerId: 'provider-a',
      accountId: 'account-a'
    }))
    const requestBody: StartTurnRequest = {
      prompt: 'Continue the existing investigation',
      clientRequestId: 'scheduled-send:task-1:dispatch-1',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'model-a',
      reasoningEffort: 'high'
    }
    const request = () => new Request(`http://kun.local/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    const onStarted = vi.fn()

    const [first, duplicate] = await Promise.all([
      startTurn(turns, threadId, request(), onStarted),
      startTurn(turns, threadId, request(), onStarted)
    ]) as JsonResponse[]

    expect(first.status).toBe(202)
    expect(duplicate.status).toBe(202)
    expect(JSON.parse(duplicate.body)).toEqual(JSON.parse(first.body))
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect((await threadStore.get(threadId))?.turns).toHaveLength(1)
    expect((await sessionStore.loadItems(threadId)).filter((item) => item.kind === 'user_message'))
      .toHaveLength(1)
    expect((await sessionStore.loadEventsSince(threadId, 0)).filter((event) => event.kind === 'turn_started'))
      .toHaveLength(1)
  })
})
