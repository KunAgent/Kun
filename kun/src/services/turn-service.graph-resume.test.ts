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

  it('suspends and resumes one durable Graph Lead turn without holding runtime capacity', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const nowIso = () => '2026-07-28T12:00:00.000Z'
      let graphLastEventSeq = 7
      let supervisionPending = false
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
        maxConcurrentTurns: 1,
        resolveGraphLeadRun: async ({ turnId }) => turnId === 'turn_1'
          ? {
              runId: 'run_1',
              lastEventSeq: graphLastEventSeq,
              terminal: false,
              supervisionPending
            }
          : null,
        ids: new SequentialIdGenerator(),
        nowIso
      })
      for (const id of ['thr_graph_lead', 'thr_other']) {
        await threadStore.upsert(createThreadRecord({
          id,
          title: id,
          workspace: '/tmp/workspace',
          model: 'deepseek-v4-pro'
        }))
      }

      const source = await service.startTurn({
        threadId: 'thr_graph_lead',
        request: { prompt: 'run graph', orchestration: 'graph' }
      })
      expect(source.turnId).toBe('turn_1')
      expect(await service.graphRunOwnsLeadLimits({
        threadId: 'thr_graph_lead',
        turnId: source.turnId
      })).toBe(true)
      expect(await service.suspendGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId
      })).toBe('suspended')
      expect(service.isTurnExecutionActive(source.turnId)).toBe(false)
      expect(inflight.has(source.turnId)).toBe(false)
      expect(await service.getTurn('thr_graph_lead', source.turnId)).toMatchObject({
        status: 'running',
        graphLeadLifecycle: {
          runId: 'run_1',
          state: 'supervising',
          lastDeliveredSeq: 0
        }
      })

      const other = await service.startTurn({
        threadId: 'thr_other',
        request: { prompt: 'uses released capacity' }
      })
      await expect(service.resumeGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId,
        runId: 'run_1',
        lastDeliveredSeq: 8,
        terminal: false
      })).rejects.toBeInstanceOf(TurnCapacityError)
      await service.interruptTurn({ threadId: 'thr_other', turnId: other.turnId })

      await expect(service.resumeGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId,
        runId: 'run_1',
        lastDeliveredSeq: 8,
        terminal: false
      })).resolves.toBe('resumed')
      expect(service.isTurnExecutionActive(source.turnId)).toBe(true)
      graphLastEventSeq = 9
      supervisionPending = true
      await expect(service.suspendGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId
      })).resolves.toBe('supervision_pending')
      expect(service.isTurnExecutionActive(source.turnId)).toBe(true)
      await expect(service.suspendGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId,
        force: true,
        preserveDeliveryCursor: true,
        allowPendingSupervision: true
      })).resolves.toBe('suspended_pending_supervision')
      expect(service.isTurnExecutionActive(source.turnId)).toBe(false)
      expect(await service.getTurn('thr_graph_lead', source.turnId)).toMatchObject({
        status: 'running',
        graphLeadLifecycle: {
          runId: 'run_1',
          lastDeliveredSeq: 8
        }
      })
      await expect(service.resumeGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId,
        runId: 'run_1',
        lastDeliveredSeq: 9,
        terminal: false
      })).resolves.toBe('resumed')
      supervisionPending = false
      await service.steerTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId,
        text: 'inspect the submitted node',
        messageSource: 'graph_runtime'
      })
      expect(await service.suspendGraphLeadTurn({
        threadId: 'thr_graph_lead',
        turnId: source.turnId
      })).toBe('pending_steering')
      expect(steering.drain(source.turnId)).toHaveLength(1)
      await service.interruptTurn({ threadId: 'thr_graph_lead', turnId: source.turnId })
      expect(await service.graphRunOwnsLeadLimits({
        threadId: 'thr_graph_lead',
        turnId: source.turnId
      })).toBe(false)
    })

  it('restores a planning draft to correction when resume cannot reacquire capacity', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const nowIso = () => '2026-07-30T14:00:00.000Z'
      let lifecycle: GraphPlanningLifecycle = {
        version: 1,
        draftId: 'draft_capacity',
        reservedRunId: 'run_capacity',
        state: 'planning',
        draftRevision: 1
      }
      const transitionGraphPlanningDraft = vi.fn(async ({
        action
      }: {
        action: 'suspend' | 'resume' | 'cancel'
      }): Promise<GraphPlanningLifecycle> => {
        const state = action === 'resume'
          ? 'planning'
          : action === 'suspend'
            ? 'needs_correction'
            : 'cancelled'
        if (lifecycle.state !== state) {
          lifecycle = {
            ...lifecycle,
            state,
            draftRevision: lifecycle.draftRevision + 1
          }
        }
        return lifecycle
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
        maxConcurrentTurns: 1,
        createGraphPlanningDraft: async () => lifecycle,
        transitionGraphPlanningDraft,
        ids: new SequentialIdGenerator(),
        nowIso
      })
      for (const id of ['thr_graph_planning_capacity', 'thr_capacity_owner']) {
        await threadStore.upsert(createThreadRecord({
          id,
          title: id,
          workspace: '/tmp/workspace',
          model: 'deepseek-v4-pro'
        }))
      }

      const source = await service.startTurn({
        threadId: 'thr_graph_planning_capacity',
        request: { prompt: 'plan graph', orchestration: 'graph' }
      })
      await expect(service.suspendGraphPlanningTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })).resolves.toBe('suspended')
      expect(lifecycle).toMatchObject({
        state: 'needs_correction',
        draftRevision: 2
      })

      const capacityOwner = await service.startTurn({
        threadId: 'thr_capacity_owner',
        request: { prompt: 'occupy the only execution slot' }
      })
      await expect(service.resumeGraphPlanningTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })).rejects.toBeInstanceOf(TurnCapacityError)
      expect(lifecycle).toMatchObject({
        state: 'needs_correction',
        draftRevision: 2
      })
      expect(await service.getTurn(source.threadId, source.turnId)).toMatchObject({
        graphPlanningLifecycle: {
          state: 'needs_correction',
          draftRevision: 2
        }
      })
      expect(service.isTurnExecutionActive(source.turnId)).toBe(false)

      await service.interruptTurn({
        threadId: capacityOwner.threadId,
        turnId: capacityOwner.turnId
      })
      await expect(service.resumeGraphPlanningTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })).resolves.toBe('resumed')
      expect(lifecycle).toMatchObject({
        state: 'planning',
        draftRevision: 3
      })
      expect(service.isTurnExecutionActive(source.turnId)).toBe(true)
      await service.interruptTurn({
        threadId: source.threadId,
        turnId: source.turnId
      })
    })
})
