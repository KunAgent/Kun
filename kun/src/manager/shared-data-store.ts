import { readFile, rm } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { HybridSessionStore } from '../adapters/hybrid/hybrid-session-store.js'
import { HybridThreadStore } from '../adapters/hybrid/hybrid-thread-store.js'
import {
  FileArtifactStore,
  type ArtifactStore
} from '../artifacts/artifact-store.js'
import { FileAttachmentStore, type AttachmentStore } from '../attachments/attachment-store.js'
import {
  AttachmentsCapabilityConfig,
  MemoryCapabilityConfig
} from '../contracts/capabilities.js'
import {
  DEFAULT_GRAPH_RUNTIME_CONFIG,
  GraphRuntimeConfigSchema,
  type GraphRuntimeConfig
} from '../config/kun-config.js'
import { RuntimeEvent, type RuntimeEvent as RuntimeEventValue } from '../contracts/events.js'
import {
  AttachmentMetadata,
  AttachmentUploadRequest
} from '../contracts/attachments.js'
import {
  GraphDomainEventV1Schema,
  GraphPlanV1Schema,
  GraphRunIdSchema,
  GraphRunStatusSchema
} from '../contracts/graph.js'
import { TurnItem } from '../contracts/items.js'
import {
  MemoryCreateRequest,
  MemoryUpdateRequest
} from '../contracts/memory.js'
import { ThreadSchema } from '../contracts/threads.js'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import type { AgentSession } from '../domain/session.js'
import { makeErrorItem } from '../domain/item.js'
import { finishTurn } from '../domain/turn.js'
import {
  type FinishedTurnStatus,
  finalizeTurnItems
} from '../domain/turn-item-finalization.js'
import { FileMemoryStore, type MemoryStore } from '../memory/memory-store.js'
import { FileGraphRunStore, type GraphRunStore } from '../graph/graph-run-store.js'
import type {
  ItemHistoryCommit,
  ItemHistoryCompactionResult,
  ItemHistorySnapshot,
  SessionLatestUsageSnapshot,
  SessionStore,
  SessionUsageRecord
} from '../ports/session-store.js'
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RevisionConflictError } from './revisioned-document-store.js'

const ThreadIdSchema = z.string().min(1).max(256)

function finishedTurnStatus(status: string): FinishedTurnStatus | null {
  return status === 'completed' || status === 'failed' || status === 'aborted' ? status : null
}

function ownerLeaseExpiredMessage(lease: ThreadExecutionLease): string {
  return `Turn owner ${lease.ownerFlavor}/${lease.ownerInstanceId} stopped heartbeating.`
}

function ownerLeaseExpiredItemId(turnId: string): string {
  return `item_${turnId}_owner_lease_expired`
}

const AgentSessionSchema = z.object({
  threadId: ThreadIdSchema,
  turnId: z.string().min(1).max(256),
  startedAt: z.string(),
  updatedAt: z.string(),
  items: z.array(TurnItem),
  events: z.array(RuntimeEvent),
  closed: z.boolean()
})

export type ManagerThreadStoreOperation =
  | 'list'
  | 'get'
  | 'getMetadata'
  | 'touch'
  | 'upsert'
  | 'delete'

export type ManagerSessionStoreOperation =
  | 'appendEvent'
  | 'appendItem'
  | 'rewriteItems'
  | 'loadItemSnapshot'
  | 'rewriteItemsIfRevision'
  | 'updateItem'
  | 'compactItems'
  | 'loadEventsSince'
  | 'loadItems'
  | 'loadSession'
  | 'upsertSession'
  | 'highestSeq'
  | 'allocateEventSeq'
  | 'loadUsageRecords'
  | 'loadLatestUsageSnapshots'
  | 'resetMemory'
  | 'clearThreadMemory'

export type ManagerArtifactStoreOperation =
  | 'put'
  | 'delete'
  | 'list'
  | 'get'
  | 'readRange'
  | 'stat'

export type ManagerMemoryStoreOperation =
  | 'create'
  | 'createWithId'
  | 'update'
  | 'delete'
  | 'purge'
  | 'list'
  | 'retrieve'
  | 'diagnostics'

