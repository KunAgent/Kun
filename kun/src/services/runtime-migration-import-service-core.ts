import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import { artifactId } from '../artifacts/artifact-summary.js'
import { RuntimeEvent } from '../contracts/events.js'
import { TurnItem } from '../contracts/items.js'
import {
  RuntimeMigrationImportControl,
  RuntimeMigrationImportPreflight,
  RuntimeMigrationImportResult,
  RuntimeMigrationSnapshotRecord,
  type RuntimeMigrationImportControl as RuntimeMigrationImportControlType,
  type RuntimeMigrationImportPreflight as RuntimeMigrationImportPreflightType,
  type RuntimeMigrationImportResult as RuntimeMigrationImportResultType,
  type RuntimeMigrationSnapshotRecord as RuntimeMigrationSnapshotRecordType
} from '../contracts/migrations.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { MemoryCreateRequest, MemoryRecord } from '../contracts/memory.js'
import { AttachmentMetadata as AttachmentMetadataSchema, type AttachmentMetadata } from '../contracts/attachments.js'
import type { AgentSession } from '../domain/session.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { sanitizeMigrationValue } from './runtime-migration-service.js'
import { iterateSnapshotFile, parseImportState, rewriteImportedSession, rewriteImportedValue } from './runtime-migration-import-service-request-state.js'
import { appendHistoricalProvider, type ArtifactMigrationMetadata, canonicalLine, decodeBase64, increment, isSafeImportedThreadId, isThreadOwnedRecord, parseArtifactMetadata, parseChunkedContentDescriptor, parseContentChunk, rewriteWorkspace, startPendingContent, verifyChunkedContent } from './runtime-migration-import-service-content-support.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'

export const MAX_IMPORT_RECORD_BYTES = 8 * 1024 * 1024

export const MAX_IMPORT_RECORDS = 1_000_000

export const MAX_IMPORT_CONTENT_BYTES = 512 * 1024 * 1024

export type ChunkedContentDescriptor = {
  encoding: 'base64-chunks'
  byteSize: number
  sha256: string
  chunkCount: number
}

export type PendingChunkedContent = {
  kind: 'attachment' | 'artifact'
  sourceId: string
  ownerId?: string
  contentId?: string
  descriptor: ChunkedContentDescriptor
  metadata: unknown
  nextIndex: number
  byteSize: number
  chunks: Buffer[]
}

export type ImportState = {
  importId: string
  filePath: string
  statePath: string
  control: RuntimeMigrationImportControlType['value']
  preflight: RuntimeMigrationImportPreflightType
  status: RuntimeMigrationImportResultType['status'] | 'committing'
  introducedThreadIds: string[]
  deduplicatedThreadIds: string[]
  attachmentIdMap: Record<string, string>
  artifactIdMap: Record<string, string>
  memoryIdMap: Record<string, string>
  attachmentBefore: Record<string, AttachmentMetadata | null>
  attachmentAfter: Record<string, AttachmentMetadata>
  memoryAfter: Record<string, MemoryRecord>
  threadAfter: Record<string, ThreadRecord>
  introducedAttachmentIds: string[]
  introducedArtifactIds: string[]
  introducedMemoryIds: string[]
  counts: Record<string, number>
  warnings: string[]
}

export class RuntimeMigrationImportService {
  private readonly rootDir: string
  private readonly imports = new Map<string, ImportState>()

  constructor(private readonly deps: {
    rootDir: string
    threadStore: ThreadStore
    sessionStore: SessionStore
    maintenance: ScopedMigrationMaintenanceLock
    attachmentStore: () => AttachmentStore | undefined
    artifactStore?: ArtifactStore
    memoryStore: () => MemoryStore | undefined
    /** Imported threads must not inherit machine-local provider checkpoints. */
    onThreadImported?: (threadId: string) => Promise<void>
  }) {
    this.rootDir = resolve(deps.rootDir)
  }

