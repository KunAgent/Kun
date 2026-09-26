import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { ThreadStore, ThreadStoreConditionalWrite, ThreadStoreListPage } from '../ports/thread-store.js'
import { deriveConsolidationJobId } from '../contracts/consolidation-job.js'
import { ConsolidationJobStore } from './consolidation-job-store.js'
import { SessionConsolidationCandidateScheduler } from './session-consolidation-candidate-scheduler.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NOW = '2026-09-18T00:00:00.000Z'
const DAY = 86_400_000
const IDLE_AFTER_MS = 30 * DAY
const MIN_BYTES = 200

function agoIso(ms: number): string {
  return new Date(Date.parse(NOW) - ms).toISOString()
}

function makeTurn(overrides: Partial<Turn> & { id: string; status: Turn['status'] }): Turn {
  return {
    threadId: 'thread', prompt: 'p', orchestration: 'direct', steering: [],
    createdAt: NOW, items: [], attachmentIds: [], activeSkillIds: [],
    injectedMemoryIds: [], injectedMemorySummaries: [], injectedDirectiveIds: [],
    injectedDirectiveSummaries: [], injectedInstructionSources: [],
    ...overrides
  }
}

function makeThread(overrides: Partial<ThreadRecord> & { id: string }): ThreadRecord {
  return {
    title: 'T', workspace: '/', model: 'model', mode: 'agent', status: 'archived',
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user',
    relation: 'primary', createdAt: NOW, updatedAt: NOW, turns: [],
    ...overrides
  }
}

class FakeThreadStore implements Pick<ThreadStore,
  'list' | 'listPage' | 'get' | 'getMetadata' | 'upsert' | 'delete' | 'touch' | 'upsertIfRevision' | 'deleteByWorkspace'> {
  constructor(private readonly records: Map<string, ThreadRecord>) {}

  async list(): Promise<ThreadSummary[]> {
    return [...this.records.keys()].map((id) => ({ id }) as unknown as ThreadSummary)
  }
  async listPage(): Promise<ThreadStoreListPage> {
    throw new Error('unexpected call: listPage')
  }
  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.records.get(threadId) ?? null
  }
  async getMetadata(threadId: string): Promise<ThreadRecord | null> {
    return this.records.get(threadId) ?? null
  }
  async upsert(): Promise<ThreadRecord> { throw new Error('unexpected mutation: upsert') }
  async delete(): Promise<boolean> { throw new Error('unexpected mutation: delete') }
  async touch(): Promise<boolean> { throw new Error('unexpected mutation: touch') }
  async upsertIfRevision(): Promise<ThreadStoreConditionalWrite> { throw new Error('unexpected mutation: upsertIfRevision') }
  async deleteByWorkspace(): Promise<string[]> { throw new Error('unexpected mutation: deleteByWorkspace') }
}

async function writeThreadDir(root: string, threadId: string, bytes: number): Promise<void> {
  const dir = join(root, 'threads', threadId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'messages.jsonl'), 'x'.repeat(bytes))
}

describe('SessionConsolidationCandidateScheduler', () => {
  it('schedules only eligible threads into the job store, passes through exclusions, and mutates no thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-scheduler-'))
    roots.push(dataDir)

    const oldFinishedAt = agoIso(40 * DAY)
    const threads = new Map<string, ThreadRecord>()

    threads.set('thread_candidate_revisioned', makeThread({
      id: 'thread_candidate_revisioned', revision: 3,
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))
    threads.set('thread_candidate_unrevisioned', makeThread({
      id: 'thread_candidate_unrevisioned',
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))
    threads.set('thread_pinned', makeThread({
      id: 'thread_pinned', pinned: true,
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))

    await writeThreadDir(dataDir, 'thread_candidate_revisioned', 500)
    await writeThreadDir(dataDir, 'thread_candidate_unrevisioned', 500)
    await writeThreadDir(dataDir, 'thread_pinned', 500)

    const threadStore = new FakeThreadStore(threads)
    const jobStore = new ConsolidationJobStore({ dataDir, nowIso: () => NOW })
    await jobStore.ready()

    const scheduler = new SessionConsolidationCandidateScheduler({
      threadStore, jobStore, dataDir, nowIso: () => NOW,
      idleAfterMs: IDLE_AFTER_MS, minBytes: MIN_BYTES
    })

    const report = await scheduler.run()

    expect(report.scheduled.map((entry) => entry.threadId).sort()).toEqual(
      ['thread_candidate_revisioned', 'thread_candidate_unrevisioned'].sort()
    )
    expect(report.excluded.map((entry) => entry.threadId)).toEqual(['thread_pinned'])

    const revisioned = report.scheduled.find((entry) => entry.threadId === 'thread_candidate_revisioned')
    expect(revisioned?.cutoffRevision).toBe('3')
    expect(revisioned?.status).toBe('eligible')
    expect(revisioned?.jobId).toBe(deriveConsolidationJobId('thread_candidate_revisioned', '3', 'v1'))

    const unrevisioned = report.scheduled.find((entry) => entry.threadId === 'thread_candidate_unrevisioned')
    expect(unrevisioned?.cutoffRevision).toBe('0')
    expect(unrevisioned?.jobId).toBe(deriveConsolidationJobId('thread_candidate_unrevisioned', '0', 'v1'))

    const jobs = await jobStore.list()
    expect(jobs).toHaveLength(2)

    const pinnedJobId = deriveConsolidationJobId('thread_pinned', '0', 'v1')
    expect(await jobStore.get(pinnedJobId)).toBeNull()
  })

  it('re-running with an unchanged revision is idempotent; a revision bump derives a new job and leaves the old one', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-consolidation-scheduler-'))
    roots.push(dataDir)

    const oldFinishedAt = agoIso(40 * DAY)
    const threads = new Map<string, ThreadRecord>()
    threads.set('thread_1', makeThread({
      id: 'thread_1', revision: 1,
      turns: [makeTurn({ id: 'turn_1', status: 'completed', finishedAt: oldFinishedAt })]
    }))
    await writeThreadDir(dataDir, 'thread_1', 500)

    const threadStore = new FakeThreadStore(threads)
    const jobStore = new ConsolidationJobStore({ dataDir, nowIso: () => NOW })
    await jobStore.ready()
    const scheduler = new SessionConsolidationCandidateScheduler({
      threadStore, jobStore, dataDir, nowIso: () => NOW,
      idleAfterMs: IDLE_AFTER_MS, minBytes: MIN_BYTES
    })

    const first = await scheduler.run()
    const second = await scheduler.run()
    expect(second.scheduled[0]?.jobId).toBe(first.scheduled[0]?.jobId)
    expect(await jobStore.list()).toHaveLength(1)

    threads.set('thread_1', { ...threads.get('thread_1')!, revision: 2 })
    const third = await scheduler.run()
    expect(third.scheduled[0]?.jobId).not.toBe(first.scheduled[0]?.jobId)

    const allJobs = await jobStore.list()
    expect(allJobs).toHaveLength(2)
    expect(allJobs.map((job) => job.status)).toEqual(['eligible', 'eligible'])
  })
})
