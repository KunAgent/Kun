import { describe, expect, it } from 'vitest'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord, finishTurn } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { COMPACTION_SYSTEM_PROMPT } from '../loop/compaction-summary.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { TurnItem } from '../contracts/items.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnCapacityError, TurnConflictError, TurnService } from './turn-service.js'
import { ThreadService } from './thread-service.js'
import { UsageService } from './usage-service.js'

class SummaryModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'summary-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield {
      kind: 'assistant_text_delta',
      text: [
        '## Goal',
        '- Continue the compacted task.',
        '## Completed',
        '- MODEL SUMMARY kept the durable state.'
      ].join('\n')
    }
    yield {
      kind: 'usage',
      usage: {
        ...emptyUsageSnapshot(),
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        turns: 1
      }
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class BlockingSummaryModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'blocking-summary-model'
  readonly requests: ModelRequest[] = []
  readonly summaryStarted: Promise<void>
  private readonly releaseSummary: Promise<void>
  private resolveStarted!: () => void
  private resolveRelease!: () => void

  constructor() {
    this.summaryStarted = new Promise<void>((resolve) => {
      this.resolveStarted = resolve
    })
    this.releaseSummary = new Promise<void>((resolve) => {
      this.resolveRelease = resolve
    })
  }

  release(): void {
    this.resolveRelease()
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    this.resolveStarted()
    await this.releaseSummary
    yield { kind: 'assistant_text_delta', text: 'Summary from the first snapshot.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class FailOnceAppendSessionStore extends InMemorySessionStore {
  private failNextAppend = true

  override async appendItem(threadId: string, item: TurnItem): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false
      throw new Error('append item failed')
    }
    await super.appendItem(threadId, item)
  }
}

