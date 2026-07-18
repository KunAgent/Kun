import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { AttachmentsCapabilityConfig } from '../contracts/capabilities.js'
import { RuntimeMigrationExportCreateRequest } from '../contracts/migrations.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import {
  RuntimeMigrationService,
  RuntimeMigrationSnapshotError,
  readRuntimeMigrationSnapshotRecords,
  sanitizeMigrationValue
} from './runtime-migration-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness(input: {
  running?: boolean
  sessions?: InMemorySessionStore
  nowIso?: () => string
  deleteAfterReads?: number
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-'))
  roots.push(root)
  const sessions = input.sessions ?? new InMemorySessionStore()
  let thread = createThreadRecord({
    id: 'thread_test',
    title: 'Portable history',
    workspace: '/source/workspace',
    model: 'historical-model',
    providerId: 'historical-provider',
    accountId: 'account_must_not_export',
    createdAt: '2026-07-15T00:00:00.000Z',
    status: input.running ? 'running' : 'idle'
  })
  if (input.running) {
    thread = {
      ...thread,
      turns: [createTurnRecord({
        id: 'turn_running',
        threadId: thread.id,
        prompt: 'work',
        status: 'running',
        createdAt: '2026-07-15T00:00:00.000Z'
      })]
    }
  }
  let threadReads = 0
  const attachments = new FileAttachmentStore({
    rootDir: join(root, 'attachments'),
    config: AttachmentsCapabilityConfig.parse({ enabled: true })
  })
  const service = new RuntimeMigrationService({
    rootDir: join(root, 'exports'),
    threads: { get: async (id) => {
      threadReads += 1
      if (input.deleteAfterReads !== undefined && threadReads > input.deleteAfterReads) return null
      return id === thread.id ? thread : null
    } },
    turns: {
      interruptTurn: async ({ threadId, turnId }) => {
        if (threadId !== thread.id) throw new Error('missing thread')
        thread = {
          ...thread,
          status: 'idle',
          turns: thread.turns.map((turn) => turn.id === turnId
            ? { ...turn, status: 'aborted' as const, finishedAt: '2026-07-15T00:00:01.000Z' }
            : turn)
        }
        return { status: 'aborted' as const }
      }
    },
    sessions,
    approvals: new InMemoryApprovalGate(),
    userInputs: new InMemoryUserInputGate(),
    attachmentStore: () => attachments,
    memoryStore: () => undefined,
    nowIso: input.nowIso ?? (() => '2026-07-15T00:00:02.000Z')
  })
  return { root, sessions, service, attachments, getThread: () => thread }
}

function request(policy: 'wait' | 'interrupt' | 'omit') {
  return RuntimeMigrationExportCreateRequest.parse({
    threadIds: ['thread_test'],
    includeAttachments: false,
    includeArtifacts: false,
    includeMemory: false,
    runningThreadPolicy: policy,
    waitTimeoutMs: 0,
    snapshotTtlMs: 60_000
  })
}

