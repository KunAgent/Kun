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
  ItemHistoryPage,
  ItemHistoryPageOptions,
  ItemHistorySnapshot,
  SessionLatestUsageSnapshot,
  SessionStore,
  SessionUsageRecord
} from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RevisionConflictError } from './revisioned-document-store.js'
import { buildPublicItemHistoryPage } from '../services/item-history-page.js'

import { ManagerSharedDataStoreCore } from './shared-data-store-core.js'
import {
  AgentSessionSchema,
  SessionUsageQuerySchema,
  ThreadIdSchema,
  ThreadStoreListOptionsSchema,
  attachmentScopeRequest,
  isSessionMutation,
  isThreadMutation,
  mutationThreadId,
  parseArtifactId,
  parseAttachmentId,
  parseGraphRunId,
  parseThreadId
} from './shared-data-store-contracts.js'
import type {
  ManagerArtifactStoreOperation,
  ManagerAttachmentStoreOperation,
  ManagerGraphStoreOperation,
  ManagerMemoryStoreOperation,
  ManagerSessionStoreOperation,
  ManagerThreadStoreOperation
} from './shared-data-store-contracts.js'

export class ManagerSharedDataStore extends ManagerSharedDataStoreCore {
  static async create(dataDir: string): Promise<ManagerSharedDataStore> {
    const threadStore = new HybridThreadStore({ dataDir })
    await threadStore.ready()
    return new ManagerSharedDataStore({
      dataDir,
      threadStore,
      sessionStore: new HybridSessionStore({ dataDir, index: threadStore })
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
        const options = ThreadStoreListOptionsSchema.parse(value ?? {})
        return this.threadStore.list(options)
      }
      case 'listPage': {
        const options = ThreadStoreListOptionsSchema.parse(value ?? {})
        const listPage = this.threadStore.listPage
        if (!listPage) throw new Error('Manager thread store does not support paginated listing')
        return listPage.call(this.threadStore, options)
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
      case 'upsertIfRevision': {
        const body = z.object({
          thread: z.unknown(),
          expectedRevision: z.number().int().nonnegative()
        }).strict().parse(value)
        return this.threadStore.upsertIfRevision!(ThreadSchema.parse(body.thread), body.expectedRevision)
      }
      case 'delete': {
        const { threadId } = parseThreadId(value)
        this.seqFloors.delete(threadId)
        this.reservedSeqs.delete(threadId)
        return this.threadStore.delete(threadId)
      }
      case 'deleteByWorkspace': {
        const body = z.object({ workspace: z.string().min(1) }).strict().parse(value)
        return this.threadStore.deleteByWorkspace?.(body.workspace) ?? []
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
            linkedOwners: z.array(z.string().min(1).max(512)).max(64).optional(),
            maxInlineChars: z.number().int().nonnegative().optional()
          }).strict()
        }).strict().parse(value)
        return this.artifactStore.put(body.input)
      }
      case 'releaseOwner': {
        const body = z.object({
          ownerId: z.string().min(1).max(512)
        }).strict().parse(value)
        return this.artifactStore.releaseOwner?.(body.ownerId) ?? {
          released: 0,
          deleted: 0
        }
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
            limit: z.number().int().positive()
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

  protected async executeSessionNow(
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
      case 'searchItemText': {
        const body = z.object({
          threadId: ThreadIdSchema,
          query: z.string(),
          maxBytes: z.number().int().positive().optional(),
          deadlineAtMs: z.number().int().nonnegative().optional()
        }).strict().parse(value)
        // The owning store keeps the lock-free guarantee; a manager-backed
        // runtime without it reports no match rather than falling back to the
        // blocking item-load path.
        if (!this.sessionStore.searchItemText) return null
        return this.sessionStore.searchItemText(
          body.threadId,
          body.query,
          {
            ...(body.maxBytes === undefined ? {} : { maxBytes: body.maxBytes }),
            ...(body.deadlineAtMs === undefined ? {} : { deadlineAtMs: body.deadlineAtMs })
          }
        )
      }
      case 'loadItemPage': {
        const body = z.object({
          threadId: ThreadIdSchema,
          options: z.object({
            before: z.string().min(1).max(256).optional(),
            anchorTurnId: z.string().min(1).max(256).optional(),
            maxItems: z.number().int().positive().max(1_000),
            maxBytes: z.number().int().positive().max(16 * 1024 * 1024)
          }).strict()
        }).strict().parse(value) as { threadId: string; options: ItemHistoryPageOptions }
        if (this.sessionStore.loadItemPage) {
          return this.sessionStore.loadItemPage(body.threadId, body.options)
        }
        const page: ItemHistoryPage = buildPublicItemHistoryPage(
          await this.sessionStore.loadItems(body.threadId),
          body.options
        )
        return page
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
        const body = SessionUsageQuerySchema.parse(value ?? {})
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

}
