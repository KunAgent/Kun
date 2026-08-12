import { z } from 'zod'
import type {
  ArtifactStore,
  PutArtifactInput,
  PutArtifactResult,
  ReadRangeOptions,
  StoredArtifactMeta
} from '../artifacts/artifact-store.js'
import type { AttachmentContent, AttachmentStore } from '../attachments/attachment-store.js'
import type {
  AttachmentsCapabilityConfig,
  MemoryCapabilityConfig
} from '../contracts/capabilities.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  AttachmentDiagnostics,
  AttachmentMetadata,
  AttachmentUploadRequest
} from '../contracts/attachments.js'
import { RuntimeEvent, type RuntimeEvent as RuntimeEventValue } from '../contracts/events.js'
import {
  GraphCommandResultV1Schema,
  GraphEventEnvelopeV1Schema,
  GraphRunV1Schema
} from '../contracts/graph.js'
import { TurnItem, type TurnItem as TurnItemValue } from '../contracts/items.js'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryUpdateRequest
} from '../contracts/memory.js'
import { ThreadSchema, ThreadSummarySchema, type ThreadRecord } from '../contracts/threads.js'
import type { AgentSession } from '../domain/session.js'
import type { MemoryAccess, MemoryStore } from '../memory/memory-store.js'
import type {
  AppendGraphEventInput,
  AppendGraphEventResult,
  CreateGraphRunInput,
  GraphEventReplay,
  GraphRunListFilter,
  GraphRunStore,
  GraphStoreDiagnostic
} from '../graph/graph-run-store.js'
import type {
  ItemHistoryCompactionResult,
  ItemHistoryCommit,
  ItemHistorySnapshot,
  SessionLatestUsageSnapshot,
  SessionStore,
  SessionUsageRecord
} from '../ports/session-store.js'
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import { requestManagerJson, type ServiceManagerConnection } from './manager-client.js'

const ResultSchema = z.object({ result: z.unknown() }).strict()
const MANAGER_DATA_REQUEST_TIMEOUT_MS = 30_000
const ItemSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(TurnItem)
})
const ItemCommitSchema = z.discriminatedUnion('applied', [
  z.object({ applied: z.literal(true), revision: z.number().int().nonnegative() }),
  z.object({
    applied: z.literal(false),
    reason: z.enum(['conflict', 'closed']),
    revision: z.number().int().nonnegative().optional()
  })
])
const ItemCompactionSchema = z.object({
  compacted: z.boolean(),
  beforeBytes: z.number().int().nonnegative(),
  afterBytes: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative()
})
const UsageRecordSchema = z.object({
  threadId: z.string(),
  turnId: z.string().optional(),
  model: z.string().optional(),
  completedAt: z.string(),
  usage: z.record(z.string(), z.unknown())
})
const LatestUsageSchema = z.object({
  threadId: z.string(),
  seq: z.number().int().nonnegative(),
  usage: z.record(z.string(), z.unknown())
})
const AgentSessionSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  items: z.array(TurnItem),
  events: z.array(RuntimeEvent),
  closed: z.boolean()
})
const ArtifactMetaSchema = z.object({
  id: z.string(),
  byteSize: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  mimeType: z.string().optional(),
  source: z.enum(['mcp', 'web', 'bash', 'attachment', 'remote-log', 'tool', 'other']).optional(),
  origin: z.string().optional(),
  origins: z.array(z.string()).optional(),
  originHistoryComplete: z.literal(true).optional(),
  createdAt: z.string()
}).strict()
const ArtifactSummarySchema = z.object({
  artifactId: z.string(),
  byteSize: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  inline: z.string(),
  truncated: z.boolean()
}).strict()
const PutArtifactResultSchema = z.object({
  meta: ArtifactMetaSchema,
  summary: ArtifactSummarySchema,
  deduped: z.boolean()
}).strict()
const AppendGraphEventResultSchema = z.object({
  state: GraphRunV1Schema,
  envelope: GraphEventEnvelopeV1Schema,
  duplicate: z.boolean()
}).strict()
const GraphEventReplaySchema = z.object({
  events: z.array(GraphEventEnvelopeV1Schema),
  replayFloorSeq: z.number().int().nonnegative(),
  currentSeq: z.number().int().nonnegative(),
  snapshotSeq: z.number().int().nonnegative(),
  truncated: z.boolean()
}).strict()
const GraphStoreDiagnosticSchema = z.object({
  runId: z.string(),
  code: z.enum(['corrupt_journal', 'missing_artifact', 'invalid_state']),
  message: z.string(),
  retryable: z.boolean()
}).strict()
const AttachmentContentSchema = AttachmentMetadata.extend({
  dataBase64: z.string()
}).strict()