  async preflight(
    control: RuntimeMigrationImportControlType,
    records: AsyncIterable<RuntimeMigrationSnapshotRecordType>
  ): Promise<RuntimeMigrationImportPreflightType> {
    const parsedControl = RuntimeMigrationImportControl.parse(control)
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    const importId = `migimp_${randomUUID().replaceAll('-', '')}`
    const filePath = join(this.rootDir, `${importId}.jsonl`)
    const statePath = join(this.rootDir, `${importId}.state.json`)
    const threadHashes = new Map<string, ReturnType<typeof createHash>>()
    const threadRecords = new Map<string, ThreadRecord>()
    const recordOwners = new Set<string>()
    let recordCount = 0
    try {
      for await (const raw of records) {
        if (recordCount >= MAX_IMPORT_RECORDS) throw new Error(`runtime migration import exceeds ${MAX_IMPORT_RECORDS} records`)
        const record = RuntimeMigrationSnapshotRecord.parse(raw)
        const line = `${JSON.stringify(record)}\n`
        if (Buffer.byteLength(line) > MAX_IMPORT_RECORD_BYTES) throw new Error('runtime migration import record exceeds byte limit')
        await appendFile(filePath, line, { encoding: 'utf8', flag: recordCount === 0 ? 'wx' : 'a', mode: 0o600 })
        recordCount += 1
        if (record.type === 'thread') {
          const thread = ThreadSchema.parse(record.value)
          threadRecords.set(thread.id, thread)
          recordOwners.add(thread.id)
          const hash = createHash('sha256')
          hash.update(canonicalLine('thread', sanitizeMigrationValue(thread)))
          threadHashes.set(thread.id, hash)
        } else if (record.type === 'item') {
          const item = TurnItem.parse(record.value)
          const owner = record.ownerId ?? item.threadId
          const hash = threadHashes.get(owner)
          if (!hash) throw new Error(`runtime migration item precedes its thread: ${owner}`)
          hash.update(canonicalLine('item', sanitizeMigrationValue(item)))
        } else if (record.type === 'event') {
          RuntimeEvent.parse(record.value)
        } else if (record.ownerId && !recordOwners.has(record.ownerId) && isThreadOwnedRecord(record.type)) {
          throw new Error(`runtime migration record references an unknown thread: ${record.ownerId}`)
        }
      }
      const threadIdMap: Record<string, string> = {}
      const introducedThreadIds: string[] = []
      const deduplicatedThreadIds: string[] = []
      const reserved = new Set<string>()
      for (const [sourceId, thread] of threadRecords) {
        const incomingHash = threadHashes.get(sourceId)!.digest('hex')
        const existing = await this.deps.threadStore.get(sourceId)
        if (existing && await this.existingThreadHash(existing) === incomingHash) {
          threadIdMap[sourceId] = sourceId
          deduplicatedThreadIds.push(sourceId)
          reserved.add(sourceId)
          continue
        }
        const targetId = existing || reserved.has(sourceId) || !isSafeImportedThreadId(sourceId)
          ? await this.allocateThreadId(sourceId, incomingHash, reserved)
          : sourceId
        threadIdMap[sourceId] = targetId
        introducedThreadIds.push(targetId)
        reserved.add(targetId)
      }
      const preflight = RuntimeMigrationImportPreflight.parse({
        importId,
        operationId: parsedControl.value.operationId,
        threadIdMap,
        introducedThreadIds,
        deduplicatedThreadIds,
        recordCount,
        warnings: []
      })
      const state: ImportState = {
        importId,
        filePath,
        statePath,
        control: parsedControl.value,
        preflight,
        status: 'preflighted',
        introducedThreadIds: [...introducedThreadIds],
        deduplicatedThreadIds,
        attachmentIdMap: {},
        artifactIdMap: {},
        memoryIdMap: {},
        attachmentBefore: {},
        attachmentAfter: {},
        memoryAfter: {},
        threadAfter: {},
        introducedAttachmentIds: [],
        introducedArtifactIds: [],
        introducedMemoryIds: [],
        counts: {},
        warnings: []
      }
      this.imports.set(importId, state)
      await this.persistState(state)
      return preflight
    } catch (error) {
      await Promise.all([
        rm(filePath, { force: true }),
        rm(statePath, { force: true })
      ]).catch(() => undefined)
      throw error
    }
  }

