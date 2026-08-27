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
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { RevisionConflictError } from './revisioned-document-store.js'
import { buildPublicItemHistoryPage } from '../services/item-history-page.js'

import {
  finishedTurnStatus,
  ownerLeaseExpiredItemId,
  ownerLeaseExpiredMessage
} from './shared-data-store-contracts.js'
import type { ManagerSessionStoreOperation } from './shared-data-store-contracts.js'

export abstract class ManagerSharedDataStoreCore {
  readonly threadStore: ThreadStore
  readonly sessionStore: SessionStore
  protected readonly hybridThreadStore: HybridThreadStore
  protected readonly artifactStore: ArtifactStore
  protected readonly attachmentStores = new Map<string, AttachmentStore>()
  protected attachmentQueue: Promise<unknown> = Promise.resolve()
  protected readonly graphStore: GraphRunStore
  protected graphConfig: GraphRuntimeConfig = DEFAULT_GRAPH_RUNTIME_CONFIG
  protected graphQueue: Promise<unknown> = Promise.resolve()
  protected readonly memoryStores = new Map<string, MemoryStore>()
  protected memoryQueue: Promise<unknown> = Promise.resolve()
  protected readonly seqFloors = new Map<string, number>()
  protected readonly reservedSeqs = new Map<string, Set<number>>()
  protected readonly seqQueues = new Map<string, Promise<unknown>>()
  protected readonly mutationQueues = new Map<string, Promise<unknown>>()
  protected readonly controlThreads = new Map<string, string>()
  protected readonly dataDir: string
  protected readonly atomicJsonDocuments = new Map<string, {
    revision: number
    loaded: boolean
    value: unknown | null
    queue: Promise<unknown>
  }>()

  protected constructor(input: {
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

  protected abstract executeSessionNow(
    operation: ManagerSessionStoreOperation,
    value: unknown
  ): Promise<unknown>

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
    beforeCommit?: () => void
  }): Promise<{ revision: number; value: unknown }> {
    const target = this.safeDataPath(input.path)
    const document = this.atomicJsonDocument(target)
    const run = document.queue.catch(() => undefined).then(async () => {
      await this.loadAtomicJson(target, document)
      if (document.revision !== input.expectedRevision) {
        throw new RevisionConflictError(document.revision)
      }
      const serialized = `${JSON.stringify(input.value, null, 2)}\n`
      await atomicWriteFile(target, serialized, {
        beforeCommit: input.beforeCommit,
        allowDirectWriteFallback: !requiresAtomicReplace(this.dataDir, target)
      })
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
    beforeCommit?: () => void
  }): Promise<{ revision: number; value: null }> {
    const target = this.safeDataPath(input.path)
    const document = this.atomicJsonDocument(target)
    const run = document.queue.catch(() => undefined).then(async () => {
      await this.loadAtomicJson(target, document)
      if (document.revision !== input.expectedRevision) {
        throw new RevisionConflictError(document.revision)
      }
      input.beforeCommit?.()
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

  protected async allocateEventSeq(threadId: string): Promise<number> {
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

  protected noteEventSeq(threadId: string, seq: number): void {
    this.seqFloors.set(threadId, Math.max(seq, this.seqFloors.get(threadId) ?? 0))
  }

  controlThread(kind: 'approval' | 'user-input', id: string): string | null {
    return this.controlThreads.get(`${kind}:${id}`) ?? null
  }

  protected noteControlEvent(event: RuntimeEventValue): void {
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

  protected async enqueueSeq<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
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

  protected async enqueueMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
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

  protected safeDataPath(path: string): string {
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

  protected atomicJsonDocument(path: string) {
    let document = this.atomicJsonDocuments.get(path)
    if (!document) {
      document = { revision: 0, loaded: false, value: null, queue: Promise.resolve() }
      this.atomicJsonDocuments.set(path, document)
    }
    return document
  }

  protected memoryStore(config: z.infer<typeof MemoryCapabilityConfig>): MemoryStore {
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

  protected attachmentStore(config: z.infer<typeof AttachmentsCapabilityConfig>): AttachmentStore {
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

  protected async loadAtomicJson(
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

const ATOMIC_REPLACE_PATHS = new Set([
  'model-connections.v1.json',
  'credentials/credentials.enc.json',
  'extensions/accounts.json',
  'extensions/provider-bindings.json'
])

export function requiresAtomicReplace(dataDir: string, path: string): boolean {
  const normalized = relative(resolve(dataDir), resolve(path)).split(sep).join('/')
  return ATOMIC_REPLACE_PATHS.has(normalized)
}