export type ManagerGraphStoreOperation =
  | 'create'
  | 'append'
  | 'get'
  | 'list'
  | 'events'
  | 'eventReplay'
  | 'snapshot'
  | 'remove'
  | 'diagnostics'

export type ManagerAttachmentStoreOperation =
  | 'create'
  | 'get'
  | 'bindScope'
  | 'bindScopes'
  | 'delete'
  | 'releaseLease'
  | 'pruneExpiredLeases'
  | 'replaceMetadata'
  | 'resolveContent'
  | 'diagnostics'

/**
 * Canonical manager-owned storage composition.
 *
 * HybridThreadStore retains the existing JSONL documents as the source of
 * truth and its SQLite database as a rebuildable index. No migration or data
 * copy is performed when the manager takes ownership.
 */
export class ManagerSharedDataStore {
  readonly threadStore: ThreadStore
  readonly sessionStore: SessionStore
  private readonly hybridThreadStore: HybridThreadStore
  private readonly artifactStore: ArtifactStore
  private readonly attachmentStores = new Map<string, AttachmentStore>()
  private attachmentQueue: Promise<unknown> = Promise.resolve()
  private readonly graphStore: GraphRunStore
  private graphConfig: GraphRuntimeConfig = DEFAULT_GRAPH_RUNTIME_CONFIG
  private graphQueue: Promise<unknown> = Promise.resolve()
  private readonly memoryStores = new Map<string, MemoryStore>()
  private memoryQueue: Promise<unknown> = Promise.resolve()
  private readonly seqFloors = new Map<string, number>()
  private readonly reservedSeqs = new Map<string, Set<number>>()
  private readonly seqQueues = new Map<string, Promise<unknown>>()
  private readonly mutationQueues = new Map<string, Promise<unknown>>()
  private readonly controlThreads = new Map<string, string>()
  private readonly dataDir: string
  private readonly atomicJsonDocuments = new Map<string, {
    revision: number
    loaded: boolean
    value: unknown | null
    queue: Promise<unknown>
  }>()

  private constructor(input: {
    dataDir: string
    threadStore: HybridThreadStore
    sessionStore: HybridSessionStore
  }) {
    this.dataDir = resolve(input.dataDir)
    this.hybridThreadStore = input.threadStore
    this.threadStore = input.threadStore
    this.sessionStore = input.sessionStore
    this.artifactStore = new FileArtifactStore(resolve(this.dataDir, 'artifacts'))
    this.graphStore = new FileGraphRunStore({
      rootDir: resolve(this.dataDir, 'graphs'),
      config: () => this.graphConfig,
      artifactStore: this.artifactStore
    })
  }

  static async create(dataDir: string): Promise<ManagerSharedDataStore> {
    const threadStore = new HybridThreadStore({ dataDir })
    await threadStore.ready()
    return new ManagerSharedDataStore({
      dataDir,
      threadStore,
      sessionStore: new HybridSessionStore({ dataDir, index: threadStore })
    })
  }

  async readAtomicJson(path: string): Promise<{ revision: number; value: unknown | null }> {
    const target = this.safeDataPath(path)
    const document = this.atomicJsonDocument(target)
    await this.loadAtomicJson(target, document)
    return { revision: document.revision, value: document.value }
  }

  async writeAtomicJson(input: {
    path: string
    expectedRevision: number
    value: unknown
  }): Promise<{ revision: number; value: unknown }> {
    const target = this.safeDataPath(input.path)
    const document = this.atomicJsonDocument(target)
    const run = document.queue.catch(() => undefined).then(async () => {
      await this.loadAtomicJson(target, document)
      if (document.revision !== input.expectedRevision) {
        throw new RevisionConflictError(document.revision)
      }
      const serialized = `${JSON.stringify(input.value, null, 2)}\n`
      await atomicWriteFile(target, serialized)
      document.value = input.value
      document.revision += 1
      return { revision: document.revision, value: input.value }
    })
    document.queue = run.then(() => undefined, () => undefined)
    return run
  }

