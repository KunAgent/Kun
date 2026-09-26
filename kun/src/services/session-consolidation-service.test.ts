import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRecord as MemoryRecordSchema } from '../contracts/memory.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import type { TurnService } from './turn-service-core.js'
import { ConsolidationJobStore } from './consolidation-job-store.js'
import { ConsolidationRecoveryStore } from './consolidation-recovery-store.js'
import { SessionConsolidationService } from './session-consolidation-service.js'
import { ThreadSnapshotStore } from './thread-snapshot-store.js'

const roots: string[] = []
const NOW = '2026-09-18T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function userItem(text: string): TurnItem {
  return {
    id: 'item_1', turnId: 'turn_1', threadId: 'thread_1', role: 'user', status: 'completed',
    createdAt: NOW, finishedAt: NOW, kind: 'user_message', text
  }
}

function makeThread(): ThreadRecord {
  return {
    id: 'thread_1', title: 'Completed migration discussion', workspace: '/', model: 'test-model',
    mode: 'agent', status: 'archived', revision: 1, approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write', approvalReviewer: 'user', relation: 'primary',
    createdAt: NOW, updatedAt: NOW,
    turns: [{
      id: 'turn_1', threadId: 'thread_1', prompt: 'p', orchestration: 'direct', steering: [],
      createdAt: NOW, finishedAt: '2026-08-01T00:00:00.000Z', status: 'completed', items: [],
      attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedDirectiveIds: [], injectedDirectiveSummaries: [], injectedInstructionSources: []
    }]
  }
}

function modelClient(calls: { count: number }): ModelClient {
  const chunks: ModelStreamChunk[] = [
    { kind: 'assistant_text_delta', text: 'The migration plan was completed and documented.' },
    { kind: 'completed', stopReason: 'stop' }
  ]
  return {
    provider: 'test', model: 'test-model',
    async *stream() {
      calls.count += 1
      yield* chunks
    }
  }
}

function makeThreadStore(records: Map<string, ThreadRecord>) {
  return {
    async list(): Promise<ThreadSummary[]> {
      return [...records.values()].map((record) => ({ id: record.id }) as ThreadSummary)
    },
    async get(threadId: string): Promise<ThreadRecord | null> {
      return records.get(threadId) ?? null
    },
    async getMetadata(threadId: string): Promise<ThreadRecord | null> {
      return records.get(threadId) ?? null
    }
  }
}

function makeSessionStore(items: TurnItem[]): SessionStore {
  return {
    loadItemSnapshot: async () => ({ revision: 7, items }),
    highestSeq: async () => 1
  } as unknown as SessionStore
}

function makeMemoryStore(calls: { count: number }, withCreateWithId: boolean): MemoryStore {
  let record: ReturnType<typeof MemoryRecordSchema.parse> | undefined
  const store = {
    ...(withCreateWithId ? {
      async createWithId(id: string, input: Parameters<NonNullable<MemoryStore['createWithId']>>[1]) {
        calls.count += 1
        record = MemoryRecordSchema.parse({
          id, ...input, schemaVersion: 2, createdAt: NOW, updatedAt: NOW
        })
        return record
      }
    } : {}),
    async getById() {
      if (!record) throw new Error('memory not found')
      return record
    }
  }
  return store as unknown as MemoryStore
}

