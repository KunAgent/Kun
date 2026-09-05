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

  override async checkpointLiveItem(
    threadId: string,
    item: TurnItem,
    representedSeq: number
  ): Promise<void> {
    this.order.push('checkpoint')
    await super.checkpointLiveItem(threadId, item, representedSeq)
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

describe('TurnService assistant delta persistence (#1087)', () => {
  it('persists the cumulative item before committing its offset-addressed replay event', async () => {
      const sessionStore = new BlockingDeltaEventSessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const service = new TurnService({
        threadStore,
        sessionStore,
        events: new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
          nowIso: () => '2026-08-05T00:00:01.000Z'
        }),
        inflight: new InflightTracker(),
        steering: new SteeringQueue(),
        compactor: new ContextCompactor(),
        ids: new SequentialIdGenerator(),
        nowIso: () => '2026-08-05T00:00:01.000Z'
      })
      const item = makeAssistantTextItem({
        id: 'item_stream',
        threadId: 'thr_stream',
        turnId: 'turn_stream',
        text: 'prefix',
        status: 'running',
        createdAt: '2026-08-05T00:00:00.000Z'
      })

      const recording = service.applyAssistantDelta('thr_stream', item, 'prefix', 0)
      await sessionStore.eventAppendStarted

      expect(sessionStore.order).toEqual(['checkpoint', 'event-start'])
      expect(await sessionStore.loadItems('thr_stream')).toEqual([item])
      expect(await sessionStore.highestSeq('thr_stream')).toBe(0)

      sessionStore.releaseEvent()
      await recording

      expect(sessionStore.order).toEqual(['checkpoint', 'event-start', 'event-commit'])
      expect(await sessionStore.loadEventsSince('thr_stream', 0)).toEqual([
        expect.objectContaining({
          kind: 'assistant_text_delta',
          seq: 1,
          deltaOffset: 0,
          item: expect.objectContaining({ id: item.id, text: 'prefix' })
        })
      ])
    })
})