  async commit(importId: string): Promise<RuntimeMigrationImportResultType> {
    const state = await this.mustState(importId)
    if (state.status === 'committed' || state.status === 'verified') return this.result(state)
    if (state.status === 'rolled-back') throw new Error('runtime migration import was already rolled back')
    const lease = this.deps.maintenance.acquire(state.control.operationId)
    try {
      state.status = 'committing'
      await this.persistState(state)
      await this.importContentRecords(state)
      const existingItemIds = new Map<string, Set<string>>()
      const highestEventSeq = new Map<string, number>()
      for await (const record of iterateSnapshotFile(state.filePath)) {
        if (!record.ownerId || state.deduplicatedThreadIds.includes(record.ownerId)) continue
        const targetThreadId = state.preflight.threadIdMap[record.ownerId]
        if (!targetThreadId) continue
        if (record.type === 'thread') {
          const source = ThreadSchema.parse(record.value)
          const rewritten = rewriteImportedValue(source, {
            threadIdMap: state.preflight.threadIdMap,
            workspacePathMap: state.control.workspacePathMap,
            attachmentIdMap: state.attachmentIdMap,
            artifactIdMap: state.artifactIdMap,
            memoryIdMap: state.memoryIdMap
          }) as ThreadRecord
          const providerAvailable = !rewritten.providerId || state.control.configuredProviderIds.includes(rewritten.providerId)
          const thread = ThreadSchema.parse({
            ...rewritten,
            id: targetThreadId,
            status: rewritten.status === 'archived' ? 'archived' : 'idle',
            turns: rewritten.turns.map((turn) => ({
              ...turn,
              threadId: targetThreadId,
              status: turn.status === 'queued' || turn.status === 'running' ? 'aborted' : turn.status
            })),
            ...(providerAvailable ? {} : {
              providerId: undefined,
              summary: appendHistoricalProvider(rewritten.summary, rewritten.providerId!)
            }),
            accountId: undefined
          })
          state.threadAfter[targetThreadId] = thread
          await this.persistState(state)
          const existing = await this.deps.threadStore.get(targetThreadId)
          if (!existing) {
            await this.deps.onThreadImported?.(targetThreadId)
            await this.deps.threadStore.upsert(thread)
            increment(state.counts, 'threads')
          } else if (canonicalLine('thread', sanitizeMigrationValue(existing)) !== canonicalLine('thread', sanitizeMigrationValue(thread))) {
            throw new Error(`imported thread changed while resuming: ${targetThreadId}`)
          }
        } else if (record.type === 'session') {
          const session = rewriteImportedSession(record.value, targetThreadId, state)
          const existing = await this.deps.sessionStore.loadSession(targetThreadId)
          if (!existing) {
            await this.deps.sessionStore.upsertSession(session)
            increment(state.counts, 'sessions')
          }
        } else if (record.type === 'item') {
          const item = TurnItem.parse(rewriteImportedValue(record.value, {
            threadIdMap: state.preflight.threadIdMap,
            workspacePathMap: state.control.workspacePathMap,
            attachmentIdMap: state.attachmentIdMap,
            artifactIdMap: state.artifactIdMap,
            memoryIdMap: state.memoryIdMap
          }))
          let ids = existingItemIds.get(targetThreadId)
          if (!ids) {
            ids = new Set((await this.deps.sessionStore.loadItems(targetThreadId)).map((value) => value.id))
            existingItemIds.set(targetThreadId, ids)
          }
          if (!ids.has(item.id)) {
            await this.deps.sessionStore.appendItem(targetThreadId, { ...item, threadId: targetThreadId })
            ids.add(item.id)
            increment(state.counts, 'items')
          }
        } else if (record.type === 'event') {
          const event = RuntimeEvent.parse(rewriteImportedValue(record.value, {
            threadIdMap: state.preflight.threadIdMap,
            workspacePathMap: state.control.workspacePathMap,
            attachmentIdMap: state.attachmentIdMap,
            artifactIdMap: state.artifactIdMap,
            memoryIdMap: state.memoryIdMap
          }))
          let highest = highestEventSeq.get(targetThreadId)
          if (highest === undefined) {
            highest = await this.deps.sessionStore.highestSeq(targetThreadId)
            highestEventSeq.set(targetThreadId, highest)
          }
          if (event.seq > highest) {
            await this.deps.sessionStore.appendEvent(targetThreadId, { ...event, threadId: targetThreadId })
            highestEventSeq.set(targetThreadId, event.seq)
            increment(state.counts, 'events')
          }
        }
      }
      state.status = 'committed'
      await this.persistState(state)
      return this.result(state)
    } catch (error) {
      await this.rollbackInternal(state)
      throw error
    } finally {
      lease.release()
    }
  }

