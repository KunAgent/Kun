import { describe, expect, it, vi } from 'vitest'
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
import { flushDurableSteering } from './durable-steering.js'
import { executableHistory } from '../loop/executable-history.js'

async function harness() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const steering = new SteeringQueue()
  const nowIso = () => new Date().toISOString()
  const turns = new TurnService({ threadStore, sessionStore, steering,
    events: new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso }),
    inflight: new InflightTracker(), compactor: new ContextCompactor(), ids: new SequentialIdGenerator(), nowIso })
  await threadStore.upsert(createThreadRecord({ id: 'thread', title: 'test', workspace: '/tmp', model: 'test' }))
  const a = await turns.startTurn({ threadId: 'thread', request: { prompt: 'A' } })
  const b = await turns.startTurn({ threadId: 'thread', request: { prompt: 'B', enqueueIfBusy: true, clientRequestId: 'b' } })
  return { turns, threadStore, sessionStore, steering, a, b }
}

describe('durable queued-to-steering ownership', () => {
  it('persists accepted input before interruption clears execution state', async () => {
    const h = await harness()
    const input = { threadId: 'thread', turnId: h.a.turnId, sourceTurnId: h.b.turnId, operationId: 'stop-b', text: 'B' }
    await h.turns.steerTurn(input)
    await h.turns.interruptTurn({ threadId: 'thread', turnId: h.a.turnId })
    await h.turns.steerTurn(input)
    expect((await h.sessionStore.loadItems('thread')).filter((item) => item.id.startsWith('item_steered_'))).toHaveLength(1)
  })

  it('rejects changed retry payloads and oversized display text without consuming the source', async () => {
    const h = await harness()
    const input = { threadId: 'thread', turnId: h.a.turnId, sourceTurnId: h.b.turnId, operationId: 'guide-b', text: 'B' }
    await expect(h.turns.steerTurn({ ...input, displayText: 'x'.repeat(65537) })).rejects.toThrow('steering_capacity')
    expect((await h.turns.getTurn('thread', h.b.turnId))?.status).toBe('queued')
    await h.turns.steerTurn(input)
    await expect(h.turns.steerTurn({ ...input, text: 'changed' })).rejects.toThrow('steering_operation_conflict')
  })

  it('atomically consumes the queued source and makes retries idempotent', async () => {
    const h = await harness()
    const input = { threadId: 'thread', turnId: h.a.turnId, sourceTurnId: h.b.turnId, operationId: 'guide-b', text: 'B' }
    expect(executableHistory(await h.sessionStore.loadItems('thread'), await h.threadStore.get('thread'))
      .filter((item) => item.kind === 'user_message').map((item) => item.text)).toEqual(['A'])
    await Promise.all([h.turns.steerTurn(input), h.turns.steerTurn(input)])
    expect((await h.turns.getTurn('thread', h.b.turnId))?.status).toBe('aborted')
    expect(h.steering.sealIfEmpty(h.a.turnId)).toBe(false)
    await flushDurableSteering(h.turns, 'thread', h.a.turnId)
    await flushDurableSteering(h.turns, 'thread', h.a.turnId)
    await h.turns.steerTurn(input)
    const history = executableHistory(await h.sessionStore.loadItems('thread'), await h.threadStore.get('thread'))
    expect(history.filter((item) => item.kind === 'user_message').map((item) => item.text)).toEqual(['A', 'B'])
    expect((await h.turns.getTurn('thread', h.a.turnId))?.steeringDeliveries).toHaveLength(1)
    expect(h.steering.sealIfEmpty(h.a.turnId)).toBe(true)
  })

  it('preserves the source when target sealing wins', async () => {
    const h = await harness()
    h.steering.sealIfEmpty(h.a.turnId)
    await expect(h.turns.steerTurn({ threadId: 'thread', turnId: h.a.turnId, sourceTurnId: h.b.turnId,
      operationId: 'guide-b', text: 'B' })).rejects.toThrow('steering_target_closed')
    expect((await h.turns.getTurn('thread', h.b.turnId))?.status).toBe('queued')
  })

  it('replays the same user item after a flush fails after its durable append', async () => {
    const h = await harness()
    await h.turns.steerTurn({ threadId: 'thread', turnId: h.a.turnId, sourceTurnId: h.b.turnId,
      operationId: 'guide-b', text: 'B' })
    const append = vi.spyOn(h.sessionStore, 'appendEvent').mockRejectedValueOnce(new Error('disk failure'))
    await expect(flushDurableSteering(h.turns, 'thread', h.a.turnId)).rejects.toThrow('disk failure')
    append.mockRestore()
    await flushDurableSteering(h.turns, 'thread', h.a.turnId)
    expect((await h.sessionStore.loadItems('thread')).filter((item) => item.id.startsWith('item_steered_'))).toHaveLength(1)
  })
})
