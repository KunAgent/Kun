import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { AttachmentsCapabilityConfig, MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryRecord } from '../contracts/memory.js'
import { RuntimeMigrationImportControl, type RuntimeMigrationSnapshotRecord } from '../contracts/migrations.js'
import { createThreadRecord } from '../domain/thread.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import { RuntimeMigrationImportService } from './runtime-migration-import-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-import-'))
  roots.push(root)
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const maintenance = new ScopedMigrationMaintenanceLock()
  const service = new RuntimeMigrationImportService({
    rootDir: join(root, 'imports'),
    threadStore,
    sessionStore,
    maintenance,
    attachmentStore: () => undefined,
    memoryStore: () => undefined
  })
  return { service, threadStore, sessionStore, maintenance, importRoot: join(root, 'imports') }
}

function control(configuredProviderIds: string[] = []) {
  return RuntimeMigrationImportControl.parse({
    schemaVersion: 1,
    type: 'import-control',
    value: {
      operationId: 'import_test',
      workspacePathMap: { 'C:\\Users\\Alice\\Project': '/Users/bob/Project' },
      configuredProviderIds
    }
  })
}

function thread(id = 'thread_source', overrides: Record<string, unknown> = {}) {
  return {
    ...createThreadRecord({
      id,
      title: 'Imported history',
      workspace: 'C:\\Users\\Alice\\Project',
      model: 'historical-model',
      providerId: 'historical-provider',
      createdAt: '2026-07-15T00:00:00.000Z'
    }),
    ...overrides
  }
}

async function *records(values: RuntimeMigrationSnapshotRecord[]) {
  for (const value of values) yield value
}

function threadRecord(value: ReturnType<typeof thread>): RuntimeMigrationSnapshotRecord {
  return { schemaVersion: 1, type: 'thread', ownerId: value.id, value }
}