  async deleteAtomicJson(input: {
    path: string
    expectedRevision: number
  }): Promise<{ revision: number; value: null }> {
    const target = this.safeDataPath(input.path)
    const document = this.atomicJsonDocument(target)
    const run = document.queue.catch(() => undefined).then(async () => {
      await this.loadAtomicJson(target, document)
      if (document.revision !== input.expectedRevision) {
        throw new RevisionConflictError(document.revision)
      }
      await rm(target, { force: true })
      document.value = null
      document.revision += 1
      return { revision: document.revision, value: null } as const
    })
    document.queue = run.then(() => undefined, () => undefined)
    return run
  }

  async close(): Promise<void> {
    await this.hybridThreadStore.shutdown()
  }

  /**
   * Manager-owned orphan settlement. A Runtime may never sweep another
   * Runtime's live turn; only an expired owner lease reaches this path.
   */
  async reconcileExpiredLease(lease: ThreadExecutionLease): Promise<boolean> {
    return this.enqueueMutation(lease.threadId, async () => {
      const thread = await this.threadStore.get(lease.threadId)
      if (!thread) return false
      const target = thread.turns.find((turn) => turn.id === lease.turnId)
      if (!target) return false
      const wasActive = target.status === 'queued' || target.status === 'running'
      const terminalStatus = wasActive
        ? 'failed' as const
        : finishedTurnStatus(target.status)
      // A second reconciliation after a partial write must still settle the
      // session, but a lease that expired after a healthy completion must not
      // manufacture a new failure.
      if (!terminalStatus) return false
      const now = new Date().toISOString()
      const sessionItems = await this.sessionStore.loadItems(lease.threadId)
      let nextItems = finalizeTurnItems(sessionItems, {
        turnId: lease.turnId,
        status: terminalStatus,
        finishedAt: target.finishedAt ?? now
      })
      const shouldRecordLeaseFailure = wasActive || (
        target.status === 'failed' &&
        target.error === ownerLeaseExpiredMessage(lease)
      )
      const errorItemId = ownerLeaseExpiredItemId(lease.turnId)
      if (shouldRecordLeaseFailure && !nextItems.some((item) => item.id === errorItemId)) {
        nextItems = [...nextItems, makeErrorItem({
          id: errorItemId,
          turnId: lease.turnId,
          threadId: lease.threadId,
          message: 'Turn owner stopped heartbeating.',
          code: 'owner_lease_expired',
          severity: 'warning'
        })]
      }
      if (nextItems !== sessionItems) {
        await this.executeSessionNow('rewriteItems', {
          threadId: lease.threadId,
          items: nextItems
        })
      }

      if (!wasActive) return nextItems !== sessionItems
      const turns = thread.turns.map((turn) => turn.id === lease.turnId
        ? {
            ...finishTurn(turn, 'failed', now),
            error: ownerLeaseExpiredMessage(lease)
          }
        : turn)
      await this.threadStore.upsert({
        ...thread,
        turns,
        status: thread.status === 'archived'
          ? 'archived'
          : turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
            ? 'running'
            : 'idle',
        updatedAt: now
      })
      const seq = await this.allocateEventSeq(lease.threadId)
      await this.executeSessionNow('appendEvent', {
        threadId: lease.threadId,
        event: {
          kind: 'turn_failed',
          threadId: lease.threadId,
          turnId: lease.turnId,
          seq,
          timestamp: now,
          message: 'Turn owner stopped heartbeating.',
          code: 'owner_lease_expired',
          severity: 'warning'
        }
      })
      return true
    })
  }

  async executeThread(operation: ManagerThreadStoreOperation, value: unknown): Promise<unknown> {
    const threadId = mutationThreadId(value)
    if (threadId && isThreadMutation(operation)) {
      return this.enqueueMutation(threadId, () => this.executeThreadNow(operation, value))
    }
    return this.executeThreadNow(operation, value)
  }

