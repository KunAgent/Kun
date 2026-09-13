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
  it('steers a suspended committed GraphRun through Lead resume, not planning resume', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const nowIso = () => '2026-07-30T12:00:00.000Z'
      const transitionGraphPlanningDraft = vi.fn(async (input: {
        action: 'suspend' | 'resume' | 'cancel'
      }) => {
        if (input.action === 'resume') {
          throw new Error('committed planning must not be resumed')
        }
        return {
          version: 1 as const,
          draftId: 'draft_committed',
          reservedRunId: 'run_committed',
          state: 'committed' as const,
          draftRevision: 4
        }
      })
      const service = new TurnService({
        threadStore,
        sessionStore,
        events: new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
          nowIso
        }),
        inflight,
        steering,
        compactor: new ContextCompactor(),
        resolveGraphLeadRun: async () => ({
          runId: 'run_committed',
          lastEventSeq: 9,
          terminal: false
        }),
        createGraphPlanningDraft: async () => ({
          version: 1,
          draftId: 'draft_committed',
          reservedRunId: 'run_committed',
          state: 'planning',
          draftRevision: 1
        }),
        resolveGraphPlanningDraft: async () => ({
          version: 1,
          draftId: 'draft_committed',
          reservedRunId: 'run_committed',
          state: 'committed',
          draftRevision: 4
        }),
        transitionGraphPlanningDraft,
        ids: new SequentialIdGenerator(),
        nowIso
      })
      await threadStore.upsert(createThreadRecord({
        id: 'thr_graph_committed_steer',
        title: 'Committed graph steering',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const source = await service.startTurn({
        threadId: 'thr_graph_committed_steer',
        request: { prompt: 'run graph', orchestration: 'graph' }
      })
      await expect(service.suspendGraphLeadTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })).resolves.toBe('suspended')
      expect(await service.getTurn(source.threadId, source.turnId)).toMatchObject({
        graphPlanningLifecycle: {
          state: 'committed',
          draftRevision: 4
        }
      })

      await expect(service.steerTurn({
        threadId: source.threadId,
        turnId: source.turnId,
        text: 'continue supervision',
        messageSource: 'graph_runtime'
      })).resolves.toBeUndefined()

      expect(service.isTurnExecutionActive(source.turnId)).toBe(true)
      expect(transitionGraphPlanningDraft).not.toHaveBeenCalled()
      expect(steering.peek(source.turnId)).toHaveLength(1)
      await service.interruptTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })
    })

  it('resumes and enqueues steering when Graph suspension releases the lease under the thread lock', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const nowIso = () => '2026-07-30T12:00:00.000Z'
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
        inflight,
        steering,
        compactor: new ContextCompactor(),
        resolveGraphLeadRun: async () => ({
          runId: 'run_suspend_steer_race',
          lastEventSeq: 11,
          terminal: false
        }),
        ids: new SequentialIdGenerator(),
        nowIso
      })
      await threadStore.upsert(createThreadRecord({
        id: 'thr_suspend_steer_race',
        title: 'Suspend steering race',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const source = await service.startTurn({
        threadId: 'thr_suspend_steer_race',
        request: { prompt: 'run graph', orchestration: 'graph' }
      })

      const originalUpsert = threadStore.upsert.bind(threadStore)
      let markSuspendWriteStarted!: () => void
      let releaseSuspendWrite!: () => void
      const suspendWriteStarted = new Promise<void>((resolve) => {
        markSuspendWriteStarted = resolve
      })
      const suspendWriteRelease = new Promise<void>((resolve) => {
        releaseSuspendWrite = resolve
      })
      let blockSuspendWrite = true
      threadStore.upsert = vi.fn(async (
        thread: Parameters<InMemoryThreadStore['upsert']>[0]
      ) => {
        const sourceTurn = thread.turns.find((turn) => turn.id === source.turnId)
        if (blockSuspendWrite && sourceTurn?.graphLeadLifecycle?.suspendedAt) {
          blockSuspendWrite = false
          markSuspendWriteStarted()
          await suspendWriteRelease
        }
        return originalUpsert(thread)
      })

      const suspension = service.suspendGraphLeadTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })
      await suspendWriteStarted
      const steeringRequest = service.steerTurn({
        threadId: source.threadId,
        turnId: source.turnId,
        text: 'continue while suspension is committing',
        messageSource: 'graph_runtime'
      })
      releaseSuspendWrite()

      await expect(suspension).resolves.toBe('suspended')
      await expect(steeringRequest).resolves.toBeUndefined()
      expect(service.isTurnExecutionActive(source.turnId)).toBe(true)
      expect(steering.peek(source.turnId)).toEqual([{
        text: 'continue while suspension is committing',
        messageSource: 'graph_runtime'
      }])
      expect((await sessionStore.loadEventsSince(source.threadId, 0))
        .filter((event) => event.kind === 'turn_steered')).toHaveLength(1)
      await service.interruptTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })
    })

  it('preserves an orphaned running Graph source turn when its run is nonterminal', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-28T12:00:00.000Z'
      const events = new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      })
      const original = new TurnService({
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
        id: 'thr_graph_restart',
        title: 'Graph restart',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const started = await original.startTurn({
        threadId: 'thr_graph_restart',
        request: { prompt: 'run graph', orchestration: 'graph' }
      })

      const recovered = new TurnService({
        threadStore,
        sessionStore,
        events,
        inflight: new InflightTracker(),
        steering: new SteeringQueue(),
        compactor: new ContextCompactor(),
        resolveGraphLeadRun: async ({ turnId }) => turnId === started.turnId
          ? { runId: 'run_restart', lastEventSeq: 3, terminal: false }
          : null,
        ids: new SequentialIdGenerator(),
        nowIso
      })
      await expect(recovered.reconcileOrphanedTurns()).resolves.toEqual([])
      expect(await recovered.getTurn('thr_graph_restart', started.turnId)).toMatchObject({
        status: 'running',
        graphLeadLifecycle: {
          runId: 'run_restart',
          state: 'supervising',
          lastDeliveredSeq: 0
        }
      })
      await recovered.resumeGraphLeadTurn({
        threadId: 'thr_graph_restart',
        turnId: started.turnId,
        runId: 'run_restart',
        lastDeliveredSeq: 3,
        terminal: false
      })
      await recovered.interruptTurn({
        threadId: 'thr_graph_restart',
        turnId: started.turnId
      })
    })
})
