import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import { RuntimeEvent } from '../contracts/events.js'
import { TurnItem } from '../contracts/items.js'
import type {
  RuntimeMigrationExportCreateRequest,
  RuntimeMigrationExportSnapshot,
  RuntimeMigrationSnapshotRecord
} from '../contracts/migrations.js'
import { ThreadSchema } from '../contracts/threads.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { SessionStore } from '../ports/session-store.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ThreadService } from './thread-service.js'
import type { TurnService } from './turn-service.js'

const SNAPSHOT_SCHEMA_VERSION = 1 as const
const SNAPSHOT_MUTATION_RETRIES = 3
const SNAPSHOT_WAIT_POLL_MS = 50
const SNAPSHOT_CONTENT_CHUNK_BYTES = 1024 * 1024
const SECRET_KEY = /(?:password|passphrase|secret|credential|oauth|api[_-]?key|access[_-]?token|refresh[_-]?token|account[_-]?id)/i

export class RuntimeMigrationSnapshotError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'running_thread' | 'snapshot_changed' | 'malformed_history' | 'expired'
  ) {
    super(message)
    this.name = 'RuntimeMigrationSnapshotError'
  }
}

type SnapshotInfo = RuntimeMigrationExportSnapshot & { filePath: string }

export class RuntimeMigrationService {
  private readonly rootDir: string
  private readonly snapshots = new Map<string, SnapshotInfo>()

  constructor(private readonly deps: {
    rootDir: string
    threads: Pick<ThreadService, 'get'>
    turns: Pick<TurnService, 'interruptTurn'>
    sessions: SessionStore
    approvals: ApprovalGate
    userInputs: UserInputGate
    artifactStore?: ArtifactStore
    attachmentStore: () => AttachmentStore | undefined
    memoryStore: () => MemoryStore | undefined
    nowIso: () => string
  }) {
    this.rootDir = resolve(deps.rootDir)
  }