export function createManagerRemoteStores(manager: ServiceManagerConnection): {
  threadStore: ThreadStore
  sessionStore: SessionStore
} {
  return {
    threadStore: new ManagerRemoteThreadStore(manager),
    sessionStore: new ManagerRemoteSessionStore(manager)
  }
}

export class ManagerRemoteThreadStore implements ThreadStore {
  constructor(private readonly manager: ServiceManagerConnection) {}

  async list(options: ThreadStoreListOptions = {}) {
    return ThreadSummarySchema.array().parse(await this.call('list', options))
  }

  async get(threadId: string) {
    return ThreadSchema.nullable().parse(await this.call('get', { threadId }))
  }

  async getMetadata(threadId: string) {
    return ThreadSchema.nullable().parse(await this.call('getMetadata', { threadId }))
  }

  async touch(threadId: string, updatedAt: string) {
    return z.boolean().parse(await this.call('touch', { threadId, updatedAt }))
  }

  async upsert(thread: ThreadRecord) {
    return ThreadSchema.parse(await this.call('upsert', { thread }))
  }

  async delete(threadId: string) {
    return z.boolean().parse(await this.call('delete', { threadId }))
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'thread', operation, value)
  }
}

export class ManagerRemoteSessionStore implements SessionStore {
  /** Used by the HTTP SSE route to bridge events emitted by the other flavor. */
  readonly isManagerBacked = true

  constructor(private readonly manager: ServiceManagerConnection) {}

  async allocateEventSeq(threadId: string): Promise<number> {
    return z.number().int().positive().parse(await this.call('allocateEventSeq', { threadId }))
  }

  async appendEvent(threadId: string, event: RuntimeEventValue): Promise<void> {
    await this.call('appendEvent', { threadId, event })
  }

  async appendItem(threadId: string, item: TurnItemValue): Promise<void> {
    await this.call('appendItem', { threadId, item })
  }

  async rewriteItems(threadId: string, items: TurnItemValue[]): Promise<void> {
    await this.call('rewriteItems', { threadId, items })
  }

  async loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    return ItemSnapshotSchema.parse(await this.call('loadItemSnapshot', { threadId }))
  }

  async rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItemValue[]
  ): Promise<ItemHistoryCommit> {
    return ItemCommitSchema.parse(await this.call('rewriteItemsIfRevision', {
      threadId,
      expectedRevision,
      items
    }))
  }

  async updateItem(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItemValue>
  ): Promise<TurnItemValue | null> {
    return TurnItem.nullable().parse(await this.call('updateItem', { threadId, itemId, patch }))
  }

  async compactItems(
    threadId: string,
    options?: { force?: boolean }
  ): Promise<ItemHistoryCompactionResult> {
    return ItemCompactionSchema.parse(await this.call('compactItems', { threadId, options }))
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEventValue[]> {
    return RuntimeEvent.array().parse(await this.call('loadEventsSince', { threadId, sinceSeq }))
  }

  async *iterateEventsSince(
    threadId: string,
    sinceSeq: number,
    _options?: { maxRecordBytes?: number }
  ): AsyncIterable<RuntimeEventValue> {
    yield* await this.loadEventsSince(threadId, sinceSeq)
  }

  async *watchEventsSince(
    threadId: string,
    sinceSeq: number,
    signal: AbortSignal
  ): AsyncIterable<RuntimeEventValue> {
    let cursor = sinceSeq
    while (!signal.aborted) {
      const events = await this.loadEventsSince(threadId, cursor)
      for (const event of events) {
        if (event.seq <= cursor) continue
        cursor = event.seq
        yield event
      }
      await abortableDelay(250, signal)
    }
  }

  async loadItems(threadId: string): Promise<TurnItemValue[]> {
    return TurnItem.array().parse(await this.call('loadItems', { threadId }))
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    return AgentSessionSchema.nullable().parse(await this.call('loadSession', { threadId })) as AgentSession | null
  }

  async upsertSession(session: AgentSession): Promise<void> {
    await this.call('upsertSession', { session })
  }

  async highestSeq(threadId: string): Promise<number> {
    return z.number().int().nonnegative().parse(await this.call('highestSeq', { threadId }))
  }

  async loadUsageRecords(options: { threadId?: string } = {}): Promise<SessionUsageRecord[]> {
    return UsageRecordSchema.array().parse(await this.call('loadUsageRecords', options)) as SessionUsageRecord[]
  }

  async loadLatestUsageSnapshots(
    options: { threadIds?: string[] } = {}
  ): Promise<SessionLatestUsageSnapshot[]> {
    return LatestUsageSchema.array().parse(
      await this.call('loadLatestUsageSnapshots', options)
    ) as SessionLatestUsageSnapshot[]
  }

  async resetMemory(): Promise<void> {
    await this.call('resetMemory', {})
  }

  clearThreadMemory(threadId: string): void {
    // This operation only invalidates manager-side read caches. Durable delete
    // is awaited separately through ThreadStore.delete.
    void this.call('clearThreadMemory', { threadId }).catch(() => undefined)
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'session', operation, value)
  }
}