  async verify(importId: string): Promise<RuntimeMigrationImportResultType> {
    const state = await this.mustState(importId)
    if (state.status !== 'committed' && state.status !== 'verified') throw new Error('runtime migration import is not committed')
    for (const threadId of state.introducedThreadIds) {
      const thread = await this.deps.threadStore.get(threadId)
      if (!thread) throw new Error(`imported thread is missing after commit: ${threadId}`)
      await this.deps.sessionStore.loadItems(threadId)
      await this.deps.sessionStore.highestSeq(threadId)
    }
    await this.verifyImportedContent(state)
    state.status = 'verified'
    await this.persistState(state)
    return this.result(state)
  }

  async rollback(importId: string): Promise<RuntimeMigrationImportResultType> {
    const state = await this.mustState(importId)
    const lease = this.deps.maintenance.acquire(state.control.operationId)
    try {
      await this.rollbackInternal(state)
      return this.result(state)
    } finally {
      lease.release()
    }
  }

  async release(importId: string): Promise<boolean> {
    const state = await this.mustState(importId).catch(() => null)
    if (!state) return false
    if (state.status !== 'verified' && state.status !== 'rolled-back') {
      throw new Error('runtime migration import can only be released after verify or rollback')
    }
    await Promise.all([
      rm(state.filePath, { force: true }),
      rm(state.statePath, { force: true })
    ])
    this.imports.delete(importId)
    return true
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.imports.values()].map((state) => this.persistState(state)))
    this.imports.clear()
  }

  private async importContentRecords(state: ImportState): Promise<void> {
    let pending: PendingChunkedContent | undefined
    for await (const record of iterateSnapshotFile(state.filePath)) {
      if (pending && record.type !== 'content-chunk') {
        throw new Error(`incomplete migration ${pending.kind} content chunks: ${pending.sourceId}`)
      }
      if (record.type === 'attachment') {
        const value = record.value as { metadata?: unknown; dataBase64?: unknown; content?: unknown }
        const metadata = AttachmentMetadataSchema.parse(value.metadata)
        const descriptor = parseChunkedContentDescriptor(value.content)
        if (descriptor) {
          pending = startPendingContent('attachment', metadata.id, metadata, record, descriptor)
        } else {
          if (typeof value.dataBase64 !== 'string') throw new Error('invalid migration attachment record')
          await this.importAttachment(state, metadata, decodeBase64(value.dataBase64), record.ownerId, record.contentId)
        }
      } else if (record.type === 'artifact') {
        const value = record.value as { metadata?: unknown; content?: unknown }
        const metadata = parseArtifactMetadata(value.metadata)
        const descriptor = parseChunkedContentDescriptor(value.content)
        if (descriptor) {
          pending = startPendingContent('artifact', metadata.id, metadata, record, descriptor)
        } else {
          if (typeof value.content !== 'string') throw new Error('invalid migration artifact record')
          await this.importArtifact(state, metadata, value.content, record.contentId)
        }
      } else if (record.type === 'content-chunk') {
        if (!pending) throw new Error('migration content chunk has no descriptor')
        const chunk = parseContentChunk(record.value)
        if (
          chunk.kind !== pending.kind ||
          chunk.sourceId !== pending.sourceId ||
          chunk.index !== pending.nextIndex ||
          chunk.count !== pending.descriptor.chunkCount ||
          record.ownerId !== pending.ownerId ||
          record.contentId !== pending.contentId
        ) {
          throw new Error(`invalid migration ${pending.kind} content chunk sequence: ${pending.sourceId}`)
        }
        const decoded = decodeBase64(chunk.dataBase64)
        pending.byteSize += decoded.byteLength
        if (pending.byteSize > pending.descriptor.byteSize) {
          throw new Error(`migration ${pending.kind} content exceeds declared byte size: ${pending.sourceId}`)
        }
        pending.chunks.push(decoded)
        pending.nextIndex += 1
        if (pending.nextIndex === pending.descriptor.chunkCount) {
          const data = Buffer.concat(pending.chunks, pending.byteSize)
          verifyChunkedContent(pending, data)
          if (pending.kind === 'attachment') {
            await this.importAttachment(
              state,
              pending.metadata as AttachmentMetadata,
              data,
              pending.ownerId,
              pending.contentId
            )
          } else {
            await this.importArtifact(
              state,
              pending.metadata as ArtifactMigrationMetadata,
              data.toString('utf8'),
              pending.contentId
            )
          }
          pending = undefined
        }
      } else if (record.type === 'memory') {
        const store = this.deps.memoryStore()
        if (!store) {
          state.warnings.push(`Memory store unavailable; skipped ${record.contentId ?? 'memory'}`)
          continue
        }
        const memory = MemoryRecord.parse(record.value)
        const existingTargetId = state.memoryIdMap[memory.id]
        if (existingTargetId) {
          const existing = (await store.list({ includeDeleted: true, all: true })).find((item) => item.id === existingTargetId)
          if (existing) {
            state.memoryAfter[existing.id] ??= existing
            continue
          }
        }
        const rewritten = rewriteImportedValue(memory, {
          threadIdMap: state.preflight.threadIdMap,
          workspacePathMap: state.control.workspacePathMap,
          attachmentIdMap: state.attachmentIdMap,
          artifactIdMap: state.artifactIdMap,
          memoryIdMap: state.memoryIdMap
        }) as typeof memory
        if (!store.createWithId) throw new Error('memory store does not support crash-safe migration IDs')
        const targetId = `mem_import_${createHash('sha256').update(`${state.control.operationId}\0${memory.id}`).digest('hex').slice(0, 24)}`
        state.memoryIdMap[memory.id] = targetId
        if (!state.introducedMemoryIds.includes(targetId)) state.introducedMemoryIds.push(targetId)
        await this.persistState(state)
        const created = await store.createWithId(targetId, MemoryCreateRequest.parse({
          content: rewritten.content,
          scope: rewritten.scope,
          workspace: rewritten.workspace,
          project: rewritten.project,
          sourceThreadId: rewritten.sourceThreadId,
          sourceTurnId: rewritten.sourceTurnId,
          provenance: rewritten.provenance,
          tags: rewritten.tags,
          confidence: rewritten.confidence,
          type: rewritten.type,
          importance: rewritten.importance,
          observedAt: rewritten.observedAt,
          validFrom: rewritten.validFrom,
          validTo: rewritten.validTo,
          sources: rewritten.sources
        }))
        state.memoryAfter[created.id] = created
        increment(state.counts, 'memories')
        await this.persistState(state)
      }
    }
    if (pending) throw new Error(`incomplete migration ${pending.kind} content chunks: ${pending.sourceId}`)
  }

  private async importAttachment(
    state: ImportState,
    metadata: AttachmentMetadata,
    data: Buffer,
    ownerId?: string,
    contentId?: string
  ): Promise<void> {
    const digest = createHash('sha256').update(data).digest('hex')
    if (contentId && contentId !== digest && contentId !== `att_${digest.slice(0, 24)}`) {
      throw new Error(`migration attachment content hash mismatch: ${metadata.id}`)
    }
    if (metadata.id !== `att_${digest.slice(0, 24)}` || metadata.hash !== digest || metadata.byteSize !== data.byteLength) {
      throw new Error(`migration attachment metadata does not match content: ${metadata.id}`)
    }
    const store = this.deps.attachmentStore()
    if (!store) {
      state.warnings.push(`Attachment store unavailable; skipped ${contentId ?? metadata.id}`)
      return
    }
    if (state.attachmentIdMap[metadata.id]) return
    const targetId = `att_${digest.slice(0, 24)}`
    const existing = await store.get(targetId)
    if (!(targetId in state.attachmentBefore)) state.attachmentBefore[targetId] = existing
    if (!existing && !state.introducedAttachmentIds.includes(targetId)) state.introducedAttachmentIds.push(targetId)
    await this.persistState(state)
    const mappedThreadId = ownerId ? state.preflight.threadIdMap[ownerId] : undefined
    const created = await store.create({
      name: metadata.name,
      data,
      mimeType: metadata.mimeType,
      documentText: metadata.documentText,
      pageCount: metadata.pageCount,
      textFallback: metadata.textFallback,
      ...(mappedThreadId ? { threadId: mappedThreadId } : {}),
      ...(metadata.workspaces[0] ? { workspace: rewriteWorkspace(metadata.workspaces[0], state.control.workspacePathMap) } : {})
    })
    state.attachmentIdMap[metadata.id] = created.id
    state.attachmentAfter[created.id] = created
    increment(state.counts, 'attachments')
    await this.persistState(state)
  }

  private async importArtifact(
    state: ImportState,
    metadata: ArtifactMigrationMetadata,
    content: string,
    contentId?: string
  ): Promise<void> {
    const digest = createHash('sha256').update(content, 'utf8').digest('hex')
    const targetId = artifactId(content)
    if (contentId && contentId !== digest && contentId !== targetId) {
      throw new Error(`migration artifact content hash mismatch: ${metadata.id}`)
    }
    if (metadata.id !== targetId) throw new Error(`migration artifact metadata does not match content: ${metadata.id}`)
    if (!this.deps.artifactStore) {
      state.warnings.push(`Artifact store unavailable; skipped ${contentId ?? metadata.id}`)
      return
    }
    if (state.artifactIdMap[metadata.id]) return
    if (!await this.deps.artifactStore.stat(targetId) && !state.introducedArtifactIds.includes(targetId)) {
      state.introducedArtifactIds.push(targetId)
      await this.persistState(state)
    }
    const created = await this.deps.artifactStore.put({
      content,
      mimeType: metadata.mimeType,
      source: metadata.source as never,
      origin: metadata.origin
    })
    state.artifactIdMap[metadata.id] = created.meta.id
    increment(state.counts, 'artifacts')
    await this.persistState(state)
  }

  private async rollbackInternal(state: ImportState): Promise<void> {
    for (const threadId of [...new Set(state.introducedThreadIds)].reverse()) {
      const current = await this.deps.threadStore.get(threadId)
      const expected = state.threadAfter[threadId]
      if (!current) continue
      if (!expected || canonicalLine('thread', sanitizeMigrationValue(current)) !== canonicalLine('thread', sanitizeMigrationValue(expected))) {
        state.warnings.push(`Preserved thread modified after migration import: ${threadId}`)
        continue
      }
      await this.deps.threadStore.delete(threadId)
      this.deps.sessionStore.clearThreadMemory(threadId)
    }
    const attachmentStore = this.deps.attachmentStore()
    for (const id of [...state.introducedAttachmentIds].reverse()) {
      const current = await attachmentStore?.get(id)
      const expected = state.attachmentAfter[id]
      if (current && expected && canonicalLine('attachment', current) === canonicalLine('attachment', expected) && attachmentStore?.delete) {
        await attachmentStore.delete(id)
      } else if (current) {
        state.warnings.push(`Preserved attachment modified after migration import: ${id}`)
      }
    }
    if (attachmentStore?.replaceMetadata) {
      for (const [id, before] of Object.entries(state.attachmentBefore)) {
        if (!before || state.introducedAttachmentIds.includes(id)) continue
        const current = await attachmentStore.get(id)
        const expected = state.attachmentAfter[id]
        if (current && expected && canonicalLine('attachment', current) === canonicalLine('attachment', expected)) {
          await attachmentStore.replaceMetadata(before)
        } else if (current) {
          state.warnings.push(`Preserved shared attachment metadata modified after migration import: ${id}`)
        }
      }
    }
    for (const id of [...state.introducedArtifactIds].reverse()) {
      if (this.deps.artifactStore?.delete) await this.deps.artifactStore.delete(id)
      else state.warnings.push(`Artifact store cannot remove imported artifact automatically: ${id}`)
    }
    const memoryStore = this.deps.memoryStore()
    for (const id of [...state.introducedMemoryIds].reverse()) {
      const expected = state.memoryAfter[id]
      const current = (await memoryStore?.list({ includeDeleted: true, all: true }))?.find((record) => record.id === id)
      if (!current) continue
      if (expected && canonicalMemoryHash(current) === canonicalMemoryHash(expected) && memoryStore?.purge) {
        await memoryStore.purge(id)
      } else {
        state.warnings.push(`Preserved memory modified after migration import: ${id}`)
      }
    }
    state.status = 'rolled-back'
    await this.persistState(state)
  }

  private async verifyImportedContent(state: ImportState): Promise<void> {
    const attachmentStore = this.deps.attachmentStore()
    for (const id of Object.values(state.attachmentIdMap)) {
      if (!await attachmentStore?.get(id)) throw new Error(`imported attachment is missing after commit: ${id}`)
    }
    for (const id of Object.values(state.artifactIdMap)) {
      if (!await this.deps.artifactStore?.stat(id)) throw new Error(`imported artifact is missing after commit: ${id}`)
    }
    const memories = await this.deps.memoryStore()?.list({ includeDeleted: true, all: true }) ?? []
    const memoryIds = new Set(memories.map((memory) => memory.id))
    for (const id of Object.values(state.memoryIdMap)) {
      if (!memoryIds.has(id)) throw new Error(`imported memory is missing after commit: ${id}`)
    }
  }

  private async existingThreadHash(thread: ThreadRecord): Promise<string> {
    const hash = createHash('sha256')
    hash.update(canonicalLine('thread', sanitizeMigrationValue(thread)))
    for (const item of await this.deps.sessionStore.loadItems(thread.id)) {
      hash.update(canonicalLine('item', sanitizeMigrationValue(item)))
    }
    return hash.digest('hex')
  }

  private async allocateThreadId(sourceId: string, hash: string, reserved: ReadonlySet<string>): Promise<string> {
    for (let index = 0; index < 10_000; index += 1) {
      const suffix = createHash('sha256').update(`${sourceId}\0${hash}\0${index}`).digest('hex').slice(0, 24)
      const candidate = `thr_import_${suffix}`
      if (!reserved.has(candidate) && !await this.deps.threadStore.get(candidate)) return candidate
    }
    throw new Error(`unable to allocate imported thread id for ${sourceId}`)
  }

  private async mustState(importId: string): Promise<ImportState> {
    const cached = this.imports.get(importId)
    if (cached) return cached
    if (!/^migimp_[a-f0-9]{32}$/.test(importId)) throw new Error(`runtime migration import not found: ${importId}`)
    const statePath = join(this.rootDir, `${importId}.state.json`)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(statePath, 'utf8'))
    } catch {
      throw new Error(`runtime migration import not found: ${importId}`)
    }
    const state = parseImportState(raw, this.rootDir, importId)
    this.imports.set(importId, state)
    return state
  }

  private async persistState(state: ImportState): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    const temporaryPath = `${state.statePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, state.statePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  private result(state: ImportState): RuntimeMigrationImportResultType {
    return RuntimeMigrationImportResult.parse({
      importId: state.importId,
      status: state.status === 'committing' ? 'preflighted' : state.status,
      introducedThreadIds: [...state.introducedThreadIds],
      deduplicatedThreadIds: [...state.deduplicatedThreadIds],
      counts: state.counts,
      warnings: state.warnings
    })
  }
}
