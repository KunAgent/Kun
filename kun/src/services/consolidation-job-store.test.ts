import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONSOLIDATION_JOB_STORE_VERSION,
  deriveConsolidationInputHash,
  deriveConsolidationJobId,
  deriveConsolidationMemoryId
} from '../contracts/consolidation-job.js'
import { ConsolidationJobStore } from './consolidation-job-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-consolidation-job-store-'))
  roots.push(root)
  return root
}

describe('consolidation job id derivation', () => {
  it('is deterministic for identical inputs and differs across inputs', () => {
    const jobA = deriveConsolidationJobId('thread_1', 'rev_1', 'v1')
    const jobA2 = deriveConsolidationJobId('thread_1', 'rev_1', 'v1')
    const jobDifferentThread = deriveConsolidationJobId('thread_2', 'rev_1', 'v1')
    const jobDifferentRevision = deriveConsolidationJobId('thread_1', 'rev_2', 'v1')
    const jobDifferentPipeline = deriveConsolidationJobId('thread_1', 'rev_1', 'v2')

    expect(jobA).toBe(jobA2)
    expect(jobA).not.toBe(jobDifferentThread)
    expect(jobA).not.toBe(jobDifferentRevision)
    expect(jobA).not.toBe(jobDifferentPipeline)
  })

  it('derives a distinct memory id from the same inputs as the job id', () => {
    const jobId = deriveConsolidationJobId('thread_1', 'rev_1', 'v1')
    const memoryId = deriveConsolidationMemoryId('thread_1', 'rev_1', 'v1')
    const inputHash = deriveConsolidationInputHash('thread_1', 'rev_1', 'v1')

    expect(jobId).not.toBe(memoryId)
    expect(jobId).toMatch(/^cj_[a-f0-9]{24}$/)
    expect(memoryId).toMatch(/^mem_[a-f0-9]{24}$/)
    expect(inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(deriveConsolidationInputHash('thread_1', 'rev_1', 'v1')).toBe(inputHash)
  })
})

describe('ConsolidationJobStore', () => {
  it('ensureJob is idempotent for identical inputs and distinct across cutoffRevision', async () => {
    const dataDir = await newRoot()
    const store = new ConsolidationJobStore({ dataDir, nowIso: () => '2026-09-18T00:00:00.000Z' })
    await store.ready()

    const first = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    const second = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    const third = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_2' })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(third.id).not.toBe(first.id)

    const listed = await store.list()
    expect(listed.map((job) => job.id).sort()).toEqual([first.id, third.id].sort())
    expect(first.status).toBe('eligible')
    expect(first.memoryIds).toEqual([deriveConsolidationMemoryId('thread_1', 'rev_1', 'v1')])
    expect(first.schemaVersion).toBe(CONSOLIDATION_JOB_STORE_VERSION)
  })

  it('transition rejects an invalid from-state and leaves the record unchanged', async () => {
    const dataDir = await newRoot()
    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()
    const job = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })

    await expect(store.transition(job.id, ['verified'], 'pruning')).rejects.toThrow(
      /is eligible, expected one of \[verified\]/
    )

    const unchanged = await store.get(job.id)
    expect(unchanged?.status).toBe('eligible')
    expect(unchanged?.history).toHaveLength(1)
  })

  it('blocks pruning/deleting transitions until a checkpoint is persisted, then allows them', async () => {
    const dataDir = await newRoot()
    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()
    const job = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })

    await store.transition(job.id, ['eligible'], 'extracting')
    await store.transition(job.id, ['extracting'], 'materialized')

    await expect(store.transition(job.id, ['materialized'], 'pruning')).rejects.toThrow(
      /cannot transition to pruning without a persisted checkpoint/
    )

    const withCheckpoint = await store.persistCheckpoint(job.id, {
      memoryIds: job.memoryIds,
      cutoffRevision: job.cutoffRevision
    })
    expect(withCheckpoint.checkpoint?.memoryIds).toEqual(job.memoryIds)

    const verified = await store.transition(job.id, ['materialized'], 'verified')
    expect(verified.status).toBe('verified')

    const pruning = await store.transition(verified.id, ['verified'], 'pruning')
    expect(pruning.status).toBe('pruning')
    expect(pruning.checkpoint).toBeDefined()
  })

  it('persists state across store instances on the same dataDir', async () => {
    const dataDir = await newRoot()
    const storeA = new ConsolidationJobStore({ dataDir })
    await storeA.ready()
    const job = await storeA.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    await storeA.transition(job.id, ['eligible'], 'extracting')
    await storeA.transition(job.id, ['extracting'], 'materialized')
    await storeA.persistCheckpoint(job.id, { memoryIds: job.memoryIds, cutoffRevision: job.cutoffRevision })

    const storeB = new ConsolidationJobStore({ dataDir })
    await storeB.ready()
    const reloaded = await storeB.get(job.id)

    expect(reloaded?.status).toBe('materialized')
    expect(reloaded?.checkpoint?.cutoffRevision).toBe('rev_1')
    expect(reloaded?.history.map((entry) => entry.status)).toEqual(['eligible', 'extracting', 'materialized'])

    const onDisk = JSON.parse(await readFile(join(dataDir, 'consolidation-jobs', 'state.json'), 'utf8'))
    expect(onDisk.jobs[job.id].status).toBe('materialized')
  })

  it('force-fails a job stuck in extracting on restart, but leaves a checkpointed pruning job alone', async () => {
    const dataDir = await newRoot()
    const stateDir = join(dataDir, 'consolidation-jobs')
    await mkdir(stateDir, { recursive: true })

    const now = '2026-09-18T00:00:00.000Z'
    const stuckExtracting = {
      schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
      id: 'cj_stuck_extracting',
      threadId: 'thread_a',
      cutoffRevision: 'rev_1',
      pipelineVersion: 'v1',
      inputHash: deriveConsolidationInputHash('thread_a', 'rev_1', 'v1'),
      memoryIds: [deriveConsolidationMemoryId('thread_a', 'rev_1', 'v1')],
      status: 'extracting',
      retryCount: 0,
      history: [{ status: 'eligible', at: now }, { status: 'extracting', at: now }],
      createdAt: now,
      updatedAt: now
    }
    const stuckPruning = {
      ...stuckExtracting,
      id: 'cj_stuck_pruning',
      threadId: 'thread_b',
      inputHash: deriveConsolidationInputHash('thread_b', 'rev_1', 'v1'),
      memoryIds: [deriveConsolidationMemoryId('thread_b', 'rev_1', 'v1')],
      status: 'pruning',
      checkpoint: { memoryIds: [deriveConsolidationMemoryId('thread_b', 'rev_1', 'v1')], cutoffRevision: 'rev_1', persistedAt: now },
      history: [
        { status: 'eligible', at: now }, { status: 'extracting', at: now },
        { status: 'materialized', at: now }, { status: 'verified', at: now }, { status: 'pruning', at: now }
      ]
    }

    await writeFile(join(stateDir, 'state.json'), JSON.stringify({
      schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
      jobs: { [stuckExtracting.id]: stuckExtracting, [stuckPruning.id]: stuckPruning }
    }, null, 2))

    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()

    const recoveredExtracting = await store.get('cj_stuck_extracting')
    expect(recoveredExtracting?.status).toBe('failed')
    expect(recoveredExtracting?.error).toBe('interrupted')
    expect(recoveredExtracting?.retryCount).toBe(1)
    expect(recoveredExtracting?.history.at(-1)?.reason).toBe('interrupted')

    const leftAlonePruning = await store.get('cj_stuck_pruning')
    expect(leftAlonePruning?.status).toBe('pruning')
    expect(leftAlonePruning?.retryCount).toBe(0)
  })

  it('raises a conflict error if a stored job under the derived id does not match the request', async () => {
    const dataDir = await newRoot()
    const stateDir = join(dataDir, 'consolidation-jobs')
    await mkdir(stateDir, { recursive: true })

    const now = '2026-09-18T00:00:00.000Z'
    const id = deriveConsolidationJobId('thread_1', 'rev_1', 'v1')
    const mismatched = {
      schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
      id,
      threadId: 'thread_9',
      cutoffRevision: 'rev_1',
      pipelineVersion: 'v1',
      inputHash: deriveConsolidationInputHash('thread_9', 'rev_1', 'v1'),
      memoryIds: [deriveConsolidationMemoryId('thread_9', 'rev_1', 'v1')],
      status: 'eligible',
      retryCount: 0,
      history: [{ status: 'eligible', at: now }],
      createdAt: now,
      updatedAt: now
    }
    await writeFile(join(stateDir, 'state.json'), JSON.stringify({
      schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
      jobs: { [id]: mismatched }
    }, null, 2))

    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()

    await expect(store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })).rejects.toThrow(
      /consolidation job id collision/
    )
  })

  it('runs concurrent ensureJob calls for the same input without creating duplicate jobs', async () => {
    const dataDir = await newRoot()
    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()

    const [first, second] = await Promise.all([
      store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' }),
      store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    ])

    expect(first.id).toBe(second.id)
    const all = await store.list()
    expect(all).toHaveLength(1)
  })

  it('provides an explicit retry entry point for failed jobs, and ensureJob never re-arms one implicitly', async () => {
    const dataDir = await newRoot()
    const store = new ConsolidationJobStore({ dataDir })
    await store.ready()
    const job = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })

    await store.transition(job.id, ['eligible'], 'extracting')
    const failed = await store.transition(job.id, ['extracting'], 'failed', { error: 'boom' })
    expect(failed.status).toBe('failed')
    expect(failed.retryCount).toBe(1)

    // ensureJob must not silently skip retry, but it also must not auto-retry:
    // calling it again on a failed job returns the failed record unchanged.
    const stillFailed = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    expect(stillFailed.status).toBe('failed')
    expect(stillFailed.id).toBe(job.id)

    const retried = await store.retryFailedJob(job.id)
    expect(retried.status).toBe('eligible')
    expect(retried.retryCount).toBe(1)

    const again = await store.ensureJob({ threadId: 'thread_1', cutoffRevision: 'rev_1' })
    expect(again.id).toBe(job.id)
    expect(again.status).toBe('eligible')

    const all = await store.list()
    expect(all).toHaveLength(1)
  })
})
