import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { makeModelContextItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { executableHistory } from '../loop/executable-history.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

const threadId = 'thread_manual_queue'
async function fixture() {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const requests: ModelRequest[] = []
  const model: ModelClient = {
    model: 'test', provider: 'test',
    async *stream(request) {
      requests.push(request)
      yield { kind: 'assistant_text_delta', text: 'Only completed history.' }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
  const eventBus = new InMemoryEventBus()
  const compactor = new ContextCompactor()
  const compact = vi.spyOn(compactor, 'compact')
  const turns = new TurnService({
    threadStore, sessionStore, compactor, model,
    prefix: createImmutablePrefix({ systemPrompt: 'stable' }),
    inflight: new InflightTracker(), steering: new SteeringQueue(), ids: new SequentialIdGenerator(),
    events: new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso: () => new Date().toISOString() }),
    contextCompaction: { summaryMode: 'model' }, nowIso: () => new Date().toISOString()
  })
  const executed = createTurnRecord({ id: 'executed', threadId, prompt: 'finished work', status: 'completed', providerId: 'executed-provider' })
  const queued = createTurnRecord({ id: 'queued', threadId, prompt: 'NOT_EXECUTED_queued', providerId: 'queued-provider' })
  const cancelled = { ...createTurnRecord({ id: 'cancelled', threadId, prompt: 'NOT_EXECUTED_cancelled', status: 'aborted' }), terminalCode: 'queue_cancelled' }
  const rejected = { ...createTurnRecord({ id: 'rejected', threadId, prompt: 'NOT_EXECUTED_rejected', status: 'failed' }), terminalCode: 'queue_admission_failed' }
  const stale = { ...createTurnRecord({ id: 'stale', threadId, prompt: 'NOT_EXECUTED_stale', status: 'failed' }), terminalCode: 'write_context_stale' }
  await threadStore.upsert({ ...createThreadRecord({ id: threadId, title: 'test', workspace: '/tmp', model: 'test' }), turns: [executed, cancelled, rejected, stale, queued] })
  const protectedItems = [queued, cancelled, rejected, stale].flatMap((turn) => [
    makeUserItem({ id: `${turn.id}-user`, threadId, turnId: turn.id, text: turn.prompt }),
    makeModelContextItem({ id: `${turn.id}-context`, threadId, turnId: turn.id, stepIndex: 0,
      contentDigest: turn.id, text: `${turn.prompt} context`,
      blocks: [{ key: `memory:${turn.id}`, kind: 'memory', authority: 'runtime', state: 'active', content: `${turn.prompt} context` }] })
  ])
  const items = Array.from({ length: 8 }, (_, index) => makeUserItem({
    id: `past-${index}`, threadId, turnId: executed.id, text: `Completed step ${index} ${'history '.repeat(40)}`
  }))
  items.splice(1, 0, ...protectedItems)
  for (const item of items) await sessionStore.appendItem(threadId, item)
  return { turns, requests, compact, threadStore, sessionStore, protectedItems, items }
}

describe('TurnService manual compaction queue isolation', () => {
  it('binds the summary to executed work and preserves all unexecuted canonical input', async () => {
    const f = await fixture()
    const result = await f.turns.compact({ threadId, request: { reason: 'manual test' } })

    expect(result.replacedTokens).toBeGreaterThan(0)
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0]).toMatchObject({ turnId: 'executed', providerId: 'executed-provider' })
    expect(JSON.stringify(f.requests)).not.toContain('NOT_EXECUTED_')
    for (const [input] of f.compact.mock.calls) expect(JSON.stringify(input.history)).not.toContain('NOT_EXECUTED_')
    const saved = await f.sessionStore.loadItems(threadId)
    expect(saved.filter((item) => f.protectedItems.some((entry) => entry.id === item.id))).toEqual(f.protectedItems)
    const projected = effectiveHistoryAfterLatestCompaction(executableHistory(saved, await f.threadStore.get(threadId)))
    expect(projected[0]).toMatchObject({ kind: 'compaction', turnId: 'executed' })
    expect(JSON.stringify(projected)).not.toContain('NOT_EXECUTED_')
  })

  it.each(['queued', 'cancelled', 'rejected', 'stale'])('rejects explicit unexecuted summary owner %s without rewriting history', async (turnId) => {
    const f = await fixture()
    await expect(f.turns.compact({ threadId, turnId, request: {} })).rejects.toThrow(/executable/)
    expect(f.requests).toHaveLength(0)
    expect(await f.sessionStore.loadItems(threadId)).toEqual(f.items)
  })

  it('rejects a queued archive cutoff before summarizing or rewriting', async () => {
    const f = await fixture()
    await expect(f.turns.compact({ threadId, request: { cutoffTurnId: 'queued', archiveBeforePrune: false } })).rejects.toThrow()
    expect(f.requests).toHaveLength(0)
    expect(await f.sessionStore.loadItems(threadId)).toEqual(f.items)
  })

  it('filters newly enqueued input from a conflicting manual compaction retry', async () => {
    const f = await fixture()
    const rewrite = f.sessionStore.rewriteItemsIfRevision.bind(f.sessionStore)
    vi.spyOn(f.sessionStore, 'rewriteItemsIfRevision').mockImplementationOnce(async () => {
      const current = (await f.threadStore.get(threadId))!
      await f.threadStore.upsert({ ...current, turns: [...current.turns, createTurnRecord({ id: 'late', threadId, prompt: 'NOT_EXECUTED_late' })] })
      await f.sessionStore.appendItem(threadId, makeUserItem({ id: 'late-user', threadId, turnId: 'late', text: 'NOT_EXECUTED_late' }))
      return { applied: false, reason: 'conflict', revision: 100 }
    }).mockImplementation(rewrite)
    await f.turns.compact({ threadId, request: {} })
    expect(f.requests).toHaveLength(1)
    for (const [input] of f.compact.mock.calls) expect(JSON.stringify(input.history)).not.toContain('NOT_EXECUTED_')
    expect(await f.sessionStore.loadItems(threadId)).toContainEqual(expect.objectContaining({ id: 'late-user', text: 'NOT_EXECUTED_late' }))
  })
})
