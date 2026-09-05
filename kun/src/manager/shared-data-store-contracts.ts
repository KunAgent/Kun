import { readFile, rm } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { TurnMutationFenceSchema } from '../contracts/runtime-flavor.js'
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
import type { ThreadStoreListOptions } from '../ports/thread-store.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RevisionConflictError } from './revisioned-document-store.js'
import { buildPublicItemHistoryPage } from '../services/item-history-page.js'

export const ThreadIdSchema = z.string().min(1).max(256)

export const ThreadStoreListOptionsSchema: z.ZodType<ThreadStoreListOptions> = z.object({
  limit: z.number().int().positive().optional(),
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
  archivedOnly: z.boolean().optional(),
  includeSide: z.boolean().optional(),
  cursor: z.string().min(1).optional(),
  workspace: z.string().optional()
}).strict()

export function finishedTurnStatus(status: string): FinishedTurnStatus | null {
  return status === 'completed' || status === 'failed' || status === 'aborted' ? status : null
}

export function ownerLeaseExpiredMessage(lease: ThreadExecutionLease): string {
  return `Turn owner ${lease.ownerFlavor}/${lease.ownerInstanceId} stopped heartbeating.`
}

export function ownerLeaseExpiredItemId(turnId: string): string {
  return `item_${turnId}_owner_lease_expired`
}

export const AgentSessionSchema = z.object({
  threadId: ThreadIdSchema,
  turnId: z.string().min(1).max(256),
  startedAt: z.string(),
  updatedAt: z.string(),
  items: z.array(TurnItem),
  events: z.array(RuntimeEvent),
  closed: z.boolean()
})

export const SessionUsageQuerySchema = z.object({
  threadId: ThreadIdSchema.optional(),
  fromInclusive: z.string().datetime({ offset: true }).optional(),
  toExclusive: z.string().datetime({ offset: true }).optional()
}).strict().transform((input, context) => {
  if (Boolean(input.fromInclusive) !== Boolean(input.toExclusive)) {
    context.addIssue({ code: 'custom', message: 'usage range requires both boundaries' })
    return z.NEVER
  }
  if (!input.fromInclusive || !input.toExclusive) return input
  const fromMs = Date.parse(input.fromInclusive)
  const toMs = Date.parse(input.toExclusive)
  if (fromMs >= toMs) {
    context.addIssue({ code: 'custom', message: 'usage range must be increasing' })
    return z.NEVER
  }
  return {
    ...input,
    fromInclusive: new Date(fromMs).toISOString(),
    toExclusive: new Date(toMs).toISOString()
  }
})

/**
 * Single source of truth for the manager thread data-plane protocol. Both the
 * runtime URL allowlist (ThreadStoreOperationSchema) and this union type are
 * derived from it so they cannot drift apart again.
 */
export const MANAGER_THREAD_STORE_OPERATIONS = [
  'list',
  'listPage',
  'get',
  'getMetadata',
  'touch',
  'upsert',
  'upsertIfRevision',
  'delete',
  'deleteByWorkspace'
] as const

export type ManagerThreadStoreOperation = (typeof MANAGER_THREAD_STORE_OPERATIONS)[number]

export type ManagerSessionStoreOperation =
  | 'appendEvent'
  | 'appendItem'
  | 'checkpointLiveItem'
  | 'finalizeLiveItem'
  | 'rewriteItems'
  | 'loadItemSnapshot'
  | 'rewriteItemsIfRevision'
  | 'updateItem'
  | 'compactItems'
  | 'scheduleItemHistoryCompaction'
  | 'loadEventsSince'
  | 'loadEventPage'
  | 'trimEventsFromSeq'
  | 'eventReplayFloorSeq'
  | 'loadItems'
  | 'searchItemText'
  | 'loadItemPage'
  | 'loadSession'
  | 'upsertSession'
  | 'highestSeq'
  | 'allocateEventSeq'
  | 'loadUsageRecords'
  | 'aggregateUsage'
  | 'loadLatestUsageSnapshots'
  | 'resetMemory'
  | 'clearThreadMemory'

export const ManagerDataRequestEnvelopeSchema = z.object({
  value: z.unknown(),
  turnFence: TurnMutationFenceSchema.optional()
}).strict()

export type ManagerArtifactStoreOperation =
  | 'put'
  | 'releaseOwner'
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
export function parseThreadId(value: unknown): { threadId: string } {
  return z.object({ threadId: ThreadIdSchema }).strict().parse(value)
}

export function parseArtifactId(value: unknown): { id: string } {
  return z.object({ id: z.string().min(1).max(256) }).strict().parse(value)
}

export function parseGraphRunId(value: unknown): { runId: string } {
  return z.object({ runId: GraphRunIdSchema }).strict().parse(value)
}

export function parseAttachmentId(value: unknown): { id: string } {
  return z.object({ id: z.string().min(1) }).strict().parse(value)
}

export function attachmentScopeRequest(value: unknown): {
  id: string
  scope: { threadId?: string; workspace?: string }
} {
  return z.object({
    id: z.string().min(1),
    scope: z.object({ threadId: z.string().optional(), workspace: z.string().optional() }).strict()
  }).strict().parse(value)
}

export function mutationThreadId(value: unknown): string | null {
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

export function mutationTurnId(value: unknown): string | null {
  const parsed = z.object({ turnId: z.string().min(1) }).passthrough().safeParse(value)
  if (parsed.success) return parsed.data.turnId
  for (const key of ['event', 'item', 'session'] as const) {
    const nested = z.object({
      [key]: z.object({ turnId: z.string().min(1) }).passthrough()
    }).passthrough().safeParse(value)
    if (nested.success) return nested.data[key].turnId
  }
  return null
}

export function isThreadMutation(operation: ManagerThreadStoreOperation): boolean {
  return operation === 'touch' || operation === 'upsert' || operation === 'upsertIfRevision' || operation === 'delete'
}

export function isSessionMutation(operation: ManagerSessionStoreOperation): boolean {
  return operation === 'appendEvent' ||
    operation === 'appendItem' ||
    operation === 'checkpointLiveItem' ||
    operation === 'finalizeLiveItem' ||
    operation === 'rewriteItems' ||
    operation === 'rewriteItemsIfRevision' ||
    operation === 'updateItem' ||
    operation === 'compactItems' ||
    operation === 'scheduleItemHistoryCompaction' ||
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