describe('TurnService startTurn', () => {
  it('defaults to 256 concurrent active turns', () => {
      expect(DEFAULT_MAX_CONCURRENT_TURNS).toBe(256)
    })

  it('binds an idempotency key to the canonical full request and supports legacy turns', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-08-09T10:00:00.000Z'
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
      const threadId = 'thr_full_request_idempotency'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Full request idempotency',
        workspace: '/tmp/workspace',
        model: 'model-a'
      }))
      const admittedRequest: StartTurnRequest = {
        prompt: 'same prompt',
        clientRequestId: 'request_full_fingerprint',
        model: 'model-a',
        sandboxMode: 'workspace-write',
        attachments: [{ path: '/tmp/input.txt', name: 'input.txt' }],
        fileReferences: [{
          path: '/tmp/workspace/input.ts',
          relativePath: 'input.ts',
          name: 'input.ts',
          kind: 'file'
        }]
      }

      const admitted = await service.startTurn({ threadId, request: admittedRequest })
      expect((await threadStore.get(threadId))?.turns[0]).toMatchObject({
        clientRequestId: admittedRequest.clientRequestId,
        clientRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      })

      const reorderedRequest: StartTurnRequest = {
        fileReferences: [{
          kind: 'file',
          name: 'input.ts',
          relativePath: 'input.ts',
          path: '/tmp/workspace/input.ts'
        }],
        attachments: [{ name: 'input.txt', path: '/tmp/input.txt' }],
        sandboxMode: 'workspace-write',
        model: 'model-a',
        clientRequestId: 'request_full_fingerprint',
        prompt: 'same prompt'
      }
      await expect(service.startTurn({
        threadId,
        request: reorderedRequest
      })).resolves.toEqual(admitted)

      const changedRequests: StartTurnRequest[] = [
        { ...admittedRequest, model: 'model-b' },
        { ...admittedRequest, attachments: [{ path: '/tmp/other.txt', name: 'other.txt' }] },
        { ...admittedRequest, sandboxMode: 'danger-full-access' }
      ]
      for (const request of changedRequests) {
        await expect(service.startTurn({ threadId, request })).rejects.toThrow(
          'clientRequestId is already associated with a different request'
        )
      }
      await service.interruptTurn({ threadId, turnId: admitted.turnId })

      const legacyThreadId = 'thr_legacy_prompt_idempotency'
      const legacyTurn = createTurnRecord({
        id: 'turn_legacy_prompt_idempotency',
        threadId: legacyThreadId,
        clientRequestId: 'request_legacy_prompt_only',
        prompt: 'legacy prompt',
        model: 'legacy-model',
        status: 'completed',
        createdAt: nowIso()
      })
      const legacyUserItem = makeUserItem({
        id: `item_${legacyTurn.id}_user`,
        threadId: legacyThreadId,
        turnId: legacyTurn.id,
        text: legacyTurn.prompt
      })
      await threadStore.upsert({
        ...createThreadRecord({
          id: legacyThreadId,
          title: 'Legacy prompt idempotency',
          workspace: '/tmp/workspace',
          model: 'legacy-model',
          createdAt: nowIso()
        }),
        turns: [appendTurnItem(legacyTurn, legacyUserItem)]
      })

      await expect(service.startTurn({
        threadId: legacyThreadId,
        request: {
          prompt: 'legacy prompt',
          clientRequestId: 'request_legacy_prompt_only',
          model: 'changed-model'
        }
      })).resolves.toEqual({
        threadId: legacyThreadId,
        turnId: legacyTurn.id,
        userMessageItemId: legacyUserItem.id,
        threadAgentSurface: 'code'
      })
      await expect(service.startTurn({
        threadId: legacyThreadId,
        request: {
          prompt: 'different legacy prompt',
          clientRequestId: 'request_legacy_prompt_only'
        }
      })).rejects.toThrow('clientRequestId is already associated with a different prompt')
    })

  it('persists one stable goal context in canonical history without publishing it', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-08-06T00:00:00.000Z'
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
      const threadId = 'thr_goal_context'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Goal context',
        workspace: '/tmp/workspace',
        model: 'test-model',
        goal: {
          threadId,
          objective: 'Keep the durable goal context stable.',
          status: 'active',
          tokenBudget: 500,
          tokensUsed: 17,
          timeUsedSeconds: 3,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      }))

      const started = await service.startTurn({
        threadId,
        request: { prompt: 'Make progress.', model: 'test-model' }
      })
      await Promise.all([
        service.ensureGoalContext(threadId, started.turnId),
        service.ensureGoalContext(threadId, started.turnId)
      ])

      const items = await sessionStore.loadItems(threadId)
      expect(items.map((item) => item.kind)).toEqual(['user_message', 'goal_context'])
      const goalContext = items[1]
      expect(goalContext).toMatchObject({
        id: expect.stringMatching(new RegExp(`^item_${started.turnId}_goal_context_goal_`)),
        kind: 'goal_context',
        goalKey: expect.stringMatching(/^goal_/),
        text: expect.stringContaining('Keep the durable goal context stable.')
      })
      if (!goalContext || goalContext.kind !== 'goal_context') {
        throw new Error('expected internal goal context')
      }
      expect(goalContext.text).not.toContain('Tokens used')
      expect(goalContext.text).not.toContain('Tokens remaining')

      const thread = await threadStore.get(threadId)
      expect(thread?.turns[0]?.items.map((item) => item.kind)).toEqual(['user_message'])
      expect(JSON.stringify(await sessionStore.loadEventsSince(threadId, 0))).not.toContain('"kind":"goal_context"')

      await threadStore.upsert({
        ...thread!,
        goal: {
          ...thread!.goal!,
          tokensUsed: 499,
          timeUsedSeconds: 400,
          updatedAt: '2026-08-06T00:10:00.000Z'
        }
      })
      await service.ensureGoalContext(threadId, started.turnId)
      expect(await sessionStore.loadItems(threadId)).toEqual(items)

      await service.finishTurn({ threadId, turnId: started.turnId, status: 'completed' })
      const second = await service.startTurn({
        threadId,
        request: { prompt: 'Continue in a later turn.', model: 'test-model' }
      })
      await service.ensureGoalContext(threadId, second.turnId)
      expect((await sessionStore.loadItems(threadId)).filter((item) => item.kind === 'goal_context'))
        .toEqual([goalContext])

      const latest = await threadStore.get(threadId)
      await threadStore.upsert({
        ...latest!,
        goal: {
          ...latest!.goal!,
          objective: 'Work on the replacement goal generation.',
          updatedAt: '2026-08-06T00:20:00.000Z'
        }
      })
      await Promise.all([
        service.ensureGoalContext(threadId, second.turnId),
        service.ensureGoalContext(threadId, second.turnId)
      ])
      const goalContexts = (await sessionStore.loadItems(threadId))
        .filter((item): item is Extract<TurnItem, { kind: 'goal_context' }> => item.kind === 'goal_context')
      expect(goalContexts).toHaveLength(2)
      expect(goalContexts.map((item) => item.goalKey)).toEqual([
        goalContext.goalKey,
        expect.stringMatching(/^goal_/)
      ])
      expect(goalContexts[1]?.goalKey).not.toBe(goalContext.goalKey)

      await service.interruptTurn({ threadId, turnId: second.turnId })
    })
})