describe('TurnService startTurn', () => {
  it('atomically admits only one active turn for a thread', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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
    const threadId = 'thr_single_active_turn'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Single active turn',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))

    const [first, second] = await Promise.allSettled([
      service.startTurn({ threadId, request: { prompt: 'first', model: 'm' } }),
      service.startTurn({ threadId, request: { prompt: 'second', model: 'm' } })
    ])

    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: expect.any(TurnConflictError) })
    const thread = await threadStore.get(threadId)
    expect(thread?.turns).toHaveLength(1)
    expect(thread?.turns[0]?.status).toBe('running')
    expect(await service.interruptActiveTurns()).toBe(1)
    expect((await threadStore.get(threadId))?.turns[0]?.status).toBe('aborted')
  })

  it('rejects an archived thread before creating a turn or consuming runtime capacity', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      maxConcurrentTurns: 1,
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_archived_start'
    const admittedThreadId = 'thr_archived_start_capacity'
    await Promise.all([threadId, admittedThreadId].map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id === threadId ? 'Archived thread' : 'Capacity check',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      ...(id === threadId ? { status: 'archived' as const } : {})
    }))))

    await expect(service.startTurn({
      threadId,
      request: { prompt: 'must not run', model: 'm' }
    })).rejects.toBeInstanceOf(TurnConflictError)

    expect((await threadStore.get(threadId))?.turns).toEqual([])
    expect(await sessionStore.loadItems(threadId)).toEqual([])
    expect(await sessionStore.loadEventsSince(threadId, 0)).toEqual([])
    const admitted = await service.startTurn({
      threadId: admittedThreadId,
      request: { prompt: 'capacity was not consumed', model: 'm' }
    })
    await service.interruptTurn({ threadId: admittedThreadId, turnId: admitted.turnId })
  })

  it('keeps archival as an overlay when active turns finish or are interrupted', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const ids = new SequentialIdGenerator()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const finishedThreadId = 'thr_archived_finish'
    const interruptedThreadId = 'thr_archived_interrupt'
    await Promise.all([finishedThreadId, interruptedThreadId].map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))))

    const finishing = await turns.startTurn({
      threadId: finishedThreadId,
      request: { prompt: 'finish after archival', model: 'm' }
    })
    await threads.update(finishedThreadId, { status: 'archived' })
    await turns.finishTurn({
      threadId: finishedThreadId,
      turnId: finishing.turnId,
      status: 'completed'
    })

    const finished = await threadStore.get(finishedThreadId)
    expect(finished?.status).toBe('archived')
    expect(finished?.turns.find((turn) => turn.id === finishing.turnId)?.status).toBe('completed')
    await expect(turns.startTurn({
      threadId: finishedThreadId,
      request: { prompt: 'still archived', model: 'm' }
    })).rejects.toBeInstanceOf(TurnConflictError)

    const interrupting = await turns.startTurn({
      threadId: interruptedThreadId,
      request: { prompt: 'interrupt after archival', model: 'm' }
    })
    await threads.update(interruptedThreadId, { status: 'archived' })
    await turns.interruptTurn({
      threadId: interruptedThreadId,
      turnId: interrupting.turnId
    })

    const interrupted = await threadStore.get(interruptedThreadId)
    expect(interrupted?.status).toBe('archived')
    expect(interrupted?.turns.find((turn) => turn.id === interrupting.turnId)?.status).toBe('aborted')
  })

  it('caps active turns across threads before persistence and releases slots when they settle', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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
      maxConcurrentTurns: 1,
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadIds = ['thr_capacity_a', 'thr_capacity_b', 'thr_capacity_c']
    await Promise.all(threadIds.map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))))

    const first = await service.startTurn({
      threadId: 'thr_capacity_a',
      request: { prompt: 'first', model: 'm' }
    })
    await expect(service.startTurn({
      threadId: 'thr_capacity_b',
      request: { prompt: 'rejected', model: 'm' }
    })).rejects.toBeInstanceOf(TurnCapacityError)

    // The rejected request must be invisible to both the durable turn history
    // and SSE replay, not merely left queued for a later scheduler pass.
    expect((await threadStore.get('thr_capacity_b'))?.turns).toEqual([])
    expect(await sessionStore.loadItems('thr_capacity_b')).toEqual([])
    expect(await sessionStore.loadEventsSince('thr_capacity_b', 0)).toEqual([])

    await service.finishTurn({
      threadId: 'thr_capacity_a',
      turnId: first.turnId,
      status: 'completed'
    })
    const second = await service.startTurn({
      threadId: 'thr_capacity_b',
      request: { prompt: 'admitted after completion', model: 'm' }
    })
    await service.interruptTurn({ threadId: 'thr_capacity_b', turnId: second.turnId })
    const third = await service.startTurn({
      threadId: 'thr_capacity_c',
      request: { prompt: 'admitted after interrupt', model: 'm' }
    })

    expect(third.threadId).toBe('thr_capacity_c')
    await service.interruptTurn({ threadId: 'thr_capacity_c', turnId: third.turnId })
  })

  it('releases an admission and aborts an already-persisted turn when startup fails', async () => {
    const sessionStore = new FailOnceAppendSessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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
      maxConcurrentTurns: 1,
      ids: new SequentialIdGenerator(),
      nowIso
    })
    await Promise.all(['thr_start_failure_a', 'thr_start_failure_b'].map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))))

    await expect(service.startTurn({
      threadId: 'thr_start_failure_a',
      request: { prompt: 'will fail while persisting', model: 'm' }
    })).rejects.toThrow('append item failed')

    expect((await threadStore.get('thr_start_failure_a'))?.turns[0]?.status).toBe('aborted')
    const recovered = await service.startTurn({
      threadId: 'thr_start_failure_b',
      request: { prompt: 'slot was released', model: 'm' }
    })
    await service.interruptTurn({ threadId: 'thr_start_failure_b', turnId: recovered.turnId })
  })

  it('rejects cross-thread interrupts and ignores a late loop finish after interrupt', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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
    await Promise.all(['thr_owner_a', 'thr_owner_b'].map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))))
    const started = await service.startTurn({
      threadId: 'thr_owner_b',
      request: { prompt: 'run', model: 'm' }
    })

    await expect(service.interruptTurn({
      threadId: 'thr_owner_a',
      turnId: started.turnId
    })).rejects.toThrow(/turn not found/)
    expect(service.getAbortController(started.turnId)?.aborted).toBe(false)

    await service.interruptTurn({ threadId: 'thr_owner_b', turnId: started.turnId })
    const lateSettlement = await service.finishTurn({
      threadId: 'thr_owner_b',
      turnId: started.turnId,
      status: 'completed'
    })

    const turn = await service.getTurn('thr_owner_b', started.turnId)
    expect(turn?.status).toBe('aborted')
    expect(lateSettlement).toEqual({ kind: 'already_terminal', status: 'aborted' })
    const events = await sessionStore.loadEventsSince('thr_owner_b', 0)
    expect(events.filter((event) => event.kind === 'turn_aborted')).toHaveLength(1)
    expect(events.some((event) => event.kind === 'turn_completed')).toBe(false)
  })

  it('persists per-turn provider ids for model routing', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thr_provider_turn',
      title: 'Provider turn',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))

    const started = await service.startTurn({
      threadId: 'thr_provider_turn',
      request: {
        prompt: 'hello',
        model: 'mimo-v2.5',
        providerId: 'xiaomi-token-plan'
      }
    })

    const thread = await threadStore.get('thr_provider_turn')
    const turn = thread?.turns.find((item) => item.id === started.turnId)
    expect(turn).toMatchObject({
      model: 'mimo-v2.5',
      providerId: 'xiaomi-token-plan'
    })
  })

  it('rejects steering that exceeds the active turn buffer without recording a phantom event', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const steering = new SteeringQueue({ maxEntriesPerTurn: 1, maxBytesPerTurn: 32 })
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering,
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_bounded_steering'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Bounded steering',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const started = await service.startTurn({ threadId, request: { prompt: 'run' } })

    await service.steerTurn({ threadId, turnId: started.turnId, text: 'first' })
    await expect(service.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'second'
    })).rejects.toThrow(TurnConflictError)

    expect(steering.peek(started.turnId)).toEqual([{ text: 'first' }])
    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    expect(runtimeEvents.filter((event) => event.kind === 'turn_steered')).toHaveLength(1)
    await service.interruptTurn({ threadId, turnId: started.turnId })
  })

  it('rejects guidance after the model loop seals its terminal boundary', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-16T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const steering = new SteeringQueue()
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering,
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_sealed_steering'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Sealed steering',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const started = await service.startTurn({ threadId, request: { prompt: 'run' } })
    expect(steering.sealIfEmpty(started.turnId)).toBe(true)

    await expect(service.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'too late'
    })).rejects.toThrow('turn is no longer accepting steering')

    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    expect(runtimeEvents.filter((event) => event.kind === 'turn_steered')).toHaveLength(0)
    await service.interruptTurn({ threadId, turnId: started.turnId })
  })
})

