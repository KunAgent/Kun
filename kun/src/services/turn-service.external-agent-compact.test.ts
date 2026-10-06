import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord, finishTurn } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { TurnConflictError } from './turn-service-core.js'

async function fixture(harnessId: string | undefined) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso: () => '2026-10-06T00:00:00.000Z' })
  const service = new TurnService({ threadStore, sessionStore, events, inflight: new InflightTracker(),
    steering: new SteeringQueue(), compactor: new ContextCompactor(), usage: undefined,
    prefix: createImmutablePrefix({ systemPrompt: 'System', pinnedConstraints: [] }),
    defaultModel: 'default-model', contextCompaction: { summaryMode: 'heuristic' },
    ids: new SequentialIdGenerator(), nowIso: () => '2026-10-06T00:00:00.000Z' })
  const threadId = 'thread', turnId = 'turn-1'
  const items: TurnItem[] = [
    makeUserItem({ id: 'item_1', threadId, turnId, text: 'First request with enough words to compact later.' }),
    makeAssistantTextItem({ id: 'item_2', threadId, turnId, text: 'A long answer that the heuristic summary would fold away.', status: 'completed' }),
    makeUserItem({ id: 'item_3', threadId, turnId, text: 'Second request.' }),
    makeAssistantTextItem({ id: 'item_4', threadId, turnId, text: 'Tail answer.', status: 'completed' })
  ]
  let turn = { ...createTurnRecord({ id: turnId, threadId, prompt: 'Task', status: 'completed' }), ...(harnessId ? { harnessId } : {}) }
  for (const item of items) { turn = appendTurnItem(turn, item); await sessionStore.appendItem(threadId, item) }
  await threadStore.upsert({ ...createThreadRecord({ id: threadId, title: 'T', workspace: '/tmp/w', model: 'test' }),
    ...(harnessId ? { harnessId } : {}), turns: [finishTurn(turn, 'completed')] })
  return { service, sessionStore, threadId }
}

describe('compaction of external-Agent threads', () => {
  it('refuses manual compaction and skips the memory-pressure sweep without touching history', async () => {
    const f = await fixture('devin')
    await expect(f.service.compact({ threadId: f.threadId, request: { reason: 'user ran /compact' } }))
      .rejects.toBeInstanceOf(TurnConflictError)
    expect(await f.service.compact({ threadId: f.threadId, request: { reason: 'memory_pressure' }, auto: true }))
      .toMatchObject({ replacedTokens: 0 })
    expect((await f.sessionStore.loadItems(f.threadId)).some((item) => item.kind === 'compaction')).toBe(false)
  })

  it('still compacts native Kun threads', async () => {
    const f = await fixture(undefined)
    expect((await f.service.compact({ threadId: f.threadId, request: { reason: 'user ran /compact' } })).replacedTokens)
      .toBeGreaterThan(0)
  })
})
