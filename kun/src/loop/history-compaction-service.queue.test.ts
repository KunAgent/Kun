import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import { makeModelContextItem, makeToolCallItem, makeToolResultItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord, startTurn } from '../domain/turn.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { UsageService } from '../services/usage-service.js'
import { ContextCompactor } from './context-compactor.js'
import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'
import { executableHistory } from './executable-history.js'
import { HistoryCompactionService } from './history-compaction-service.js'

const threadId = 'thread_queue_compaction'
const turnId = 'active'

async function fixture() {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const past = Array.from({ length: 5 }, (_, index) => createTurnRecord({
    id: `past-${index}`, threadId, prompt: `past ${index}`, status: 'completed'
  }))
  const hidden = ['queued', 'cancelled', 'rejected', 'stale'].map((id, index) => ({
    ...createTurnRecord({ id, threadId, prompt: `DO_NOT_EXECUTE_${id}`, status: index === 0 ? 'queued' : index === 1 ? 'aborted' : 'failed' }),
    ...(index ? { terminalCode: ['queue_cancelled', 'queue_admission_failed', 'write_context_stale'][index - 1] } : {})
  }))
  await threadStore.upsert({
    ...createThreadRecord({ id: threadId, title: 'test', workspace: '/tmp', model: 'test' }),
    turns: [...past, startTurn(createTurnRecord({ id: turnId, threadId, prompt: 'active request' })), ...hidden]
  })
  const protectedItems: TurnItem[] = hidden.flatMap((turn) => [
    makeUserItem({ id: `${turn.id}-user`, threadId, turnId: turn.id, text: turn.prompt }),
    makeModelContextItem({
      id: `${turn.id}-context`, threadId, turnId: turn.id, stepIndex: 0,
      contentDigest: turn.id, text: `${turn.prompt} context`,
      blocks: [{ key: `memory:${turn.id}`, kind: 'memory', authority: 'runtime', state: 'active', content: `${turn.prompt} context` }]
    })
  ])
  const history = past.map((turn) => makeUserItem({
    id: `${turn.id}-user`, threadId, turnId: turn.id, text: `${turn.prompt} ${'history '.repeat(100)}`
  }))
  history.splice(2, 0, ...protectedItems)
  history.push(makeUserItem({ id: 'active-user', threadId, turnId, text: 'active request' }))
  history.push(makeToolCallItem({ id: 'call', threadId, turnId, callId: 'call-id', toolName: 'read', arguments: {}, status: 'completed' }))
  history.push(makeToolResultItem({ id: 'result', threadId, turnId, callId: 'call-id', toolName: 'read', output: 'read result' }))
  for (const item of history) await sessionStore.appendItem(threadId, item)
  const requests: ModelRequest[] = []
  const model: ModelClient = {
    provider: 'test', model: 'test',
    async *stream(request) {
      requests.push(request)
      yield { kind: 'assistant_text_delta', text: 'Summary of executed work only.' }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
  const bus = new InMemoryEventBus()
  const compactor = new ContextCompactor({ softThreshold: 100_000, hardThreshold: 200_000 })
  const compact = vi.spyOn(compactor, 'compact')
  const service = new HistoryCompactionService({
    sessionStore, threadStore, compactor, model,
    prefix: createImmutablePrefix({ systemPrompt: 'stable prefix' }),
    usage: new UsageService(),
    events: new RuntimeEventRecorder({ eventBus: bus, sessionStore, allocateSeq: (id) => bus.allocateSeq(id), nowIso: () => new Date().toISOString() }),
    ids: new SequentialIdGenerator(), telemetry: { consumePromptPressure: () => undefined },
    getContextCompaction: () => ({ summaryMode: 'model' }),
    recordGoalUsage: async () => {}, rewriteThreadItemsFromSession: async () => {}
  })
  const input = {
    items: executableHistory(history, await threadStore.get(threadId)),
    model: 'test', signal: new AbortController().signal, threadId, turnId,
    force: { reason: 'test', keepRecent: 1 }
  }
  return { service, input, sessionStore, threadStore, requests, compact, protectedItems, history }
}

describe('HistoryCompactionService queued-input isolation', () => {
  it('excludes unexecuted input from summaries while preserving its canonical user and context items', async () => {
    const f = await fixture()
    const outcome = await f.service.compactIfNeeded(f.input)

    expect(outcome.compacted).toBe(true)
    expect(f.requests).toHaveLength(1)
    expect(JSON.stringify(f.requests[0])).not.toContain('DO_NOT_EXECUTE_')
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
    for (const [request] of f.compact.mock.calls) expect(JSON.stringify(request.history)).not.toContain('DO_NOT_EXECUTE_')
    const saved = await f.sessionStore.loadItems(threadId)
    expect(saved.filter((item) => f.protectedItems.some((protectedItem) => protectedItem.id === item.id))).toEqual(f.protectedItems)
    expect(saved.filter((item) => item.id === 'call' || item.id === 'result').map((item) => item.id)).toEqual(['call', 'result'])
    expect(outcome.history.filter((item) => item.id === 'call' || item.id === 'result').map((item) => item.id)).toEqual(['call', 'result'])
    expect(saved.findIndex((item) => item.id === 'queued-user')).toBeLessThan(saved.findIndex((item) => item.id === 'past-2-user'))

    const thread = (await f.threadStore.get(threadId))!
    await f.threadStore.upsert({
      ...thread,
      turns: thread.turns.map((turn) => turn.id === 'queued'
        ? { ...startTurn(turn), queueExecutionAnchorItemId: 'result' }
        : turn.id === turnId ? { ...turn, status: 'completed' as const } : turn)
    })
    const promoted = effectiveHistoryAfterLatestCompaction(executableHistory(saved, await f.threadStore.get(threadId)))
    // Promotion relocates the original user input, while system records keep
    // their canonical positions. Their byte-preserving survival is checked above.
    expect(promoted.filter((item) => item.id === 'queued-user')).toEqual(f.protectedItems.slice(0, 1))
    expect(promoted.findIndex((item) => item.id === 'result')).toBeLessThan(promoted.findIndex((item) => item.id === 'queued-user'))
  })

  it('reprojects a conflicting snapshot and preserves newly enqueued input on the retry', async () => {
    const f = await fixture()
    const rewrite = f.sessionStore.rewriteItemsIfRevision.bind(f.sessionStore)
    vi.spyOn(f.sessionStore, 'rewriteItemsIfRevision').mockImplementationOnce(async () => {
      const thread = (await f.threadStore.get(threadId))!
      await f.threadStore.upsert({ ...thread, turns: [...thread.turns, createTurnRecord({ id: 'late', threadId, prompt: 'DO_NOT_EXECUTE_late' })] })
      await f.sessionStore.appendItem(threadId, makeUserItem({ id: 'late-user', threadId, turnId: 'late', text: 'DO_NOT_EXECUTE_late' }))
      return { applied: false, reason: 'conflict', revision: 100 }
    }).mockImplementation(rewrite)
    const outcome = await f.service.compactIfNeeded(f.input)

    expect(outcome.compacted).toBe(true)
    expect(f.requests).toHaveLength(1)
    for (const [request] of f.compact.mock.calls) expect(JSON.stringify(request.history)).not.toContain('DO_NOT_EXECUTE_')
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
    expect(await f.sessionStore.loadItems(threadId)).toContainEqual(expect.objectContaining({ id: 'late-user', text: 'DO_NOT_EXECUTE_late' }))
  })

  it('filters the fresh fallback after all history CAS attempts conflict', async () => {
    const f = await fixture()
    vi.spyOn(f.sessionStore, 'rewriteItemsIfRevision').mockResolvedValue({ applied: false, reason: 'conflict', revision: 100 })
    const outcome = await f.service.compactIfNeeded(f.input)

    expect(outcome.compacted).toBe(false)
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
    expect(await f.sessionStore.loadItems(threadId)).toEqual(f.history)
  })

  it('filters unexecuted input even when no compaction plan is needed', async () => {
    const f = await fixture()
    const outcome = await f.service.compactIfNeeded({ ...f.input, items: f.history, force: undefined })

    expect(outcome.compacted).toBe(false)
    expect(f.requests).toHaveLength(0)
    expect(JSON.stringify(outcome.history)).not.toContain('DO_NOT_EXECUTE_')
  })
})