describe('RuntimeMigrationImportService', () => {
  it('preflights, commits additively, rebinds workspace paths, verifies, and rolls back idempotently', async () => {
    const h = await harness()
    const preflight = await h.service.preflight(control(), records([threadRecord(thread())]))
    expect(preflight.threadIdMap.thread_source).toBe('thread_source')
    expect(await h.threadStore.get('thread_source')).toBeNull()

    const committed = await h.service.commit(preflight.importId)
    expect(committed.status).toBe('committed')
    const imported = await h.threadStore.get('thread_source')
    expect(imported?.workspace).toBe('/Users/bob/Project')
    expect(imported?.providerId).toBeUndefined()
    expect(imported?.summary).toContain('historical-provider')
    expect((await h.service.verify(preflight.importId)).status).toBe('verified')

    expect((await h.service.rollback(preflight.importId)).status).toBe('rolled-back')
    expect(await h.threadStore.get('thread_source')).toBeNull()
    expect((await h.service.rollback(preflight.importId)).status).toBe('rolled-back')
    expect(await h.service.release(preflight.importId)).toBe(true)
    await expect(h.service.rollback(preflight.importId)).rejects.toThrow('not found')
  })

  it('preserves an exact existing history through canonical deduplication', async () => {
    const h = await harness()
    const existing = thread()
    await h.threadStore.upsert(existing)
    const preflight = await h.service.preflight(control(['historical-provider']), records([threadRecord(existing)]))
    expect(preflight.deduplicatedThreadIds).toEqual(['thread_source'])
    expect(preflight.introducedThreadIds).toEqual([])
    const committed = await h.service.commit(preflight.importId)
    expect(committed.introducedThreadIds).toEqual([])
    expect((await h.threadStore.get('thread_source'))?.providerId).toBe('historical-provider')
  })

  it('allocates one operation-wide ID map for different-content collisions and lineage', async () => {
    const h = await harness()
    await h.threadStore.upsert(thread('thread_source', { title: 'Existing different history' }))
    const child = thread('thread_child', { relation: 'fork', parentThreadId: 'thread_source', forkedFromThreadId: 'thread_source' })
    const preflight = await h.service.preflight(control(['historical-provider']), records([
      threadRecord(thread()),
      threadRecord(child)
    ]))
    expect(preflight.threadIdMap.thread_source).toMatch(/^thr_import_/)
    expect(preflight.threadIdMap.thread_child).toBe('thread_child')
    await h.service.commit(preflight.importId)
    const importedChild = await h.threadStore.get('thread_child')
    expect(importedChild?.parentThreadId).toBe(preflight.threadIdMap.thread_source)
    expect(importedChild?.forkedFromThreadId).toBe(preflight.threadIdMap.thread_source)
    expect((await h.threadStore.get('thread_source'))?.title).toBe('Existing different history')
  })

  it('holds a scoped maintenance lock exclusively', async () => {
    const h = await harness()
    const first = h.maintenance.acquire('operation_one')
    expect(h.maintenance.isLocked()).toBe(true)
    expect(() => h.maintenance.acquire('operation_two')).toThrow('already active')
    first.release()
    expect(h.maintenance.isLocked()).toBe(false)
  })

  it('reloads durable import state after restart and resumes session replay and rollback idempotently', async () => {
    const h = await harness()
    const sourceThread = thread()
    const now = '2026-07-15T00:00:00.000Z'
    const item = {
      id: 'item_imported', turnId: 'turn_imported', threadId: sourceThread.id,
      role: 'user' as const, status: 'completed' as const, createdAt: now, finishedAt: now,
      kind: 'user_message' as const, text: 'Migrated message'
    }
    const preflight = await h.service.preflight(control(), records([
      threadRecord(sourceThread),
      { schemaVersion: 1, type: 'session', ownerId: sourceThread.id, value: {
        threadId: sourceThread.id, turnId: 'turn_imported', startedAt: now, updatedAt: now,
        items: [], events: [], closed: true
      } },
      { schemaVersion: 1, type: 'item', ownerId: sourceThread.id, value: item },
      { schemaVersion: 1, type: 'event', ownerId: sourceThread.id, value: {
        kind: 'heartbeat', seq: 1, timestamp: now, threadId: sourceThread.id
      } }
    ]))
    await h.service.shutdown()

    const resumed = new RuntimeMigrationImportService({
      rootDir: h.importRoot,
      threadStore: h.threadStore,
      sessionStore: h.sessionStore,
      maintenance: h.maintenance,
      attachmentStore: () => undefined,
      memoryStore: () => undefined
    })
    expect((await resumed.commit(preflight.importId)).status).toBe('committed')
    expect((await h.sessionStore.loadItems(sourceThread.id)).map((value) => value.id)).toEqual(['item_imported'])
    expect(await h.sessionStore.highestSeq(sourceThread.id)).toBe(1)
    expect((await h.sessionStore.loadSession(sourceThread.id))?.closed).toBe(true)
    await resumed.shutdown()

    const recovered = new RuntimeMigrationImportService({
      rootDir: h.importRoot,
      threadStore: h.threadStore,
      sessionStore: h.sessionStore,
      maintenance: h.maintenance,
      attachmentStore: () => undefined,
      memoryStore: () => undefined
    })
    expect((await recovered.verify(preflight.importId)).status).toBe('verified')
    expect((await recovered.rollback(preflight.importId)).status).toBe('rolled-back')
    expect(await h.threadStore.get(sourceThread.id)).toBeNull()
    expect(await h.sessionStore.loadItems(sourceThread.id)).toEqual([])
  })

  it('verifies reachable attachments, artifacts, and memory and removes only introduced content on rollback', async () => {
    const h = await harness()
    const attachmentsConfig = AttachmentsCapabilityConfig.parse({ enabled: true })
    const sourceAttachments = new FileAttachmentStore({ rootDir: join(h.importRoot, '..', 'source-attachments'), config: attachmentsConfig })
    const attachment = await sourceAttachments.create({
      name: 'notes.txt', data: Buffer.from('portable notes'), mimeType: 'text/plain',
      documentText: 'portable notes', threadId: 'thread_source', workspace: 'C:\\Users\\Alice\\Project'
    })
    const attachmentContent = await sourceAttachments.resolveContent(attachment.id, { threadId: 'thread_source' })
    const targetAttachments = new FileAttachmentStore({ rootDir: join(h.importRoot, '..', 'target-attachments'), config: attachmentsConfig })
    const artifacts = new FileArtifactStore(join(h.importRoot, '..', 'artifacts'))
    const artifactContent = 'portable artifact body'
    const artifactSourceId = (await new FileArtifactStore(join(h.importRoot, '..', 'source-artifacts')).put({ content: artifactContent })).meta.id
    const memories = new FileMemoryStore({
      rootDir: join(h.importRoot, '..', 'memory'),
      config: MemoryCapabilityConfig.parse({ enabled: true })
    })
    const service = new RuntimeMigrationImportService({
      rootDir: h.importRoot, threadStore: h.threadStore, sessionStore: h.sessionStore,
      maintenance: h.maintenance, attachmentStore: () => targetAttachments,
      artifactStore: artifacts, memoryStore: () => memories
    })
    const sourceThread = thread()
    const now = '2026-07-15T00:00:00.000Z'
    const sourceMemory = MemoryRecord.parse({
      id: 'mem_source', content: 'remember the portable preference', scope: 'workspace',
      workspace: 'C:\\Users\\Alice\\Project', sourceThreadId: sourceThread.id,
      tags: ['portable'], confidence: 0.9, createdAt: now, updatedAt: now
    })
    const preflight = await service.preflight(control(), records([
      threadRecord(sourceThread),
      { schemaVersion: 1, type: 'item', ownerId: sourceThread.id, value: {
        id: 'item_attachment', turnId: 'turn_content', threadId: sourceThread.id, role: 'user',
        status: 'completed', createdAt: now, kind: 'user_message', text: 'See files',
        attachmentIds: [attachment.id]
      } },
      { schemaVersion: 1, type: 'item', ownerId: sourceThread.id, value: {
        id: 'item_artifact', turnId: 'turn_content', threadId: sourceThread.id, role: 'tool',
        status: 'completed', createdAt: now, kind: 'tool_result', toolName: 'test', callId: 'call_content',
        toolKind: 'tool_call', output: { artifactId: artifactSourceId }, isError: false
      } },
      { schemaVersion: 1, type: 'attachment', ownerId: sourceThread.id, contentId: attachment.id, value: {
        metadata: attachment, dataBase64: attachmentContent.data.toString('base64')
      } },
      { schemaVersion: 1, type: 'artifact', contentId: artifactSourceId, value: {
        metadata: { id: artifactSourceId, mimeType: 'text/plain', source: 'tool', origin: 'migration-test' },
        content: artifactContent
      } },
      { schemaVersion: 1, type: 'memory', contentId: sourceMemory.id, value: sourceMemory }
    ]))
    await service.commit(preflight.importId)
    await service.verify(preflight.importId)
    const importedItems = await h.sessionStore.loadItems(sourceThread.id)
    const importedAttachmentId = (importedItems.find((item) => item.id === 'item_attachment') as { attachmentIds?: string[] }).attachmentIds![0]!
    expect((await targetAttachments.resolveContent(importedAttachmentId, { threadId: sourceThread.id })).data.toString()).toBe('portable notes')
    const importedArtifactId = ((importedItems.find((item) => item.id === 'item_artifact') as { output?: { artifactId?: string } }).output?.artifactId)!
    expect(await artifacts.get(importedArtifactId)).toBe(artifactContent)
    expect((await memories.list({ all: true }))[0]).toMatchObject({
      workspace: '/Users/bob/Project', sourceThreadId: sourceThread.id
    })

    await service.rollback(preflight.importId)
    expect(await targetAttachments.get(importedAttachmentId)).toBeNull()
    expect(await artifacts.stat(importedArtifactId)).toBeNull()
    expect(await memories.list({ all: true, includeDeleted: true })).toEqual([])
  })

  it('imports a near-limit attachment from bounded chunks and verifies its content', async () => {
    const h = await harness()
    const config = AttachmentsCapabilityConfig.parse({ enabled: true })
    const targetAttachments = new FileAttachmentStore({
      rootDir: join(h.importRoot, '..', 'large-target-attachments'),
      config
    })
    const sourceAttachments = new FileAttachmentStore({
      rootDir: join(h.importRoot, '..', 'large-source-attachments'),
      config
    })
    const data = Buffer.alloc(9 * 1024 * 1024, 0x41)
    data.write('%PDF-', 0, 'ascii')
    const metadata = await sourceAttachments.create({
      name: 'large-portable-design.pdf',
      data,
      mimeType: 'application/pdf',
      documentText: 'Large portable design',
      threadId: 'thread_source',
      workspace: 'C:\\Users\\Alice\\Project'
    })
    const digest = createHash('sha256').update(data).digest('hex')
    const chunkBytes = 1024 * 1024
    const chunkCount = Math.ceil(data.byteLength / chunkBytes)
    const contentRecords: RuntimeMigrationSnapshotRecord[] = [{
      schemaVersion: 1,
      type: 'attachment',
      ownerId: 'thread_source',
      contentId: digest,
      value: {
        metadata,
        content: { encoding: 'base64-chunks', byteSize: data.byteLength, sha256: digest, chunkCount }
      }
    }]
    for (let index = 0; index < chunkCount; index += 1) {
      contentRecords.push({
        schemaVersion: 1,
        type: 'content-chunk',
        ownerId: 'thread_source',
        contentId: digest,
        value: {
          kind: 'attachment',
          sourceId: metadata.id,
          index,
          count: chunkCount,
          dataBase64: data.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString('base64')
        }
      })
    }
    const service = new RuntimeMigrationImportService({
      rootDir: h.importRoot,
      threadStore: h.threadStore,
      sessionStore: h.sessionStore,
      maintenance: h.maintenance,
      attachmentStore: () => targetAttachments,
      memoryStore: () => undefined
    })
    const sourceThread = thread()
    const preflight = await service.preflight(control(), records([
      threadRecord(sourceThread),
      { schemaVersion: 1, type: 'item', ownerId: sourceThread.id, value: {
        id: 'item_large_attachment', turnId: 'turn_large_attachment', threadId: sourceThread.id,
        role: 'user', status: 'completed', createdAt: '2026-07-15T00:00:00.000Z',
        kind: 'user_message', text: `See ${metadata.id}`, attachmentIds: [metadata.id]
      } },
      ...contentRecords
    ]))
    expect(Math.max(...contentRecords.map((record) => Buffer.byteLength(`${JSON.stringify(record)}\n`))))
      .toBeLessThan(8 * 1024 * 1024)
    await service.commit(preflight.importId)
    await service.verify(preflight.importId)
    const item = (await h.sessionStore.loadItems(sourceThread.id))[0] as { attachmentIds?: string[] }
    const imported = await targetAttachments.resolveContent(item.attachmentIds![0]!, { threadId: sourceThread.id })
    expect(imported.data.byteLength).toBe(data.byteLength)
    expect(createHash('sha256').update(imported.data).digest('hex')).toBe(digest)
  }, 20_000)

  it('fails closed when a chunked content sequence is incomplete', async () => {
    const h = await harness()
    const data = Buffer.from('first half only')
    const completeDigest = createHash('sha256').update(Buffer.concat([data, Buffer.from('missing')])).digest('hex')
    const sourceId = `att_${completeDigest.slice(0, 24)}`
    const preflight = await h.service.preflight(control(), records([
      threadRecord(thread()),
      { schemaVersion: 1, type: 'attachment', ownerId: 'thread_source', contentId: completeDigest, value: {
        metadata: {
          id: sourceId, name: 'incomplete.txt', kind: 'document', mimeType: 'text/plain',
          byteSize: data.byteLength + 7, hash: completeDigest, documentText: 'incomplete',
          threadIds: ['thread_source'], workspaces: [],
          createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z'
        },
        content: {
          encoding: 'base64-chunks', byteSize: data.byteLength + 7,
          sha256: completeDigest, chunkCount: 2
        }
      } },
      { schemaVersion: 1, type: 'content-chunk', ownerId: 'thread_source', contentId: completeDigest, value: {
        kind: 'attachment', sourceId, index: 0, count: 2, dataBase64: data.toString('base64')
      } }
    ]))
    await expect(h.service.commit(preflight.importId)).rejects.toThrow('incomplete migration attachment content chunks')
    expect(await h.threadStore.get('thread_source')).toBeNull()
  })
})