  async createExport(request: RuntimeMigrationExportCreateRequest): Promise<RuntimeMigrationExportSnapshot> {
    await this.cleanupExpired()
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    const snapshotId = `migexp_${randomUUID().replaceAll('-', '')}`
    const filePath = join(this.rootDir, `${snapshotId}.jsonl`)
    const createdAt = this.deps.nowIso()
    const expiresAt = new Date(Date.parse(createdAt) + request.snapshotTtlMs).toISOString()
    const exportedThreadIds: string[] = []
    const omittedThreadIds: string[] = []
    const exportedAttachmentIds = new Set<string>()
    const exportedArtifactIds = new Set<string>()
    const exportedMemoryIds = new Set<string>()
    let recordCount = 0

    try {
      recordCount += await appendSnapshotRecord(filePath, {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        type: 'metadata',
        value: {
          snapshotId,
          createdAt,
          expiresAt,
          selectedThreadIds: request.threadIds,
          normalization: {
            activeTurns: 'aborted-history',
            approvals: 'non-actionable-history',
            userInputs: 'non-actionable-history',
            backgroundExecution: 'excluded'
          }
        }
      }, 'wx')

      for (const threadId of request.threadIds) {
        const readiness = await this.prepareThread(threadId, request)
        if (readiness === 'omit') {
          omittedThreadIds.push(threadId)
          continue
        }
        const exported = await this.writeStableThreadSnapshot({
          snapshotId,
          filePath,
          threadId,
          request,
          exportedAttachmentIds,
          exportedArtifactIds,
          exportedMemoryIds
        })
        recordCount += exported.records
        exportedThreadIds.push(threadId)
      }

      recordCount += await appendSnapshotRecord(filePath, {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        type: 'footer',
        value: {
          exportedThreadIds,
          omittedThreadIds,
          content: {
            attachments: exportedAttachmentIds.size,
            artifacts: exportedArtifactIds.size,
            memories: exportedMemoryIds.size
          }
        }
      })
      const info = await stat(filePath)
      const contentCounts = {
        attachments: exportedAttachmentIds.size,
        artifacts: exportedArtifactIds.size,
        memories: exportedMemoryIds.size
      }
      const snapshot: SnapshotInfo = {
        snapshotId,
        createdAt,
        expiresAt,
        selectedThreadIds: [...request.threadIds],
        exportedThreadIds,
        omittedThreadIds,
        contentCounts,
        recordCount,
        byteSize: info.size,
        sha256: await sha256File(filePath),
        filePath
      }
      this.snapshots.set(snapshotId, snapshot)
      return publicSnapshot(snapshot)
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async getExport(snapshotId: string): Promise<{ snapshot: RuntimeMigrationExportSnapshot; filePath: string }> {
    await this.cleanupExpired()
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) throw new RuntimeMigrationSnapshotError(`migration export snapshot not found: ${snapshotId}`, 'not_found')
    if (Date.parse(snapshot.expiresAt) <= Date.parse(this.deps.nowIso())) {
      await this.releaseExport(snapshotId)
      throw new RuntimeMigrationSnapshotError(`migration export snapshot expired: ${snapshotId}`, 'expired')
    }
    return { snapshot: publicSnapshot(snapshot), filePath: snapshot.filePath }
  }

  async releaseExport(snapshotId: string): Promise<boolean> {
    const snapshot = this.snapshots.get(snapshotId)
    this.snapshots.delete(snapshotId)
    if (!snapshot) return false
    await rm(snapshot.filePath, { force: true })
    return true
  }

  async shutdown(): Promise<void> {
    const ids = [...this.snapshots.keys()]
    await Promise.all(ids.map((id) => this.releaseExport(id)))
  }

  private async prepareThread(
    threadId: string,
    request: RuntimeMigrationExportCreateRequest
  ): Promise<'ready' | 'omit'> {
    const initial = await this.deps.threads.get(threadId)
    if (!initial) throw new RuntimeMigrationSnapshotError(`thread not found: ${threadId}`, 'not_found')
    const active = () => initialActiveTurns(this.deps.threads, threadId)
    let activeTurns = await active()
    if (activeTurns.length === 0) return 'ready'
    if (request.runningThreadPolicy === 'omit') return 'omit'
    if (request.runningThreadPolicy === 'interrupt') {
      for (const turnId of activeTurns) {
        await this.deps.turns.interruptTurn({ threadId, turnId })
      }
      return 'ready'
    }

    const deadline = Date.now() + request.waitTimeoutMs
    while (activeTurns.length > 0 && Date.now() < deadline) {
      await delay(SNAPSHOT_WAIT_POLL_MS)
      activeTurns = await active()
    }
    if (activeTurns.length > 0) {
      throw new RuntimeMigrationSnapshotError(
        `thread is still running after ${request.waitTimeoutMs}ms: ${threadId}`,
        'running_thread'
      )
    }
    return 'ready'
  }

  private async writeStableThreadSnapshot(input: {
    snapshotId: string
    filePath: string
    threadId: string
    request: RuntimeMigrationExportCreateRequest
    exportedAttachmentIds: Set<string>
    exportedArtifactIds: Set<string>
    exportedMemoryIds: Set<string>
  }): Promise<{ records: number }> {
    for (let attempt = 1; attempt <= SNAPSHOT_MUTATION_RETRIES; attempt += 1) {
      const temporaryPath = join(this.rootDir, `.${input.snapshotId}.${input.threadId}.${attempt}.tmp`)
      try {
        const attemptContent = {
          threadId: input.threadId,
          request: input.request,
          exportedAttachmentIds: new Set(input.exportedAttachmentIds),
          exportedArtifactIds: new Set(input.exportedArtifactIds),
          exportedMemoryIds: new Set(input.exportedMemoryIds)
        }
        const thread = await this.deps.threads.get(input.threadId)
        if (!thread) throw new RuntimeMigrationSnapshotError(`thread not found: ${input.threadId}`, 'not_found')
        const itemSnapshot = await this.deps.sessions.loadItemSnapshot(input.threadId)
        const parsedThread = ThreadSchema.safeParse(thread)
        const parsedItems = TurnItem.array().safeParse(itemSnapshot.items)
        if (!parsedThread.success || !parsedItems.success) {
          throw new RuntimeMigrationSnapshotError(`thread history is malformed: ${input.threadId}`, 'malformed_history')
        }
        const highestSeq = await this.deps.sessions.highestSeq(input.threadId)
        const session = await this.deps.sessions.loadSession(input.threadId)
        let records = 0
        const references = collectReachableIds([thread, itemSnapshot.items, session])

        records += await appendSnapshotRecord(temporaryPath, {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          type: 'thread',
          ownerId: input.threadId,
          value: normalizeThreadForHistory(thread, this.deps.nowIso())
        }, 'wx')
        if (session) {
          records += await appendSnapshotRecord(temporaryPath, {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            type: 'session',
            ownerId: input.threadId,
            value: sanitizeMigrationValue({ ...session, items: [], events: [], closed: true })
          })
        }
        for (const item of itemSnapshot.items) {
          records += await appendSnapshotRecord(temporaryPath, {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            type: 'item',
            ownerId: input.threadId,
            value: normalizeHistoricalItem(item)
          })
        }
        const events = this.deps.sessions.iterateEventsSince?.(input.threadId, 0)
        if (events) {
          for await (const event of events) {
            if (!RuntimeEvent.safeParse(event).success) {
              throw new RuntimeMigrationSnapshotError(`thread event history is malformed: ${input.threadId}`, 'malformed_history')
            }
            records += await appendSnapshotRecord(temporaryPath, {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              type: 'event',
              ownerId: input.threadId,
              value: normalizeHistoricalEvent(event)
            })
          }
        } else {
          for (const event of await this.deps.sessions.loadEventsSince(input.threadId, 0)) {
            if (!RuntimeEvent.safeParse(event).success) {
              throw new RuntimeMigrationSnapshotError(`thread event history is malformed: ${input.threadId}`, 'malformed_history')
            }
            records += await appendSnapshotRecord(temporaryPath, {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              type: 'event',
              ownerId: input.threadId,
              value: normalizeHistoricalEvent(event)
            })
          }
        }
        for (const approval of this.deps.approvals.pending(input.threadId)) {
          records += await appendSnapshotRecord(temporaryPath, {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            type: 'historical-approval',
            ownerId: input.threadId,
            value: { ...sanitizeRecord(approval), status: 'expired-at-export', actionable: false }
          })
        }
        for (const userInput of this.deps.userInputs.pending(input.threadId)) {
          records += await appendSnapshotRecord(temporaryPath, {
            schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            type: 'historical-user-input',
            ownerId: input.threadId,
            value: { ...sanitizeRecord(userInput), status: 'expired-at-export', actionable: false }
          })
        }

        records += await this.appendReachableContent(temporaryPath, attemptContent, thread.workspace, references)

        const [threadAfter, itemAfter, highestSeqAfter] = await Promise.all([
          this.deps.threads.get(input.threadId),
          this.deps.sessions.loadItemSnapshot(input.threadId),
          this.deps.sessions.highestSeq(input.threadId)
        ])
        if (
          threadAfter &&
          threadAfter.updatedAt === thread.updatedAt &&
          itemAfter.revision === itemSnapshot.revision &&
          highestSeqAfter === highestSeq
        ) {
          await pipeline(
            createReadStream(temporaryPath),
            createWriteStream(input.filePath, { flags: 'a', mode: 0o600 })
          )
          for (const id of attemptContent.exportedAttachmentIds) input.exportedAttachmentIds.add(id)
          for (const id of attemptContent.exportedArtifactIds) input.exportedArtifactIds.add(id)
          for (const id of attemptContent.exportedMemoryIds) input.exportedMemoryIds.add(id)
          return { records }
        }
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }
    }
    throw new RuntimeMigrationSnapshotError(
      `thread changed repeatedly while creating migration snapshot: ${input.threadId}`,
      'snapshot_changed'
    )
  }

  private async appendReachableContent(
    path: string,
    input: {
      threadId: string
      request: RuntimeMigrationExportCreateRequest
      exportedAttachmentIds: Set<string>
      exportedArtifactIds: Set<string>
      exportedMemoryIds: Set<string>
    },
    workspace: string,
    references: { attachments: Set<string>; artifacts: Set<string> }
  ): Promise<number> {
    let records = 0
    const attachments = this.deps.attachmentStore()
    if (input.request.includeAttachments && attachments) {
      for (const id of references.attachments) {
        if (input.exportedAttachmentIds.has(id)) continue
        const metadata = await attachments.get(id)
        if (!metadata) continue
        const content = await attachments.resolveContent(id, { threadId: input.threadId, workspace })
        input.exportedAttachmentIds.add(id)
        records += await appendSnapshotRecord(path, {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          type: 'attachment',
          ownerId: input.threadId,
          contentId: content.hash,
          value: {
            metadata: sanitizeMigrationValue({ ...metadata, localFilePath: undefined }),
            content: chunkedContentDescriptor(content.data)
          }
        })
        records += await appendContentChunks(path, {
          kind: 'attachment',
          sourceId: metadata.id,
          ownerId: input.threadId,
          contentId: content.hash,
          data: content.data
        })
      }
    }
    if (input.request.includeArtifacts && this.deps.artifactStore) {
      for (const id of references.artifacts) {
        if (input.exportedArtifactIds.has(id)) continue
        const [metadata, content] = await Promise.all([
          this.deps.artifactStore.stat(id),
          this.deps.artifactStore.get(id)
        ])
        if (!metadata || content === null) continue
        input.exportedArtifactIds.add(id)
        const contentBytes = Buffer.from(content, 'utf8')
        const contentId = sha256Buffer(contentBytes)
        records += await appendSnapshotRecord(path, {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          type: 'artifact',
          ownerId: input.threadId,
          contentId,
          value: { metadata: sanitizeMigrationValue(metadata), content: chunkedContentDescriptor(contentBytes) }
        })
        records += await appendContentChunks(path, {
          kind: 'artifact',
          sourceId: metadata.id,
          ownerId: input.threadId,
          contentId,
          data: contentBytes
        })
      }
    }
    const memories = this.deps.memoryStore()
    if (input.request.includeMemory && memories) {
      for (const memory of await memories.list({ workspace, includeDeleted: false })) {
        if (input.exportedMemoryIds.has(memory.id)) continue
        if (memory.sourceThreadId && memory.sourceThreadId !== input.threadId && memory.workspace !== workspace) continue
        input.exportedMemoryIds.add(memory.id)
        records += await appendSnapshotRecord(path, {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          type: 'memory',
          ownerId: input.threadId,
          contentId: memory.id,
          value: sanitizeMigrationValue(memory)
        })
      }
    }
    return records
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.parse(this.deps.nowIso())
    const expired = [...this.snapshots.values()]
      .filter((snapshot) => Date.parse(snapshot.expiresAt) <= now)
      .map((snapshot) => snapshot.snapshotId)
    await Promise.all(expired.map((id) => this.releaseExport(id)))
  }
}

async function initialActiveTurns(
  threads: Pick<ThreadService, 'get'>,
  threadId: string
): Promise<string[]> {
  const thread = await threads.get(threadId)
  if (!thread) throw new RuntimeMigrationSnapshotError(`thread not found: ${threadId}`, 'not_found')
  return thread.turns
    .filter((turn) => turn.status === 'queued' || turn.status === 'running')
    .map((turn) => turn.id)
}

function normalizeThreadForHistory<T>(thread: T, nowIso: string): unknown {
  const sanitized = sanitizeRecord(thread)
  if (Array.isArray(sanitized.turns)) {
    sanitized.turns = sanitized.turns.map((value) => {
      const turn = sanitizeRecord(value)
      if (turn.status === 'queued' || turn.status === 'running') {
        return { ...turn, status: 'aborted', finishedAt: nowIso, error: 'Turn normalized during migration export.' }
      }
      return turn
    })
  }
  if (sanitized.status === 'running') sanitized.status = 'idle'
  return sanitized
}

function normalizeHistoricalItem(item: TurnItem): unknown {
  const sanitized = sanitizeMigrationValue(item) as Record<string, unknown>
  if (item.kind === 'approval' && item.status === 'pending') {
    return { ...sanitized, status: 'expired' }
  }
  if (item.kind === 'user_input' && item.status === 'pending') {
    return { ...sanitized, status: 'cancelled' }
  }
  return sanitized
}

function normalizeHistoricalEvent(event: RuntimeEvent): unknown {
  const sanitized = sanitizeMigrationValue(event) as Record<string, unknown>
  if (event.kind === 'approval_requested' && event.status === 'pending') {
    return {
      ...sanitized,
      kind: 'approval_resolved',
      status: 'expired',
      reason: 'Approval expired during migration export.'
    }
  }
  if (event.kind === 'user_input_requested' && event.status === 'pending') {
    return {
      ...sanitized,
      kind: 'user_input_resolved',
      status: 'cancelled'
    }
  }
  return sanitized
}

export function sanitizeMigrationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMigrationValue)
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    if (SECRET_KEY.test(key) || child === undefined) continue
    output[key] = sanitizeMigrationValue(child)
  }
  return output
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeMigrationValue(value)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {}
}

