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
  it('preserves every thread scope when turns bind the same attachment concurrently', async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-turn-attachment-concurrent-'))
      try {
        const sessionStore = new InMemorySessionStore()
        const threadStore = new InMemoryThreadStore()
        const eventBus = new InMemoryEventBus()
        const nowIso = () => '2026-07-24T00:00:00.000Z'
        const attachmentStore = new FileAttachmentStore({
          rootDir: join(root, 'attachments'),
          config: KunCapabilitiesConfig.parse({ attachments: { enabled: true } }).attachments,
          nowIso
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
          inflight: new InflightTracker(),
          steering: new SteeringQueue(),
          compactor: new ContextCompactor(),
          attachmentStore: () => attachmentStore,
          ids: new SequentialIdGenerator(),
          nowIso
        })
        const threadIds = ['thr_attachment_concurrent_a', 'thr_attachment_concurrent_b']
        for (const threadId of threadIds) {
          await threadStore.upsert(createThreadRecord({
            id: threadId,
            title: threadId,
            workspace: '/tmp/shared-workspace',
            model: 'deepseek-v4-pro'
          }))
        }
        const attachment = await attachmentStore.create({
          name: 'shared.png',
          data: testPng(),
          workspace: '/tmp/shared-workspace'
        })

        const starts = await Promise.all(threadIds.map((threadId) => service.startTurn({
          threadId,
          request: { prompt: 'inspect', model: 'm', attachmentIds: [attachment.id] }
        })))

        expect((await attachmentStore.get(attachment.id))?.threadIds.sort()).toEqual([...threadIds].sort())
        await Promise.all(starts.map((started, index) =>
          service.interruptTurn({ threadId: threadIds[index], turnId: started.turnId })
        ))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

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
        model: 'deepseek-v4-pro',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      }))

      const [first, second] = await Promise.allSettled([
        service.startTurn({
          threadId,
          request: {
            prompt: 'first', model: 'm', providerId: 'provider-a', accountId: 'account-a',
            reasoningEffort: 'high', serviceTier: 'priority', mode: 'plan', clientSurface: 'tui'
          }
        }),
        service.startTurn({ threadId, request: { prompt: 'second', model: 'm' } })
      ])

      expect(first.status).toBe('fulfilled')
      expect(second).toMatchObject({ status: 'rejected', reason: expect.any(TurnConflictError) })
      const thread = await threadStore.get(threadId)
      expect(thread?.turns).toHaveLength(1)
      expect(thread?.turns[0]?.status).toBe('running')
      expect(thread?.turns[0]).toMatchObject({
        serviceTier: 'priority',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      })
      const liveTurnStarted = eventBus.snapshotSince(threadId, 0)
        .find((event) => event.kind === 'turn_started')
      expect(liveTurnStarted).toMatchObject({
        kind: 'turn_started', model: 'm', providerId: 'provider-a', accountId: 'account-a',
        reasoningEffort: 'high', serviceTier: 'priority', mode: 'plan', clientSurface: 'tui',
        approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'agent'
      })
      const replayedTurnStarted = (await sessionStore.loadEventsSince(threadId, 0))
        .find((event) => event.kind === 'turn_started')
      expect(replayedTurnStarted).toMatchObject({
        kind: 'turn_started',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      })
      expect(thread?.turns[0]?.clientSurface).toBe('tui')
      await service.updateTurnMetadata(threadId, thread!.turns[0]!.id, {
        actingModelRoute: {
          model: 'input-model',
          providerId: 'provider-a',
          accountId: 'account-a'
        }
      })
      await service.updateTurnMetadata(threadId, thread!.turns[0]!.id, {
        actingModelRoute: {
          model: 'changed-later',
          providerId: 'provider-b',
          accountId: 'account-b'
        }
      })
      expect((await threadStore.get(threadId))?.turns[0]?.actingModelRoute).toEqual({
        model: 'input-model',
        providerId: 'provider-a',
        accountId: 'account-a'
      })
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
})