describe('TurnService compact', () => {
  it('uses model summaries for manual compaction while preserving visible history', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new SummaryModel()
    const prefix = createImmutablePrefix({
      systemPrompt: 'System prompt used by both chat and compaction.',
      pinnedConstraints: ['system: keep GUI HTTP/SSE stable']
    })
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      model,
      usage: new UsageService(),
      prefix,
      defaultModel: 'default-model',
      contextCompaction: {
        summaryMode: 'model',
        summaryTimeoutMs: 1_000,
        summaryMaxTokens: 400,
        summaryInputMaxBytes: 16_384
      },
      ids: new SequentialIdGenerator(),
      nowIso
    })

    const threadId = 'thr_manual_compact'
    const turnId = 'turn_1'
    const items: TurnItem[] = [
      makeUserItem({ id: 'item_1', threadId, turnId, text: 'Initial task: fix /compact.' }),
      makeAssistantTextItem({ id: 'item_2', threadId, turnId, text: 'I found the service path.', status: 'completed' }),
      makeUserItem({ id: 'item_3', threadId, turnId, text: 'Active Skill: retained-manual-tail-only\nPlease preserve this clue.' }),
      makeAssistantTextItem({ id: 'item_4', threadId, turnId, text: 'Recent tail A.', status: 'completed' }),
      makeUserItem({ id: 'item_5', threadId, turnId, text: 'Recent tail B.' }),
      makeAssistantTextItem({ id: 'item_6', threadId, turnId, text: 'Recent tail C.', status: 'completed' })
    ]
    let turn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'Initial task',
      model: 'turn-model',
      providerId: 'ext-manual-turn',
      accountId: 'account-manual-turn',
      status: 'completed'
    })
    for (const item of items) {
      turn = appendTurnItem(turn, item)
      await sessionStore.appendItem(threadId, item)
    }
    await threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Manual compact',
        workspace: '/tmp/workspace',
        model: 'thread-model',
        providerId: 'ext-manual-thread',
        accountId: 'account-manual-thread'
      }),
      turns: [finishTurn(turn, 'completed')]
    })

    const response = await service.compact({
      threadId,
      request: { reason: 'manual test' }
    })

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]).toMatchObject({
      model: 'turn-model',
      providerId: 'ext-manual-turn',
      accountId: 'account-manual-turn'
    })
    // Compaction-mode turn uses the dedicated summarizer system prompt and
    // feeds the real conversation as messages (not a serialized transcript).
    expect(model.requests[0].systemPrompt).toBe(COMPACTION_SYSTEM_PROMPT)
    expect(model.requests[0].prefix).toEqual([])
    const summaryHistory = model.requests[0].history
    const summaryUserMessages = summaryHistory
      .filter((item) => item.kind === 'user_message')
      .map((item) => item.text)
    expect(summaryUserMessages[0]).toContain('Initial task: fix /compact.')
    expect(summaryUserMessages).not.toContain('Active Skill: retained-manual-tail-only\nPlease preserve this clue.')
    expect(summaryUserMessages).not.toContain('Recent tail B.')
    expect(summaryUserMessages).not.toContain('Recent tail C.')
    const continuationItem = summaryHistory[summaryHistory.length - 1]
    expect(continuationItem?.kind).toBe('user_message')
    if (!continuationItem || continuationItem.kind !== 'user_message') {
      throw new Error('expected compaction continuation message to be a user message')
    }
    expect(continuationItem.text).toContain('Provide a detailed summary of our conversation above')
    expect(continuationItem.text).not.toContain('Active Skill: retained-manual-tail-only')
    expect(response.summary).toContain('MODEL SUMMARY kept the durable state.')
    expect(response.pinnedConstraints).toEqual(prefix.pinnedConstraints)

    const visibleItems = await sessionStore.loadItems(threadId)
    expect(visibleItems).toHaveLength(7)
    expect(visibleItems.map((item) => item.id)).toEqual([
      'item_1',
      'item_2',
      expect.stringMatching(/^compaction_/),
      'item_3',
      'item_4',
      'item_5',
      'item_6'
    ])
    expect(visibleItems[2]).toMatchObject({
      kind: 'compaction',
      auto: false,
      summary: expect.stringContaining('MODEL SUMMARY kept the durable state.'),
      pinnedConstraints: prefix.pinnedConstraints,
      sourceItemIds: ['item_1', 'item_2']
    })
    expect(effectiveHistoryAfterLatestCompaction(visibleItems).map((item) => item.id)).toEqual([
      visibleItems[2]?.id,
      'item_3',
      'item_4',
      'item_5',
      'item_6'
    ])
    const hydratedThread = await threadStore.get(threadId)
    // Thread-store layout diverges from session-store on purpose: the runtime
    // wants `[head, summary, tail]` so `effectiveHistoryAfterLatestCompaction`
    // can return `[summary, tail]`, but the renderer groups blocks by user
    // message — leaving the summary in the middle of the flat list would push
    // the 已压缩上下文 row into the previous turn's process timeline. The
    // bucket-level reorder appends the summary at the end of its turn so it
    // renders inside the latest turn instead.
    expect(hydratedThread?.turns[0]?.items.map((item) => item.id)).toEqual([
      'item_1',
      'item_2',
      'item_3',
      'item_4',
      'item_5',
      'item_6',
      visibleItems[2]?.id
    ])

    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    const started = runtimeEvents.find((event) => event.kind === 'compaction_started')
    const completed = runtimeEvents.find((event) => event.kind === 'compaction_completed')
    expect(started?.itemId).toBe(completed?.itemId)
    expect(completed).toMatchObject({
      kind: 'compaction_completed',
      auto: false,
      summary: expect.stringContaining('MODEL SUMMARY kept the durable state.')
    })
    expect(runtimeEvents.some((event) => event.kind === 'usage' && event.model === 'turn-model')).toBe(true)
  })

  it('retries manual compaction after a summary-window append without losing history', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new BlockingSummaryModel()
    const prefix = createImmutablePrefix({
      systemPrompt: 'System prompt used by both chat and compaction.',
      pinnedConstraints: ['system: keep GUI HTTP/SSE stable']
    })
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      model,
      usage: new UsageService(),
      prefix,
      defaultModel: 'default-model',
      contextCompaction: { summaryMode: 'model', summaryTimeoutMs: 1_000 },
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_manual_compact_race'
    const turnId = 'turn_1'
    const seeds: TurnItem[] = [
      makeUserItem({ id: 'item_1', threadId, turnId, text: 'Initial task: keep every item.' }),
      makeAssistantTextItem({ id: 'item_2', threadId, turnId, text: 'Older result.', status: 'completed' }),
      makeUserItem({ id: 'item_3', threadId, turnId, text: 'Recent clue.' }),
      makeAssistantTextItem({ id: 'item_4', threadId, turnId, text: 'Recent answer.', status: 'completed' }),
      makeUserItem({ id: 'item_5', threadId, turnId, text: 'Newest prompt.' }),
      makeAssistantTextItem({ id: 'item_6', threadId, turnId, text: 'Newest answer.', status: 'completed' })
    ]
    let turn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'Initial task',
      model: 'thread-model',
      status: 'completed'
    })
    for (const item of seeds) {
      turn = appendTurnItem(turn, item)
      await sessionStore.appendItem(threadId, item)
    }
    await threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Manual compact race',
        workspace: '/tmp/workspace',
        model: 'thread-model'
      }),
      turns: [finishTurn(turn, 'completed')]
    })

    const compacting = service.compact({ threadId, request: { reason: 'race test' } })
    await model.summaryStarted
    await service.applyItem(threadId, makeAssistantTextItem({
      id: 'item_late_manual_compaction',
      threadId,
      turnId,
      text: 'this summary-window append must survive',
      status: 'completed'
    }))
    model.release()
    await expect(compacting).resolves.toMatchObject({ threadId })

    const sessionItems = await sessionStore.loadItems(threadId)
    for (const id of [...seeds.map((item) => item.id), 'item_late_manual_compaction']) {
      expect(sessionItems.filter((item) => item.id === id)).toHaveLength(1)
    }
    const summaries = sessionItems.filter((item) => item.kind === 'compaction')
    expect(summaries).toHaveLength(1)
    const runtimeEvents = await sessionStore.loadEventsSince(threadId, 0)
    const completed = runtimeEvents.filter((event) => event.kind === 'compaction_completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.itemId).toBe(summaries[0]?.id)
    expect(completed[0]?.kind === 'compaction_completed' ? completed[0].auto : undefined).toBe(false)

    const threadItems = (await threadStore.get(threadId))?.turns.flatMap((candidate) => candidate.items) ?? []
    expect([...threadItems.map((item) => item.id)].sort()).toEqual(
      [...sessionItems.map((item) => item.id)].sort()
    )
    const sessionById = new Map(sessionItems.map((item) => [item.id, item]))
    for (const threadItem of threadItems) {
      expect(threadItem).toEqual(sessionById.get(threadItem.id))
    }
  })
})