export class ManagerRemoteArtifactStore implements ArtifactStore {
  constructor(private readonly manager: ServiceManagerConnection) {}

  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    return PutArtifactResultSchema.parse(await this.call('put', { input })) as PutArtifactResult
  }

  async delete(id: string): Promise<void> {
    await this.call('delete', { id })
  }

  async list(): Promise<StoredArtifactMeta[]> {
    return ArtifactMetaSchema.array().parse(await this.call('list', {})) as StoredArtifactMeta[]
  }

  async get(id: string): Promise<string | null> {
    return z.string().nullable().parse(await this.call('get', { id }))
  }

  async readRange(id: string, options: ReadRangeOptions): Promise<string | null> {
    return z.string().nullable().parse(await this.call('readRange', { id, options }))
  }

  async stat(id: string): Promise<StoredArtifactMeta | null> {
    return ArtifactMetaSchema.nullable().parse(await this.call('stat', { id })) as StoredArtifactMeta | null
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'artifact', operation, value)
  }
}

export class ManagerRemoteMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly config: MemoryCapabilityConfig
  ) {}

  async create(input: MemoryCreateRequest) {
    return MemoryRecord.parse(await this.call('create', input))
  }

  async createWithId(id: string, input: MemoryCreateRequest) {
    return MemoryRecord.parse(await this.call('createWithId', { id, input }))
  }

  async update(id: string, patch: MemoryUpdateRequest, access?: MemoryAccess) {
    return MemoryRecord.parse(await this.call('update', { id, patch, access }))
  }

  async delete(id: string, access?: MemoryAccess) {
    return MemoryRecord.parse(await this.call('delete', { id, access }))
  }

  async purge(id: string): Promise<void> {
    await this.call('purge', { id })
  }

  async list(filter: { workspace?: string; includeDeleted?: boolean; all?: boolean } = {}) {
    return MemoryRecord.array().parse(await this.call('list', filter))
  }

  async retrieve(input: { query: string; workspace?: string; limit?: number }) {
    return MemoryRecord.array().parse(await this.call('retrieve', input))
  }

  async diagnostics() {
    const diagnostics = MemoryDiagnostics.parse(await this.call('diagnostics', {}))
    return { ...diagnostics, lastInjectedIds: [...this.lastInjectedIds] }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'memory', operation, {
      config: this.config,
      value: value ?? {}
    })
  }
}