function collectReachableIds(values: unknown[]): { attachments: Set<string>; artifacts: Set<string> } {
  const attachments = new Set<string>()
  const artifacts = new Set<string>()
  const pending: unknown[] = [...values]
  const seen = new WeakSet<object>()
  const inspectText = (text: string): void => {
    for (const id of text.match(/att_[0-9a-f]{24}/g) ?? []) attachments.add(id)
    for (const id of text.match(/art_[0-9a-f]{1,64}/g) ?? []) artifacts.add(id)
  }
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      inspectText(value)
      continue
    }
    if (!value || typeof value !== 'object') continue
    if (seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child)
      continue
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      inspectText(key)
      pending.push(child)
    }
  }
  return { attachments, artifacts }
}

async function appendSnapshotRecord(
  path: string,
  record: RuntimeMigrationSnapshotRecord,
  flag: 'a' | 'wx' = 'a'
): Promise<number> {
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag })
  return 1
}

function chunkedContentDescriptor(data: Buffer): {
  encoding: 'base64-chunks'
  byteSize: number
  sha256: string
  chunkCount: number
} {
  return {
    encoding: 'base64-chunks',
    byteSize: data.byteLength,
    sha256: sha256Buffer(data),
    chunkCount: Math.max(1, Math.ceil(data.byteLength / SNAPSHOT_CONTENT_CHUNK_BYTES))
  }
}

