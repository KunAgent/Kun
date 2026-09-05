import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import type { RuntimeEvent } from '../contracts/events.js'
import type { GraphPlanningLifecycle, StartTurnRequest } from '../contracts/turns.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import {
  DEFAULT_MAX_CONCURRENT_TURNS,
  TurnCapacityError,
  TurnConflictError,
  TurnService
} from './turn-service.js'
import { ThreadService } from './thread-service.js'
import { UsageService } from './usage-service.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { KunCapabilitiesConfig } from '../contracts/capabilities.js'

function testPng(): Buffer {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer.writeUInt32BE(1, 16)
  buffer.writeUInt32BE(1, 20)
  return buffer
}

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

class BlockingGoalContextSessionStore extends InMemorySessionStore {
  readonly loadItemsStarted: Promise<void>
  private resolveLoadItemsStarted!: () => void
  private resolveLoadItems!: () => void
  private readonly releaseLoadItems: Promise<void>
  private blockNextLoadItems = false

  constructor() {
    super()
    this.loadItemsStarted = new Promise<void>((resolve) => {
      this.resolveLoadItemsStarted = resolve
    })
    this.releaseLoadItems = new Promise<void>((resolve) => {
      this.resolveLoadItems = resolve
    })
  }

  blockNextLoad(): void {
    this.blockNextLoadItems = true
  }

  release(): void {
    this.resolveLoadItems()
  }

  override async loadItems(threadId: string): Promise<TurnItem[]> {
    if (this.blockNextLoadItems) {
      this.blockNextLoadItems = false
      this.resolveLoadItemsStarted()
      await this.releaseLoadItems
    }
    return super.loadItems(threadId)
  }
}

class BlockingDeltaEventSessionStore extends InMemorySessionStore {
  readonly order: string[] = []
  readonly eventAppendStarted: Promise<void>
  private releaseEventAppend!: () => void
  private markEventAppendStarted!: () => void
  private readonly eventAppendRelease: Promise<void>

  constructor() {
    super()
    this.eventAppendStarted = new Promise<void>((resolve) => {
      this.markEventAppendStarted = resolve
    })
    this.eventAppendRelease = new Promise<void>((resolve) => {
      this.releaseEventAppend = resolve
    })
  }

  releaseEvent(): void {
    this.releaseEventAppend()
  }

  override async appendItem(threadId: string, item: TurnItem): Promise<void> {
    this.order.push('item')
    await super.appendItem(threadId, item)
  }

  override async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    this.order.push('event-start')
    this.markEventAppendStarted()
    await this.eventAppendRelease
    await super.appendEvent(threadId, event)
    this.order.push('event-commit')
  }
}

class MetadataCountingThreadStore extends InMemoryThreadStore {
  readonly hydratedGets: string[] = []
  readonly metadataGets: string[] = []
  readonly touches: string[] = []

  override async get(threadId: string) {
    this.hydratedGets.push(threadId)
    return super.get(threadId)
  }

  async getMetadata(threadId: string) {
    this.metadataGets.push(threadId)
    return super.get(threadId)
  }

  async touch(threadId: string, _updatedAt: string): Promise<boolean> {
    this.touches.push(threadId)
    return Boolean(await super.get(threadId))
  }
}

describe('TurnService bounded history operations', () => {
  it('touches metadata without hydrating the Thread for a durable item update', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new MetadataCountingThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-31T00:00:00.000Z'
      const threadId = 'thr_metadata_touch'
      const turnId = 'turn_metadata_touch'
      const item = makeAssistantTextItem({
        id: 'assistant_metadata_touch',
        threadId,
        turnId,
        text: 'running',
        status: 'running'
      })
      await threadStore.upsert({
        ...createThreadRecord({
          id: threadId,
          title: 'Metadata touch',
          workspace: '/tmp/workspace',
          model: 'test'
        }),
        turns: [appendTurnItem(createTurnRecord({
          id: turnId,
          threadId,
          prompt: 'test',
          status: 'running'
        }), item)]
      })
      await sessionStore.appendItem(threadId, item)
      const service = new TurnService({
        threadStore,
        sessionStore,
        events: new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (id) => eventBus.allocateSeq(id),
          nowIso
        }),
        inflight: new InflightTracker(),
        steering: new SteeringQueue(),
        compactor: new ContextCompactor(),
        ids: new SequentialIdGenerator(),
        nowIso
      })

      await service.updateItem(threadId, item.id, { text: 'completed', status: 'completed' })

      expect(threadStore.touches).toEqual([threadId])
      expect(threadStore.hydratedGets).toEqual([])
      expect(await sessionStore.loadItems(threadId)).toMatchObject([
        { id: item.id, text: 'completed', status: 'completed' }
      ])
    })

  it('hydrates only metadata-identified orphan candidates during reconciliation', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new MetadataCountingThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-31T00:00:00.000Z'
      const idleId = 'thr_orphan_idle'
      const activeId = 'thr_orphan_active'
      await threadStore.upsert({
        ...createThreadRecord({
          id: idleId,
          title: 'Idle history',
          workspace: '/tmp/workspace',
          model: 'test'
        }),
        turns: [finishTurn(createTurnRecord({
          id: 'turn_idle',
          threadId: idleId,
          prompt: 'done',
          status: 'completed'
        }), 'completed')]
      })
      await threadStore.upsert({
        ...createThreadRecord({
          id: activeId,
          title: 'Active orphan',
          workspace: '/tmp/workspace',
          model: 'test'
        }),
        turns: [createTurnRecord({
          id: 'turn_active',
          threadId: activeId,
          prompt: 'running',
          status: 'running'
        })]
      })
      const service = new TurnService({
        threadStore,
        sessionStore,
        events: new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (id) => eventBus.allocateSeq(id),
          nowIso
        }),
        inflight: new InflightTracker(),
        steering: new SteeringQueue(),
        compactor: new ContextCompactor(),
        ids: new SequentialIdGenerator(),
        nowIso
      })

      await expect(service.reconcileOrphanedTurns()).resolves.toEqual([
        { threadId: activeId, turnId: 'turn_active' }
      ])

      expect(threadStore.metadataGets).toEqual(expect.arrayContaining([idleId, activeId]))
      expect(threadStore.hydratedGets).not.toContain(idleId)
      expect(threadStore.hydratedGets).toContain(activeId)
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
      const compactedThreads: string[] = []
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
        onCompacted: async (threadId) => {
          compactedThreads.push(threadId)
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
      expect(compactedThreads).toEqual([threadId])

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