function makeService(input: {
  dataDir: string
  records: Map<string, ThreadRecord>
  modelClient: ModelClient
  memoryStore: MemoryStore
  pruneCalls: { count: number }
  nowIso?: () => string
  tier?: 'tier-1' | 'tier-2'
  reclaimMode?: 'safe' | 'reclaim-now'
  archiveTtlMs?: number
  deleteThread?: (threadId: string) => Promise<void>
  releasedArtifactOwners?: string[]
}): SessionConsolidationService {
  const threadStore = makeThreadStore(input.records)
  const snapshots = new ThreadSnapshotStore({ dataDir: input.dataDir, nowIso: input.nowIso ?? (() => NOW) })
  const jobStore = new ConsolidationJobStore({ dataDir: input.dataDir, nowIso: input.nowIso ?? (() => NOW) })
  const threadService = {
    async delete(threadId: string) {
      if (!input.deleteThread) throw new Error('unexpected Tier-2 delete')
      await input.deleteThread(threadId)
      return true
    }
  } as unknown as Pick<ThreadService, 'delete'>
  const turnService = {
    async pruneThread(request: { threadId: string }) {
      input.pruneCalls.count += 1
      const current = input.records.get(request.threadId)
      if (!current) throw new Error('thread missing')
      input.records.set(request.threadId, { ...current, turns: [], revision: (current.revision ?? 0) + 1 })
      await unlink(join(input.dataDir, 'threads', request.threadId, 'messages.jsonl')).catch(() => undefined)
      return undefined
    }
  } as unknown as Pick<TurnService, 'pruneThread'>

  return new SessionConsolidationService({
    config: () => ({
      enabled: true, tier: input.tier ?? 'tier-1', reclaimMode: input.reclaimMode ?? 'reclaim-now', idleAfterMs: 1, minBytes: 1,
      archiveTtlMs: input.archiveTtlMs ?? 1, maxThreadsPerRun: 1, summaryInputMaxBytes: 96 * 1024, summaryMaxTokens: 400
    }),
    dataDir: input.dataDir,
    threadStore,
    sessionStore: makeSessionStore([userItem('We completed and documented the migration plan.')]),
    threadService,
    turnService,
    snapshots,
    jobStore,
    memoryStore: () => input.memoryStore,
    modelClient: input.modelClient,
    nowIso: input.nowIso ?? (() => NOW),
    ...(input.releasedArtifactOwners ? {
      artifactStore: {
        async releaseOwner(ownerId: string) {
          input.releasedArtifactOwners!.push(ownerId)
          return { released: 0, deleted: 0 }
        }
      }
    } : {})
  })
}