async function appendContentChunks(path: string, input: {
  kind: 'attachment' | 'artifact'
  sourceId: string
  ownerId: string
  contentId: string
  data: Buffer
}): Promise<number> {
  const count = Math.max(1, Math.ceil(input.data.byteLength / SNAPSHOT_CONTENT_CHUNK_BYTES))
  let records = 0
  for (let index = 0; index < count; index += 1) {
    const start = index * SNAPSHOT_CONTENT_CHUNK_BYTES
    const data = input.data.subarray(start, Math.min(start + SNAPSHOT_CONTENT_CHUNK_BYTES, input.data.byteLength))
    records += await appendSnapshotRecord(path, {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      type: 'content-chunk',
      ownerId: input.ownerId,
      contentId: input.contentId,
      value: {
        kind: input.kind,
        sourceId: input.sourceId,
        index,
        count,
        dataBase64: data.toString('base64')
      }
    })
  }
  return records
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function publicSnapshot(snapshot: SnapshotInfo): RuntimeMigrationExportSnapshot {
  const { filePath: _filePath, ...value } = snapshot
  return value
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

export async function readRuntimeMigrationSnapshotRecords(path: string): Promise<RuntimeMigrationSnapshotRecord[]> {
  const contents = await readFile(path, 'utf8')
  return contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RuntimeMigrationSnapshotRecord)
}