  private async executeThreadNow(
    operation: ManagerThreadStoreOperation,
    value: unknown
  ): Promise<unknown> {
    switch (operation) {
      case 'list': {
        const options = z.object({
          limit: z.number().int().positive().optional(),
          search: z.string().optional(),
          includeArchived: z.boolean().optional(),
          archivedOnly: z.boolean().optional(),
          includeSide: z.boolean().optional()
        }).strict().parse(value ?? {}) as ThreadStoreListOptions
        return this.threadStore.list(options)
      }
      case 'get': {
        const { threadId } = parseThreadId(value)
        return this.threadStore.get(threadId)
      }
      case 'getMetadata': {
        const { threadId } = parseThreadId(value)
        return this.threadStore.getMetadata?.(threadId) ?? this.threadStore.get(threadId)
      }
      case 'touch': {
        const body = z.object({ threadId: ThreadIdSchema, updatedAt: z.string() }).strict().parse(value)
        return this.threadStore.touch?.(body.threadId, body.updatedAt) ?? false
      }
      case 'upsert':
        return this.threadStore.upsert(ThreadSchema.parse(z.object({ thread: z.unknown() }).parse(value).thread))
      case 'delete': {
        const { threadId } = parseThreadId(value)
        this.seqFloors.delete(threadId)
        this.reservedSeqs.delete(threadId)
        return this.threadStore.delete(threadId)
      }
    }
  }

  async executeSession(operation: ManagerSessionStoreOperation, value: unknown): Promise<unknown> {
    const threadId = mutationThreadId(value)
    if (threadId && isSessionMutation(operation)) {
      return this.enqueueMutation(threadId, () => this.executeSessionNow(operation, value))
    }
    return this.executeSessionNow(operation, value)
  }

  async executeArtifact(operation: ManagerArtifactStoreOperation, value: unknown): Promise<unknown> {
    switch (operation) {
      case 'put': {
        const body = z.object({
          input: z.object({
            content: z.string(),
            mimeType: z.string().min(1).optional(),
            source: z.enum(['mcp', 'web', 'bash', 'attachment', 'remote-log', 'tool', 'other']).optional(),
            origin: z.string().min(1).optional(),
            maxInlineChars: z.number().int().nonnegative().optional()
          }).strict()
        }).strict().parse(value)
        return this.artifactStore.put(body.input)
      }
      case 'delete': {
        const { id } = parseArtifactId(value)
        await this.artifactStore.delete?.(id)
        return null
      }
      case 'list':
        return this.artifactStore.list?.() ?? []
      case 'get':
        return this.artifactStore.get(parseArtifactId(value).id)
      case 'readRange': {
        const body = z.object({
          id: z.string().min(1).max(256),
          options: z.object({
            offset: z.number().int().nonnegative().optional(),
            length: z.number().int().nonnegative().optional(),
            startLine: z.number().int().positive().optional(),
            endLine: z.number().int().positive().optional()
          }).strict()
        }).strict().parse(value)
        return this.artifactStore.readRange(body.id, body.options)
      }
      case 'stat':
        return this.artifactStore.stat(parseArtifactId(value).id)
    }
  }

  async executeMemory(operation: ManagerMemoryStoreOperation, value: unknown): Promise<unknown> {
    const body = z.object({ config: MemoryCapabilityConfig, value: z.unknown().optional() })
      .strict()
      .parse(value)
    const store = this.memoryStore(body.config)
    const run = this.memoryQueue.catch(() => undefined).then(async () => {
      switch (operation) {
        case 'create':
          return store.create(MemoryCreateRequest.parse(body.value))
        case 'createWithId': {
          const request = z.object({ id: z.string().min(1), input: MemoryCreateRequest }).strict().parse(body.value)
          return store.createWithId?.(request.id, request.input) ?? store.create(request.input)
        }
        case 'update': {
          const request = z.object({
            id: z.string().min(1),
            patch: MemoryUpdateRequest,
            access: z.object({ workspace: z.string().optional() }).strict().optional()
          }).strict().parse(body.value)
          return store.update(request.id, request.patch, request.access)
        }
        case 'delete': {
          const request = z.object({
            id: z.string().min(1),
            access: z.object({ workspace: z.string().optional() }).strict().optional()
          }).strict().parse(body.value)
          return store.delete(request.id, request.access)
        }
        case 'purge': {
          const request = z.object({ id: z.string().min(1) }).strict().parse(body.value)
          await store.purge?.(request.id)
          return null
        }
        case 'list': {
          const filter = z.object({
            workspace: z.string().optional(),
            includeDeleted: z.boolean().optional(),
            all: z.boolean().optional()
          }).strict().parse(body.value ?? {})
          return store.list(filter)
        }
        case 'retrieve': {
          const request = z.object({
            query: z.string(),
            workspace: z.string().optional(),
            limit: z.number().int().positive().optional(),
            fallbackQuery: z.string().optional(),
            allowRecencyFallback: z.boolean().optional()
          }).strict().parse(body.value)
          return store.retrieve(request)
        }
        case 'diagnostics':
          return store.diagnostics()
      }
    })
    this.memoryQueue = run.then(() => undefined, () => undefined)
    return run
  }

