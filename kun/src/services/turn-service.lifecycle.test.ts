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
  it('parks an orphaned Graph Lead with pending supervision without consuming its cursor', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-30T12:30:00.000Z'
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
        id: 'thr_graph_pending_restart',
        title: 'Graph supervision restart',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const started = await original.startTurn({
        threadId: 'thr_graph_pending_restart',
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
          ? {
              runId: 'run_pending_restart',
              lastEventSeq: 17,
              terminal: false,
              supervisionPending: true
            }
          : null,
        ids: new SequentialIdGenerator(),
        nowIso
      })

      await expect(recovered.reconcileOrphanedTurns()).resolves.toEqual([])
      expect(await recovered.getTurn(started.threadId, started.turnId)).toMatchObject({
        status: 'running',
        graphLeadLifecycle: {
          runId: 'run_pending_restart',
          state: 'supervising',
          lastDeliveredSeq: 0,
          suspendedAt: nowIso()
        }
      })
      expect((await sessionStore.loadEventsSince(started.threadId, 0))
        .filter((event) => event.kind === 'turn_failed')).toEqual([])

      await expect(recovered.resumeGraphLeadTurn({
        threadId: started.threadId,
        turnId: started.turnId,
        runId: 'run_pending_restart',
        lastDeliveredSeq: 0,
        terminal: false
      })).resolves.toBe('resumed')
      await recovered.interruptTurn({
        threadId: started.threadId,
        turnId: started.turnId
      })
    })

  it('preserves a terminal Graph source turn until delayed Lead recovery finalizes it', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-30T12:00:00.000Z'
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
        id: 'thr_graph_terminal_restart',
        title: 'Terminal Graph restart',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const started = await original.startTurn({
        threadId: 'thr_graph_terminal_restart',
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
          ? { runId: 'run_terminal_restart', lastEventSeq: 9, terminal: true }
          : null,
        ids: new SequentialIdGenerator(),
        nowIso
      })

      // Runtime startup performs this orphan sweep before the Graph supervisor's
      // delayed terminal wake-up. The GraphRun still owns finalization.
      await expect(recovered.reconcileOrphanedTurns()).resolves.toEqual([])
      expect(await recovered.getTurn(started.threadId, started.turnId)).toMatchObject({
        status: 'running'
      })
      expect((await sessionStore.loadEventsSince(started.threadId, 0))
        .filter((event) => event.kind === 'turn_failed')).toEqual([])

      await expect(recovered.resumeGraphLeadTurn({
        threadId: started.threadId,
        turnId: started.turnId,
        runId: 'run_terminal_restart',
        lastDeliveredSeq: 9,
        terminal: true
      })).resolves.toBe('resumed')
      expect(await recovered.getTurn(started.threadId, started.turnId)).toMatchObject({
        status: 'running',
        graphLeadLifecycle: {
          runId: 'run_terminal_restart',
          state: 'finalizing',
          lastDeliveredSeq: 9
        }
      })
      await recovered.interruptTurn({
        threadId: started.threadId,
        turnId: started.turnId
      })
    })

  it('migrates an active legacy Graph creation gate into a recoverable planning draft', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const inflight = new InflightTracker()
      const steering = new SteeringQueue()
      const nowIso = () => '2026-07-29T00:00:00.000Z'
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
        inflight,
        steering,
        compactor: new ContextCompactor(),
        ids: new SequentialIdGenerator(),
        nowIso
      })
      await threadStore.upsert(createThreadRecord({
        id: 'thr_graph_legacy_gate',
        title: 'Legacy gate',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))
      const started = await original.startTurn({
        threadId: 'thr_graph_legacy_gate',
        request: { prompt: 'run graph', orchestration: 'graph' }
      })
      await original.updateTurnMetadata('thr_graph_legacy_gate', started.turnId, {
        requiredToolGate: {
          toolName: 'graph_create_run',
          attempt: 2,
          maxAttempts: 3,
          phase: 'retrying',
          lastError: 'legacy invalid plan'
        }
      })

      let created = false
      const recovered = new TurnService({
        threadStore,
        sessionStore,
        events,
        inflight,
        steering,
        compactor: new ContextCompactor(),
        createGraphPlanningDraft: async () => {
          created = true
          return {
            version: 1,
            draftId: 'draft_migrated',
            reservedRunId: 'run_migrated',
            state: 'planning',
            draftRevision: 1
          }
        },
        transitionGraphPlanningDraft: async ({ action }) => created
          ? {
              version: 1,
              draftId: 'draft_migrated',
              reservedRunId: 'run_migrated',
              state: action === 'suspend' ? 'needs_correction' : 'planning',
              draftRevision: 2
            }
          : null,
        ids: new SequentialIdGenerator(),
        nowIso
      })

      await expect(recovered.suspendGraphPlanningTurn({
        threadId: 'thr_graph_legacy_gate',
        turnId: started.turnId
      })).resolves.toBe('suspended')
      expect(created).toBe(true)
      expect(await recovered.getTurn('thr_graph_legacy_gate', started.turnId)).toMatchObject({
        status: 'running',
        graphPlanningLifecycle: {
          draftId: 'draft_migrated',
          state: 'needs_correction'
        }
      })
      expect((await recovered.getTurn('thr_graph_legacy_gate', started.turnId))
        ?.requiredToolGate).toBeUndefined()
    })
})