describe('SessionConsolidationService', () => {
  it('writes the episode, checkpoints it, and only then trims the thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-service-'))
    roots.push(dataDir)
    await mkdir(join(dataDir, 'threads', 'thread_1'), { recursive: true })
    await writeFile(join(dataDir, 'threads', 'thread_1', 'messages.jsonl'), 'x'.repeat(500))

    const records = new Map([['thread_1', makeThread()]])
    const modelCalls = { count: 0 }
    const memoryCalls = { count: 0 }
    const pruneCalls = { count: 0 }
    const service = makeService({
      dataDir, records, modelClient: modelClient(modelCalls),
      memoryStore: makeMemoryStore(memoryCalls, true), pruneCalls
    })

    const report = await service.runOnce()

    expect(report).toMatchObject({ enabled: true, scheduled: 1, processed: 1, completed: 1, failures: [] })
    expect(modelCalls.count).toBe(1)
    expect(memoryCalls.count).toBe(1)
    expect(pruneCalls.count).toBe(1)
    const jobStore = new ConsolidationJobStore({ dataDir, nowIso: () => NOW })
    await jobStore.ready()
    const [job] = await jobStore.list()
    expect(job?.status).toBe('completed')
    expect(job?.checkpoint?.itemRevision).toBe(7)
    expect(job?.measuredBytes?.reclaimed).toBeGreaterThan(0)
  })

  it('stops at materialized when createWithId is unavailable and never trims', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-service-'))
    roots.push(dataDir)
    await mkdir(join(dataDir, 'threads', 'thread_1'), { recursive: true })
    await writeFile(join(dataDir, 'threads', 'thread_1', 'messages.jsonl'), 'x'.repeat(500))

    const records = new Map([['thread_1', makeThread()]])
    const modelCalls = { count: 0 }
    const pruneCalls = { count: 0 }
    const service = makeService({
      dataDir, records, modelClient: modelClient(modelCalls),
      memoryStore: makeMemoryStore({ count: 0 }, false), pruneCalls
    })

    const report = await service.runOnce()
    const jobStore = new ConsolidationJobStore({ dataDir, nowIso: () => NOW })
    await jobStore.ready()
    const [job] = await jobStore.list()

    expect(report.completed).toBe(0)
    expect(report.failures).toEqual([])
    expect(modelCalls.count).toBe(1)
    expect(pruneCalls.count).toBe(0)
    expect(job?.status).toBe('materialized')
    expect(job?.checkpoint).toBeUndefined()
    expect(job?.error).toBe('memory store lacks createWithId')
  })

  it('keeps a Tier-2 safe recovery copy until its TTL, then completes deletion', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-service-'))
    roots.push(dataDir)
    const threadDir = join(dataDir, 'threads', 'thread_1')
    await mkdir(threadDir, { recursive: true })
    await writeFile(join(threadDir, 'messages.jsonl'), 'x'.repeat(500))

    const records = new Map([['thread_1', makeThread()]])
    const clock = { now: NOW }
    const modelCalls = { count: 0 }
    const memoryCalls = { count: 0 }
    const pruneCalls = { count: 0 }
    const deleteCalls = { count: 0 }
    const releasedArtifactOwners: string[] = []
    const service = makeService({
      dataDir, records, modelClient: modelClient(modelCalls),
      memoryStore: makeMemoryStore(memoryCalls, true), pruneCalls,
      tier: 'tier-2', reclaimMode: 'safe', nowIso: () => clock.now,
      releasedArtifactOwners,
      deleteThread: async (threadId) => {
        deleteCalls.count += 1
        records.delete(threadId)
        await rm(join(dataDir, 'threads', threadId), { recursive: true, force: true })
      }
    })

    const first = await service.runOnce()
    const recovery = new ConsolidationRecoveryStore(dataDir)
    expect(first.completed).toBe(0)
    expect(first.pendingArchiveCleanup).toBe(1)
    expect(deleteCalls.count).toBe(1)
    expect(await recovery.list()).toHaveLength(1)

    clock.now = new Date(Date.parse(NOW) + 2_000).toISOString()
    const second = await service.runOnce()
    expect(second.completed).toBe(1)
    expect(await recovery.list()).toHaveLength(0)
    expect(deleteCalls.count).toBe(1)
    expect(pruneCalls.count).toBe(0)
    expect(releasedArtifactOwners).toEqual(['thread_1', 'turn_1'])
  })

  it('measures Tier-1 reclaim against the source bytes, excluding the in-thread snapshot', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-service-'))
    roots.push(dataDir)
    const threadDir = join(dataDir, 'threads', 'thread_1')
    await mkdir(threadDir, { recursive: true })
    await writeFile(join(threadDir, 'messages.jsonl'), 'x'.repeat(500))

    const records = new Map([['thread_1', makeThread()]])
    const clock = { now: NOW }
    const service = makeService({
      dataDir, records, modelClient: modelClient({ count: 0 }),
      memoryStore: makeMemoryStore({ count: 0 }, true), pruneCalls: { count: 0 },
      reclaimMode: 'safe', archiveTtlMs: 1_000, nowIso: () => clock.now
    })

    const first = await service.runOnce()
    expect(first.completed).toBe(0)
    expect(first.pendingArchiveCleanup).toBe(1)

    clock.now = new Date(Date.parse(NOW) + 2_000).toISOString()
    const second = await service.runOnce()
    const jobStore = new ConsolidationJobStore({ dataDir, nowIso: () => clock.now })
    await jobStore.ready()
    const [job] = await jobStore.list()
    expect(second.completed).toBe(1)
    expect(job?.measuredBytes?.reclaimed).toBe(500)
    expect(await new ThreadSnapshotStore({ dataDir, nowIso: () => clock.now }).list('thread_1')).toHaveLength(0)
  })
})