describe('RuntimeMigrationService', () => {
  it('creates a mutation-fenced canonical JSONL snapshot and releases it', async () => {
    const h = await harness()
    await h.sessions.appendEvent('thread_test', {
      kind: 'thread_created',
      seq: 1,
      timestamp: '2026-07-15T00:00:00.000Z',
      threadId: 'thread_test',
      title: 'Portable history'
    })
    const snapshot = await h.service.createExport(request('wait'))
    expect(snapshot.exportedThreadIds).toEqual(['thread_test'])
    expect(snapshot.omittedThreadIds).toEqual([])
    expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/)
    const located = await h.service.getExport(snapshot.snapshotId)
    const records = await readRuntimeMigrationSnapshotRecords(located.filePath)
    const thread = records.find((record) => record.type === 'thread')?.value as Record<string, unknown>
    expect(thread.providerId).toBe('historical-provider')
    expect(thread.accountId).toBeUndefined()
    expect(records.map((record) => record.type)).toEqual(['metadata', 'thread', 'event', 'footer'])

    expect(await h.service.releaseExport(snapshot.snapshotId)).toBe(true)
    await expect(stat(located.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('omits running threads only when explicitly requested', async () => {
    const h = await harness({ running: true })
    const snapshot = await h.service.createExport(request('omit'))
    expect(snapshot.exportedThreadIds).toEqual([])
    expect(snapshot.omittedThreadIds).toEqual(['thread_test'])
    expect(h.getThread().turns[0]?.status).toBe('running')
  })

  it('interrupts a selected running turn before taking its history snapshot', async () => {
    const h = await harness({ running: true })
    const snapshot = await h.service.createExport(request('interrupt'))
    expect(snapshot.exportedThreadIds).toEqual(['thread_test'])
    expect(h.getThread().turns[0]?.status).toBe('aborted')
  })

  it('fails a zero-time wait rather than silently exporting a live thread', async () => {
    const h = await harness({ running: true })
    await expect(h.service.createExport(request('wait'))).rejects.toMatchObject({
      code: 'running_thread'
    } satisfies Partial<RuntimeMigrationSnapshotError>)
  })

  it('removes credential-shaped structured fields while retaining ordinary history text', () => {
    expect(sanitizeMigrationValue({
      model: 'model-a',
      apiKey: 'secret',
      nested: { refresh_token: 'secret', text: 'the user typed apiKey in prose' }
    })).toEqual({
      model: 'model-a',
      nested: { text: 'the user typed apiKey in prose' }
    })
  })

  it('converts pending approval and user-input history into non-actionable records', async () => {
    const h = await harness()
    const createdAt = '2026-07-15T00:00:00.000Z'
    await h.sessions.appendItem('thread_test', {
      id: 'approval_item', turnId: 'turn_gate', threadId: 'thread_test', role: 'system',
      kind: 'approval', approvalId: 'approval_gate', toolName: 'bash', summary: 'Run command',
      status: 'pending', createdAt
    })
    await h.sessions.appendItem('thread_test', {
      id: 'input_item', turnId: 'turn_gate', threadId: 'thread_test', role: 'system',
      kind: 'user_input', inputId: 'input_gate', prompt: 'Choose', questions: [],
      status: 'pending', createdAt
    })
    await h.sessions.appendEvent('thread_test', {
      kind: 'approval_requested', seq: 1, timestamp: createdAt, threadId: 'thread_test',
      approvalId: 'approval_gate', toolName: 'bash', status: 'pending'
    })
    await h.sessions.appendEvent('thread_test', {
      kind: 'user_input_requested', seq: 2, timestamp: createdAt, threadId: 'thread_test',
      inputId: 'input_gate', status: 'pending'
    })
    const snapshot = await h.service.createExport(request('wait'))
    const records = await readRuntimeMigrationSnapshotRecords((await h.service.getExport(snapshot.snapshotId)).filePath)
    expect(records.find((record) => record.type === 'item' && (record.value as { id?: string }).id === 'approval_item')?.value)
      .toMatchObject({ status: 'expired' })
    expect(records.find((record) => record.type === 'item' && (record.value as { id?: string }).id === 'input_item')?.value)
      .toMatchObject({ status: 'cancelled' })
    expect(records.find((record) => record.type === 'event' && (record.value as { seq?: number }).seq === 1)?.value)
      .toMatchObject({ kind: 'approval_resolved', status: 'expired' })
    expect(records.find((record) => record.type === 'event' && (record.value as { seq?: number }).seq === 2)?.value)
      .toMatchObject({ kind: 'user_input_resolved', status: 'cancelled' })
  })

  it('rejects a snapshot when canonical history keeps changing across every retry', async () => {
    class UnstableSessionStore extends InMemorySessionStore {
      private read = 0

      override async loadItemSnapshot(threadId: string) {
        const snapshot = await super.loadItemSnapshot(threadId)
        this.read += 1
        return { ...snapshot, revision: this.read }
      }
    }
    const h = await harness({ sessions: new UnstableSessionStore() })
    await expect(h.service.createExport(request('wait'))).rejects.toMatchObject({
      code: 'snapshot_changed'
    } satisfies Partial<RuntimeMigrationSnapshotError>)
  })

  it('expires and removes unreleased snapshots after their bounded TTL', async () => {
    let now = '2026-07-15T00:00:02.000Z'
    const h = await harness({ nowIso: () => now })
    const snapshot = await h.service.createExport(request('wait'))
    const located = await h.service.getExport(snapshot.snapshotId)
    now = '2026-07-15T00:02:00.000Z'
    await expect(h.service.getExport(snapshot.snapshotId)).rejects.toMatchObject({ code: 'not_found' })
    await expect(stat(located.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when persisted item history is malformed', async () => {
    const h = await harness()
    await h.sessions.appendItem('thread_test', { id: 'broken-record' } as never)
    await expect(h.service.createExport(request('wait'))).rejects.toMatchObject({
      code: 'malformed_history'
    } satisfies Partial<RuntimeMigrationSnapshotError>)
  })

  it('does not publish a partial snapshot when a selected thread is concurrently deleted', async () => {
    const h = await harness({ deleteAfterReads: 3 })
    await expect(h.service.createExport(request('wait'))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('exports a large JSONL history with bounded incremental memory', async () => {
    const h = await harness()
    const itemCount = 5_000
    const text = `Portable history ${'x'.repeat(512)} att_${'a'.repeat(24)}`
    for (let index = 0; index < itemCount; index += 1) {
      await h.sessions.appendItem('thread_test', {
        id: `item_${index}`,
        turnId: `turn_${Math.floor(index / 2)}`,
        threadId: 'thread_test',
        role: 'assistant',
        kind: 'assistant_text',
        text,
        status: 'completed',
        createdAt: '2026-07-15T00:00:00.000Z',
        finishedAt: '2026-07-15T00:00:01.000Z'
      })
    }
    const baseline = process.memoryUsage().heapUsed
    let peak = baseline
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed)
    }, 2)
    const started = performance.now()
    let snapshot
    try {
      snapshot = await h.service.createExport(request('wait'))
    } finally {
      clearInterval(sampler)
    }
    expect(snapshot!.recordCount).toBe(itemCount + 3)
    expect(snapshot!.byteSize).toBeGreaterThan(itemCount * 512)
    expect(peak - baseline).toBeLessThan(64 * 1024 * 1024)
    expect(performance.now() - started).toBeLessThan(15_000)
  }, 20_000)

  it('chunks a near-limit attachment so every snapshot record remains bounded', async () => {
    const h = await harness()
    const data = Buffer.alloc(9 * 1024 * 1024, 0x5a)
    data.write('%PDF-', 0, 'ascii')
    const attachment = await h.attachments.create({
      name: 'portable-design.pdf',
      data,
      mimeType: 'application/pdf',
      documentText: 'Portable design document',
      threadId: 'thread_test',
      workspace: '/source/workspace'
    })
    await h.sessions.appendItem('thread_test', {
      id: 'item_large_attachment',
      turnId: 'turn_large_attachment',
      threadId: 'thread_test',
      role: 'user',
      kind: 'user_message',
      text: `See ${attachment.id}`,
      attachmentIds: [attachment.id],
      status: 'completed',
      createdAt: '2026-07-15T00:00:00.000Z',
      finishedAt: '2026-07-15T00:00:01.000Z'
    })
    const snapshot = await h.service.createExport(RuntimeMigrationExportCreateRequest.parse({
      threadIds: ['thread_test'],
      includeAttachments: true,
      includeArtifacts: false,
      includeMemory: false,
      runningThreadPolicy: 'wait',
      waitTimeoutMs: 0,
      snapshotTtlMs: 60_000
    }))
    expect(snapshot.contentCounts).toEqual({ attachments: 1, artifacts: 0, memories: 0 })
    const located = await h.service.getExport(snapshot.snapshotId)
    const records = await readRuntimeMigrationSnapshotRecords(located.filePath)
    const descriptor = records.find((record) => record.type === 'attachment')
    const chunks = records.filter((record) => record.type === 'content-chunk')
    expect(descriptor?.value).toMatchObject({
      metadata: { id: attachment.id },
      content: { encoding: 'base64-chunks', byteSize: data.byteLength, chunkCount: 9 }
    })
    expect(chunks).toHaveLength(9)
    const lines = (await readFile(located.filePath, 'utf8')).trimEnd().split('\n')
    expect(Math.max(...lines.map((line) => Buffer.byteLength(line)))).toBeLessThan(8 * 1024 * 1024)
  }, 20_000)
})