  async executeGraph(operation: ManagerGraphStoreOperation, value: unknown): Promise<unknown> {
    const body = z.object({ config: GraphRuntimeConfigSchema, value: z.unknown().optional() })
      .strict()
      .parse(value)
    const run = this.graphQueue.catch(() => undefined).then(async () => {
      this.graphConfig = body.config
      switch (operation) {
        case 'create': {
          const input = z.object({
            runId: GraphRunIdSchema,
            threadId: z.string().min(1),
            projectId: z.string().min(1),
            sourceTurnId: z.string().min(1),
            plan: GraphPlanV1Schema,
            commandId: z.string().min(1),
            idempotencyKey: z.string().min(1)
          }).strict().parse(body.value)
          return this.graphStore.create(input)
        }
        case 'append': {
          const request = z.object({
            runId: GraphRunIdSchema,
            input: z.object({
              expectedSeq: z.number().int().nonnegative(),
              graphRevision: z.number().int().positive(),
              eventId: z.string().min(1).optional(),
              commandId: z.string().min(1).optional(),
              idempotencyKey: z.string().min(1).optional(),
              timestamp: z.string().optional(),
              event: GraphDomainEventV1Schema
            }).strict()
          }).strict().parse(body.value)
          return this.graphStore.append(request.runId, request.input)
        }
        case 'get': {
          const { runId } = parseGraphRunId(body.value)
          return this.graphStore.get(runId)
        }
        case 'list': {
          const filter = z.object({
            threadId: z.string().min(1).optional(),
            projectId: z.string().min(1).optional(),
            statuses: z.array(GraphRunStatusSchema).optional()
          }).strict().parse(body.value ?? {})
          return this.graphStore.list(filter)
        }
        case 'events':
        case 'eventReplay': {
          const request = z.object({
            runId: GraphRunIdSchema,
            sinceSeq: z.number().int().nonnegative().optional()
          }).strict().parse(body.value)
          return operation === 'events'
            ? this.graphStore.events(request.runId, request.sinceSeq)
            : this.graphStore.eventReplay?.(request.runId, request.sinceSeq)
        }
        case 'snapshot':
          return this.graphStore.snapshot(parseGraphRunId(body.value).runId)
        case 'remove': {
          await this.graphStore.remove(parseGraphRunId(body.value).runId)
          return null
        }
        case 'diagnostics':
          return this.graphStore.diagnostics?.() ?? []
      }
    })
    this.graphQueue = run.then(() => undefined, () => undefined)
    return run
  }

