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
  TaskSurfaceLockedError,
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
  it('does not append goal context after an interrupt or discard has won the turn mutation', async () => {
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
      const threadId = 'thr_goal_context_interrupted'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Interrupted goal context',
        workspace: '/tmp/workspace',
        model: 'test-model',
        goal: {
          threadId,
          objective: 'This goal must not survive a discarded turn context write.',
          status: 'active',
          tokenBudget: 100,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      }))
      const started = await service.startTurn({
        threadId,
        request: { prompt: 'Start then discard.', model: 'test-model' }
      })

      await service.interruptTurn({ threadId, turnId: started.turnId, discard: true })
      await service.ensureGoalContext(threadId, started.turnId)

      expect((await sessionStore.loadItems(threadId)).some((item) => item.kind === 'goal_context'))
        .toBe(false)
      expect((await threadStore.get(threadId))?.turns[0]?.status).toBe('aborted')
    })

  it('does not append goal context when an execution signal aborts while history is loading', async () => {
      const sessionStore = new BlockingGoalContextSessionStore()
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
      const threadId = 'thr_goal_context_signal_abort'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Signal-aborted goal context',
        workspace: '/tmp/workspace',
        model: 'test-model',
        goal: {
          threadId,
          objective: 'Never append after an execution lease is lost.',
          status: 'active',
          tokenBudget: 100,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      }))
      const started = await service.startTurn({
        threadId,
        request: { prompt: 'Start then lose the execution lease.', model: 'test-model' }
      })
      const controller = new AbortController()
      sessionStore.blockNextLoad()
      const pending = service.ensureGoalContext(threadId, started.turnId, controller.signal)
      await sessionStore.loadItemsStarted
      controller.abort()
      sessionStore.release()
      await pending

      expect((await sessionStore.loadItems(threadId)).some((item) => item.kind === 'goal_context')).toBe(false)
      expect((await threadStore.get(threadId))?.turns[0]?.status).toBe('running')
    })

  it('claims an empty legacy thread on its first surfaced turn without reclassifying existing history', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-08-01T00:00:00.000Z'
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

      const empty = createThreadRecord({
        id: 'thr_empty_legacy',
        title: 'Empty legacy',
        workspace: '/tmp/workspace',
        model: 'test-model'
      })
      await threadStore.upsert(empty)
      const codeTurn = await service.startTurn({
        threadId: empty.id,
        request: { prompt: 'inspect the project', model: 'test-model', agentSurface: 'code' }
      })
      expect((await threadStore.get(empty.id))?.agentSurface).toBe('code')
      await service.interruptTurn({ threadId: empty.id, turnId: codeTurn.turnId })

      const existing = createThreadRecord({
        id: 'thr_existing_legacy',
        title: 'Existing legacy',
        workspace: '/tmp/workspace',
        model: 'test-model'
      })
      await threadStore.upsert({
        ...existing,
        turns: [finishTurn(createTurnRecord({
          id: 'turn_existing',
          threadId: existing.id,
          prompt: 'prior Code turn',
          model: existing.model
        }), 'completed', nowIso())]
      })
      await expect(service.startTurn({
        threadId: existing.id,
        request: { prompt: 'misdirected design request', model: 'test-model', agentSurface: 'design' }
      })).rejects.toBeInstanceOf(TaskSurfaceLockedError)
      expect((await threadStore.get(existing.id))?.agentSurface).toBeUndefined()
      expect((await threadStore.list()).find((thread) => thread.id === existing.id)?.agentSurface).toBe('code')
    })

  it('claims only a strictly identifiable legacy Work thread on its next Work send', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-08-01T00:00:00.000Z'
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
      const legacy = createThreadRecord({
        id: 'thr_legacy_work',
        title: 'Write Assistant',
        workspace: '/tmp/write',
        model: 'test-model'
      })
      const legacyTurn = finishTurn(createTurnRecord({
        id: 'turn_legacy_work',
        threadId: legacy.id,
        prompt: '[写作上下文]\n交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。\n\n请润色当前文档',
        model: legacy.model
      }), 'completed', nowIso())
      const legacyUserItem = makeUserItem({
        id: 'item_legacy_work',
        turnId: legacyTurn.id,
        threadId: legacy.id,
        text: legacyTurn.prompt
      })
      await threadStore.upsert({
        ...legacy,
        turns: [{ ...legacyTurn, items: [legacyUserItem] }]
      })
      expect((await threadStore.list()).find((thread) => thread.id === legacy.id)?.agentSurface)
        .toBe('write')

      const started = await service.startTurn({
        threadId: legacy.id,
        request: {
          prompt: '[写作上下文]\n交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。\n\n继续修改',
          model: 'test-model',
          agentSurface: 'write'
        }
      })

      expect((await threadStore.get(legacy.id))?.agentSurface).toBe('write')
      expect(started).toMatchObject({ agentSurface: 'write', threadAgentSurface: 'write' })
      await service.interruptTurn({ threadId: legacy.id, turnId: started.turnId })
    })

  it('binds submitted attachments to the final thread before persisting the turn', async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-turn-attachment-'))
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
        const threadId = 'thr_attachment_final'
        await threadStore.upsert(createThreadRecord({
          id: threadId,
          title: 'Attachment turn',
          workspace: '/tmp/workspace',
          model: 'deepseek-v4-pro'
        }))
        const attachment = await attachmentStore.create({
          name: 'draft.png',
          data: testPng(),
          workspace: '/tmp/workspace'
        })

        const started = await service.startTurn({
          threadId,
          request: { prompt: 'inspect', model: 'm', attachmentIds: [attachment.id, attachment.id] }
        })

        await expect(attachmentStore.resolveContent(attachment.id, { threadId })).resolves.toMatchObject({
          id: attachment.id
        })
        expect((await threadStore.get(threadId))?.turns[0]?.attachmentIds).toEqual([attachment.id])
        expect((await sessionStore.loadItems(threadId))[0]).toMatchObject({
          attachmentIds: [attachment.id]
        })
        await service.interruptTurn({ threadId, turnId: started.turnId })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

  it('does not persist a turn when a submitted attachment is missing', async () => {
      const sessionStore = new InMemorySessionStore()
      const threadStore = new InMemoryThreadStore()
      const eventBus = new InMemoryEventBus()
      const nowIso = () => '2026-07-24T00:00:00.000Z'
      const bindScopes = async (): Promise<never> => {
        throw new Error('attachment not found: att_000000000000000000000000')
      }
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
        attachmentStore: () => ({ bindScopes } as never),
        ids: new SequentialIdGenerator(),
        nowIso
      })
      const threadId = 'thr_attachment_missing'
      await threadStore.upsert(createThreadRecord({
        id: threadId,
        title: 'Missing attachment',
        workspace: '/tmp/workspace',
        model: 'deepseek-v4-pro'
      }))

      await expect(service.startTurn({
        threadId,
        request: {
          prompt: 'inspect',
          model: 'm',
          attachmentIds: ['att_000000000000000000000000']
        }
      })).rejects.toThrow(/attachment not found/)

      expect((await threadStore.get(threadId))?.turns).toEqual([])
      expect(await sessionStore.loadItems(threadId)).toEqual([])
    })

  it('does not bind any attachment when batch validation fails', async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-turn-attachment-batch-'))
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
        const threadId = 'thr_attachment_batch_failure'
        await threadStore.upsert(createThreadRecord({
          id: threadId,
          title: 'Attachment batch failure',
          workspace: '/tmp/workspace',
          model: 'deepseek-v4-pro'
        }))
        const valid = await attachmentStore.create({
          name: 'valid.png',
          data: testPng(),
          workspace: '/tmp/workspace'
        })

        await expect(service.startTurn({
          threadId,
          request: {
            prompt: 'inspect',
            model: 'm',
            attachmentIds: [valid.id, 'att_000000000000000000000000']
          }
        })).rejects.toThrow(/attachment not found/)

        expect(await attachmentStore.get(valid.id)).toMatchObject({ threadIds: [] })
        expect((await threadStore.get(threadId))?.turns).toEqual([])
        expect(await sessionStore.loadItems(threadId)).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
})
