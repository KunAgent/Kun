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
