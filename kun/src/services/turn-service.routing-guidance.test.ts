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

  override async getMetadata(threadId: string) {
    this.metadataGets.push(threadId)
    return super.get(threadId)
  }

  async touch(threadId: string, _updatedAt: string): Promise<boolean> {
    this.touches.push(threadId)
    return Boolean(await super.get(threadId))
  }
}

describe('TurnService startTurn', () => {
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
        request: {
          prompt: 'will fail while persisting',
          model: 'm',
          clientRequestId: 'request_retry_after_failed_admission'
        }
      })).rejects.toThrow('append item failed')

      const failed = await threadStore.get('thr_start_failure_a')
      expect(failed?.turns).toEqual([])

      const retried = await service.startTurn({
        threadId: 'thr_start_failure_a',
        request: {
          prompt: 'will fail while persisting',
          model: 'm',
          clientRequestId: 'request_retry_after_failed_admission'
        }
      })
      expect(retried.turnId).toBeTruthy()
      expect((await threadStore.get('thr_start_failure_a'))?.turns.at(-1)?.admissionCompletedAt)
        .toBe(nowIso())
      await service.interruptTurn({ threadId: 'thr_start_failure_a', turnId: retried.turnId })

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

  it('freezes an omitted provider as default before the thread selection can change', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-08-05T00:00:00.000Z'
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
        defaultModel: 'default-model',
        ids: new SequentialIdGenerator(),
        nowIso
      })
      const threadId = 'thr_default_provider_snapshot'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Default provider snapshot',
        workspace: '/tmp/workspace',
        model: 'default-model'
      }))

      const started = await service.startTurn({ threadId, request: { prompt: 'run' } })
      const admitted = await threadStore.get(threadId)
      expect(admitted?.turns[0]).toMatchObject({
        id: started.turnId,
        model: 'default-model',
        providerId: 'default'
      })
      if (!admitted) throw new Error('expected admitted thread')

      // Reproduce the old first-step window: a later thread projection gains a
      // concrete provider before ModelStepService reads it. The admitted turn's
      // explicit default alias remains authoritative and blocks that fallback.
      await threadStore.upsert({
        ...admitted,
        providerId: 'provider-after-admission',
        accountId: 'account-after-admission'
      })
      expect((await threadStore.get(threadId))?.turns[0]).toMatchObject({
        providerId: 'default'
      })

      await service.interruptTurn({ threadId, turnId: started.turnId })
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
        model: 'deepseek-v4-pro',
        providerId: 'provider-a',
        accountId: 'account-a'
      }))
      const started = await service.startTurn({ threadId, request: { prompt: 'run' } })

      expect((await threadStore.get(threadId))?.turns[0]).toMatchObject({
        model: 'deepseek-v4-pro',
        providerId: 'provider-a',
        accountId: 'account-a'
      })

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