describe('TurnService rewindThread', () => {
  it('removes the target turn and later session items from persisted history', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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

    const threadId = 'thr_rewind'
    const firstTurnId = 'turn_1'
    const secondTurnId = 'turn_2'
    const firstUser = makeUserItem({ id: 'item_1_user', threadId, turnId: firstTurnId, text: 'Keep me.' })
    const firstAssistant = makeAssistantTextItem({
      id: 'item_1_assistant',
      threadId,
      turnId: firstTurnId,
      text: 'Kept.',
      status: 'completed'
    })
    const secondUser = makeUserItem({
      id: 'item_2_user',
      threadId,
      turnId: secondTurnId,
      text: 'Rewind me.',
      workspaceCheckpointId: 'gcp_1'
    })
    const secondAssistant = makeAssistantTextItem({
      id: 'item_2_assistant',
      threadId,
      turnId: secondTurnId,
      text: 'Removed.',
      status: 'completed'
    })
    const firstTurn = finishTurn(
      appendTurnItem(appendTurnItem(createTurnRecord({
        id: firstTurnId,
        threadId,
        prompt: 'Keep me.',
        status: 'completed'
      }), firstUser), firstAssistant),
      'completed'
    )
    const secondTurn = finishTurn(
      appendTurnItem(appendTurnItem(createTurnRecord({
        id: secondTurnId,
        threadId,
        prompt: 'Rewind me.',
        workspaceCheckpointId: 'gcp_1',
        status: 'completed'
      }), secondUser), secondAssistant),
      'completed'
    )
    for (const item of [firstUser, firstAssistant, secondUser, secondAssistant]) {
      await sessionStore.appendItem(threadId, item)
    }
    await threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Rewind',
        workspace: '/tmp/workspace',
        model: 'thread-model',
        status: 'archived'
      }),
      turns: [firstTurn, secondTurn]
    })

    const response = await service.rewindThread({ threadId, turnId: secondTurnId })

    expect(response).toMatchObject({
      threadId,
      turnId: secondTurnId,
      removedTurns: 1,
      remainingTurns: 1
    })
    expect((await sessionStore.loadItems(threadId)).map((item) => item.id)).toEqual([
      'item_1_user',
      'item_1_assistant'
    ])
    expect(await threadStore.get(threadId)).toMatchObject({
      status: 'archived',
      turns: [expect.objectContaining({ id: firstTurnId })]
    })
  })

  it('refuses to rewrite history while any turn remains active, including under archival', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const service = new TurnService({
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
    const threadId = 'thr_rewind_active'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Active rewind',
      workspace: '/tmp/workspace',
      model: 'thread-model'
    }))
    const started = await service.startTurn({ threadId, request: { prompt: 'do not rewind' } })
    const activeThread = await threadStore.get(threadId)
    if (!activeThread) throw new Error('missing active thread')
    await threadStore.upsert({ ...activeThread, status: 'archived' })

    await expect(service.rewindThread({ threadId, turnId: started.turnId }))
      .rejects.toBeInstanceOf(TurnConflictError)
    expect((await threadStore.get(threadId))?.turns.map((turn) => turn.id)).toEqual([started.turnId])
    await service.interruptTurn({ threadId, turnId: started.turnId })
  })
})