export class ManagerRemoteGraphRunStore implements GraphRunStore {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly config: () => GraphRuntimeConfig
  ) {}

  async create(input: CreateGraphRunInput) {
    return GraphCommandResultV1Schema.parse(await this.call('create', input))
  }

  async append(runId: string, input: AppendGraphEventInput): Promise<AppendGraphEventResult> {
    return AppendGraphEventResultSchema.parse(await this.call('append', { runId, input }))
  }

  async get(runId: string) {
    return GraphRunV1Schema.nullable().parse(await this.call('get', { runId }))
  }

  async list(filter: GraphRunListFilter = {}) {
    return GraphRunV1Schema.array().parse(await this.call('list', filter))
  }

  async events(runId: string, sinceSeq = 0) {
    return GraphEventEnvelopeV1Schema.array().parse(await this.call('events', { runId, sinceSeq }))
  }

  async eventReplay(runId: string, sinceSeq = 0): Promise<GraphEventReplay> {
    return GraphEventReplaySchema.parse(await this.call('eventReplay', { runId, sinceSeq }))
  }

  async snapshot(runId: string) {
    return GraphRunV1Schema.parse(await this.call('snapshot', { runId }))
  }

  async remove(runId: string): Promise<void> {
    await this.call('remove', { runId })
  }

  async diagnostics(): Promise<GraphStoreDiagnostic[]> {
    return GraphStoreDiagnosticSchema.array().parse(await this.call('diagnostics', {}))
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'graph', operation, {
      config: this.config(),
      value: value ?? {}
    })
  }
}

export class ManagerRemoteAttachmentStore implements AttachmentStore {
  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly config: AttachmentsCapabilityConfig
  ) {}

  async create(input: Parameters<AttachmentStore['create']>[0]) {
    const { data, ...metadata } = input
    const request = AttachmentUploadRequest.parse({
      ...metadata,
      dataBase64: data.toString('base64')
    })
    return AttachmentMetadata.parse(await this.call('create', request))
  }

  async get(id: string) {
    return AttachmentMetadata.nullable().parse(await this.call('get', { id }))
  }

  async bindScope(id: string, scope: { threadId?: string; workspace?: string }) {
    return AttachmentMetadata.parse(await this.call('bindScope', { id, scope }))
  }

  async bindScopes(ids: readonly string[], scope: { threadId?: string; workspace?: string }) {
    return AttachmentMetadata.array().parse(await this.call('bindScopes', { ids, scope }))
  }

  async delete(id: string): Promise<void> {
    await this.call('delete', { id })
  }

  async releaseLease(id: string, leaseId: string, referenced: boolean) {
    return z.boolean().parse(await this.call('releaseLease', { id, leaseId, referenced }))
  }

  async pruneExpiredLeases(referencedIds: ReadonlySet<string>, expiresBeforeIso: string) {
    return z.object({
      deleted: z.number().int().nonnegative(),
      released: z.number().int().nonnegative()
    }).strict().parse(await this.call('pruneExpiredLeases', {
      referencedIds: [...referencedIds],
      expiresBeforeIso
    }))
  }

  async replaceMetadata(metadata: z.infer<typeof AttachmentMetadata>): Promise<void> {
    await this.call('replaceMetadata', metadata)
  }

  async resolveContent(
    id: string,
    scope: { threadId?: string; workspace?: string }
  ): Promise<AttachmentContent> {
    const content = AttachmentContentSchema.parse(await this.call('resolveContent', { id, scope }))
    const { dataBase64, ...metadata } = content
    return { ...metadata, data: Buffer.from(dataBase64, 'base64') }
  }

  textFallbackPolicy() {
    return {
      textFallbackMaxBase64Bytes: this.config.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: this.config.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: this.config.textFallbackPreferredMimeType
    }
  }

  async diagnostics() {
    return AttachmentDiagnostics.parse(await this.call('diagnostics', {}))
  }

  private call(operation: string, value?: unknown): Promise<unknown> {
    return callManagerStore(this.manager, 'attachment', operation, {
      config: this.config,
      value: value ?? {}
    })
  }
}

async function callManagerStore(
  manager: ServiceManagerConnection,
  store: 'thread' | 'session' | 'artifact' | 'memory' | 'graph' | 'attachment',
  operation: string,
  value?: unknown
): Promise<unknown> {
  const response = await requestManagerJson(manager, `/v1/data/${store}/${operation}`, {
    method: 'POST',
    body: value ?? {},
    timeoutMs: MANAGER_DATA_REQUEST_TIMEOUT_MS
  })
  return ResultSchema.parse(response).result
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
