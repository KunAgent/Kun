import { describe, expect, it } from 'vitest'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord, finishTurn } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import type { TurnItem } from '../contracts/items.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
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
      makeUserItem({ id: 'item_3', threadId, turnId, text: 'Please preserve this clue.' }),
      makeAssistantTextItem({ id: 'item_4', threadId, turnId, text: 'Recent tail A.', status: 'completed' }),
      makeUserItem({ id: 'item_5', threadId, turnId, text: 'Recent tail B.' }),
      makeAssistantTextItem({ id: 'item_6', threadId, turnId, text: 'Recent tail C.', status: 'completed' })
    ]
    let turn = createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'Initial task',
      model: 'thread-model',
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
        model: 'thread-model'
      }),
      turns: [finishTurn(turn, 'completed')]
    })

    const response = await service.compact({
      threadId,
      request: { reason: 'manual test' }
    })

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0].model).toBe('thread-model')
    expect(model.requests[0].systemPrompt).toBe(prefix.systemPrompt)
    const summaryRequestItem = model.requests[0].history[0]
    expect(summaryRequestItem?.kind).toBe('user_message')
    if (!summaryRequestItem || summaryRequestItem.kind !== 'user_message') {
      throw new Error('expected compaction summary request to be a user message')
    }
    expect(summaryRequestItem.text).toContain('Conversation history to fold:')
    expect(summaryRequestItem.text).toContain('Initial task: fix /compact.')
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
    expect(runtimeEvents.some((event) => event.kind === 'usage' && event.model === 'thread-model')).toBe(true)
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
        model: 'thread-model'
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
    expect((await threadStore.get(threadId))?.turns.map((turn) => turn.id)).toEqual([firstTurnId])
  })
})