  async executeAttachment(
    operation: ManagerAttachmentStoreOperation,
    value: unknown
  ): Promise<unknown> {
    const body = z.object({ config: AttachmentsCapabilityConfig, value: z.unknown().optional() })
      .strict()
      .parse(value)
    const store = this.attachmentStore(body.config)
    const run = this.attachmentQueue.catch(() => undefined).then(async () => {
      switch (operation) {
        case 'create': {
          const request = AttachmentUploadRequest.parse(body.value)
          const { dataBase64, ...input } = request
          return store.create({
            ...input,
            data: Buffer.from(dataBase64, 'base64')
          })
        }
        case 'get':
          return store.get(parseAttachmentId(body.value).id)
        case 'bindScope': {
          const request = attachmentScopeRequest(body.value)
          return store.bindScope(request.id, request.scope)
        }
        case 'bindScopes': {
          const request = z.object({
            ids: z.array(z.string().min(1)),
            scope: z.object({ threadId: z.string().optional(), workspace: z.string().optional() }).strict()
          }).strict().parse(body.value)
          return store.bindScopes(request.ids, request.scope)
        }
        case 'delete':
          await store.delete?.(parseAttachmentId(body.value).id)
          return null
        case 'releaseLease': {
          const request = z.object({
            id: z.string().min(1),
            leaseId: z.string().min(1),
            referenced: z.boolean()
          }).strict().parse(body.value)
          return store.releaseLease?.(request.id, request.leaseId, request.referenced) ?? false
        }
        case 'pruneExpiredLeases': {
          const request = z.object({
            referencedIds: z.array(z.string().min(1)),
            expiresBeforeIso: z.string()
          }).strict().parse(body.value)
          return store.pruneExpiredLeases?.(
            new Set(request.referencedIds),
            request.expiresBeforeIso
          ) ?? { deleted: 0, released: 0 }
        }
        case 'replaceMetadata': {
          await store.replaceMetadata?.(AttachmentMetadata.parse(body.value))
          return null
        }
        case 'resolveContent': {
          const request = attachmentScopeRequest(body.value)
          const content = await store.resolveContent(request.id, request.scope)
          const { data, ...metadata } = content
          return { ...metadata, dataBase64: data.toString('base64') }
        }
        case 'diagnostics':
          return store.diagnostics()
      }
    })
    this.attachmentQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async executeSessionNow(
    operation: ManagerSessionStoreOperation,
    value: unknown
  ): Promise<unknown> {
    switch (operation) {
      case 'appendEvent': {
        const body = z.object({ threadId: ThreadIdSchema, event: RuntimeEvent }).strict().parse(value)
        if (body.event.threadId !== body.threadId) throw new Error('event threadId does not match request')
        const reserved = this.reservedSeqs.get(body.threadId)
        if (!reserved?.delete(body.event.seq)) {
          const highest = Math.max(
            this.seqFloors.get(body.threadId) ?? 0,
            await this.sessionStore.highestSeq(body.threadId)
          )
          if (body.event.seq <= highest) {
            throw new Error(
              `event sequence ${body.event.seq} is not newer than manager high-water ${highest}`
            )
          }
        }
        await this.sessionStore.appendEvent(body.threadId, body.event)
        this.noteEventSeq(body.threadId, body.event.seq)
        this.noteControlEvent(body.event)
        return null
      }
      case 'appendItem': {
        const body = z.object({ threadId: ThreadIdSchema, item: TurnItem }).strict().parse(value)
        if (body.item.threadId !== body.threadId) throw new Error('item threadId does not match request')
        await this.sessionStore.appendItem(body.threadId, body.item)
        return null
      }
      case 'rewriteItems': {
        const body = z.object({ threadId: ThreadIdSchema, items: z.array(TurnItem) }).strict().parse(value)
        await this.sessionStore.rewriteItems(body.threadId, body.items)
        return null
      }
      case 'loadItemSnapshot': {
        const { threadId } = parseThreadId(value)
        return this.sessionStore.loadItemSnapshot(threadId)
      }
      case 'rewriteItemsIfRevision': {
        const body = z.object({
          threadId: ThreadIdSchema,
          expectedRevision: z.number().int().nonnegative(),
          items: z.array(TurnItem)
        }).strict().parse(value)
        return this.sessionStore.rewriteItemsIfRevision(
          body.threadId,
          body.expectedRevision,
          body.items
        )
      }
      case 'updateItem': {
        const body = z.object({
          threadId: ThreadIdSchema,
          itemId: z.string().min(1).max(256),
          patch: z.record(z.string(), z.unknown())
        }).strict().parse(value)
        return this.sessionStore.updateItem(body.threadId, body.itemId, body.patch)
      }
      case 'compactItems': {
        const body = z.object({
          threadId: ThreadIdSchema,
          options: z.object({ force: z.boolean().optional() }).strict().optional()
        }).strict().parse(value)
        return this.sessionStore.compactItems?.(body.threadId, body.options) ?? {
          compacted: false,
          beforeBytes: 0,
          afterBytes: 0,
          itemCount: (await this.sessionStore.loadItems(body.threadId)).length
        }
      }
      case 'loadEventsSince': {
        const body = z.object({
          threadId: ThreadIdSchema,
          sinceSeq: z.number().int().nonnegative()
        }).strict().parse(value)
        return this.sessionStore.loadEventsSince(body.threadId, body.sinceSeq)
      }
      case 'loadItems': {
        const { threadId } = parseThreadId(value)
        return this.sessionStore.loadItems(threadId)
      }
      case 'loadSession': {
        const { threadId } = parseThreadId(value)
        return this.sessionStore.loadSession(threadId)
      }
      case 'upsertSession': {
        const session = AgentSessionSchema.parse(
          z.object({ session: z.unknown() }).strict().parse(value).session
        ) as AgentSession
        await this.sessionStore.upsertSession(session)
        return null
      }
      case 'highestSeq': {
        const { threadId } = parseThreadId(value)
        return this.sessionStore.highestSeq(threadId)
      }
      case 'allocateEventSeq': {
        const { threadId } = parseThreadId(value)
        return this.allocateEventSeq(threadId)
      }
      case 'loadUsageRecords': {
        const body = z.object({ threadId: ThreadIdSchema.optional() }).strict().parse(value ?? {})
        return this.sessionStore.loadUsageRecords?.(body) ?? []
      }
      case 'loadLatestUsageSnapshots': {
        const body = z.object({ threadIds: z.array(ThreadIdSchema).optional() }).strict().parse(value ?? {})
        return this.sessionStore.loadLatestUsageSnapshots?.(body) ?? []
      }
      case 'resetMemory':
        await this.sessionStore.resetMemory()
        return null
      case 'clearThreadMemory': {
        const { threadId } = parseThreadId(value)
        this.sessionStore.clearThreadMemory(threadId)
        this.seqFloors.delete(threadId)
        this.reservedSeqs.delete(threadId)
        return null
      }
    }
  }

  private async allocateEventSeq(threadId: string): Promise<number> {
    return this.enqueueSeq(threadId, async () => {
      let floor = this.seqFloors.get(threadId)
      if (floor === undefined) floor = await this.sessionStore.highestSeq(threadId)
      const next = floor + 1
      this.seqFloors.set(threadId, next)
      const reserved = this.reservedSeqs.get(threadId) ?? new Set<number>()
      reserved.add(next)
      this.reservedSeqs.set(threadId, reserved)
      return next
    })
  }

  private noteEventSeq(threadId: string, seq: number): void {
    this.seqFloors.set(threadId, Math.max(seq, this.seqFloors.get(threadId) ?? 0))
  }

  controlThread(kind: 'approval' | 'user-input', id: string): string | null {
    return this.controlThreads.get(`${kind}:${id}`) ?? null
  }

  private noteControlEvent(event: RuntimeEventValue): void {
    if (event.kind === 'approval_requested') {
      this.controlThreads.set(`approval:${event.approvalId}`, event.threadId)
    } else if (event.kind === 'approval_resolved') {
      this.controlThreads.delete(`approval:${event.approvalId}`)
    } else if (event.kind === 'user_input_requested') {
      this.controlThreads.set(`user-input:${event.inputId}`, event.threadId)
    } else if (event.kind === 'user_input_resolved') {
      this.controlThreads.delete(`user-input:${event.inputId}`)
    }
  }

  private async enqueueSeq<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.seqQueues.get(threadId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const guard = current.then(() => undefined, () => undefined)
    this.seqQueues.set(threadId, guard)
    try {
      return await current
    } finally {
      if (this.seqQueues.get(threadId) === guard) this.seqQueues.delete(threadId)
    }
  }

  private async enqueueMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(threadId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const guard = current.then(() => undefined, () => undefined)
    this.mutationQueues.set(threadId, guard)
    try {
      return await current
    } finally {
      if (this.mutationQueues.get(threadId) === guard) this.mutationQueues.delete(threadId)
    }
  }

  private safeDataPath(path: string): string {
    const target = resolve(this.dataDir, path)
    const pathRelative = relative(this.dataDir, target)
    const sharedMcpPath = resolve(this.dataDir, '..', 'mcp.json')
    if (target !== sharedMcpPath && (
      !pathRelative ||
      pathRelative === '.' ||
      pathRelative.startsWith(`..${sep}`) ||
      pathRelative === '..'
    )) {
      throw new Error('atomic JSON path must be a file below the canonical data directory')
    }
    if (!/\.json$/iu.test(target)) throw new Error('manager atomic document must use a .json filename')
    return target
  }

  private atomicJsonDocument(path: string) {
    let document = this.atomicJsonDocuments.get(path)
    if (!document) {
      document = { revision: 0, loaded: false, value: null, queue: Promise.resolve() }
      this.atomicJsonDocuments.set(path, document)
    }
    return document
  }

  private memoryStore(config: z.infer<typeof MemoryCapabilityConfig>): MemoryStore {
    const key = JSON.stringify(config)
    let store = this.memoryStores.get(key)
    if (!store) {
      store = new FileMemoryStore({
        rootDir: resolve(this.dataDir, 'memory'),
        config
      })
      this.memoryStores.set(key, store)
    }
    return store
  }

  private attachmentStore(config: z.infer<typeof AttachmentsCapabilityConfig>): AttachmentStore {
    const key = JSON.stringify(config)
    let store = this.attachmentStores.get(key)
    if (!store) {
      store = new FileAttachmentStore({
        rootDir: resolve(this.dataDir, 'attachments'),
        config
      })
      this.attachmentStores.set(key, store)
    }
    return store
  }

  private async loadAtomicJson(
    path: string,
    document: { revision: number; loaded: boolean; value: unknown | null }
  ): Promise<void> {
    if (document.loaded) return
    try {
      document.value = JSON.parse(await readFile(path, 'utf8')) as unknown
      document.revision = 1
    } catch (error) {
      if (String((error as { code?: unknown })?.code ?? '') !== 'ENOENT') throw error
      document.value = null
      document.revision = 0
    }
    document.loaded = true
  }
}

function parseThreadId(value: unknown): { threadId: string } {
  return z.object({ threadId: ThreadIdSchema }).strict().parse(value)
}

function parseArtifactId(value: unknown): { id: string } {
  return z.object({ id: z.string().min(1).max(256) }).strict().parse(value)
}

function parseGraphRunId(value: unknown): { runId: string } {
  return z.object({ runId: GraphRunIdSchema }).strict().parse(value)
}

function parseAttachmentId(value: unknown): { id: string } {
  return z.object({ id: z.string().min(1) }).strict().parse(value)
}

function attachmentScopeRequest(value: unknown): {
  id: string
  scope: { threadId?: string; workspace?: string }
} {
  return z.object({
    id: z.string().min(1),
    scope: z.object({ threadId: z.string().optional(), workspace: z.string().optional() }).strict()
  }).strict().parse(value)
}

function mutationThreadId(value: unknown): string | null {
  const parsed = z.object({ threadId: ThreadIdSchema }).passthrough().safeParse(value)
  if (parsed.success) return parsed.data.threadId
  const session = z.object({ session: z.object({ threadId: ThreadIdSchema }).passthrough() })
    .passthrough()
    .safeParse(value)
  if (session.success) return session.data.session.threadId
  const thread = z.object({ thread: z.object({ id: ThreadIdSchema }).passthrough() })
    .passthrough()
    .safeParse(value)
  return thread.success ? thread.data.thread.id : null
}

function isThreadMutation(operation: ManagerThreadStoreOperation): boolean {
  return operation === 'touch' || operation === 'upsert' || operation === 'delete'
}

function isSessionMutation(operation: ManagerSessionStoreOperation): boolean {
  return operation === 'appendEvent' ||
    operation === 'appendItem' ||
    operation === 'rewriteItems' ||
    operation === 'rewriteItemsIfRevision' ||
    operation === 'updateItem' ||
    operation === 'compactItems' ||
    operation === 'upsertSession' ||
    operation === 'clearThreadMemory'
}

export type ManagerSharedDataResults = {
  itemSnapshot: ItemHistorySnapshot
  itemCommit: ItemHistoryCommit
  itemCompaction: ItemHistoryCompactionResult
  event: RuntimeEventValue
  usageRecord: SessionUsageRecord
  latestUsage: SessionLatestUsageSnapshot
}
