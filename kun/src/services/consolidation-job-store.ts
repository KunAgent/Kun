import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  CONSOLIDATION_JOB_STORE_VERSION,
  CONSOLIDATION_PIPELINE_VERSION,
  ConsolidationJob,
  ConsolidationJobStoreState,
  deriveConsolidationInputHash,
  deriveConsolidationJobId,
  deriveConsolidationMemoryId,
  type ConsolidationJobCheckpoint,
  type ConsolidationJobMeasuredBytes,
  type ConsolidationJobStatus,
  type ConsolidationJobStoreState as ConsolidationJobStoreStateValue,
  type ConsolidationJob as ConsolidationJobValue,
  type ConsolidationReclaimMode,
  type ConsolidationReclaimTier
} from '../contracts/consolidation-job.js'

// A crash before this state is reached (extraction, no episode confirmed written)
// leaves no durable side effect, so it is the only status safe to force-fail on
// restart. Every later status already has a durable confirmation of its side
// effect (materialized/verified: createWithId succeeded, idempotent by input-derived
// id; pruning/deleting: a checkpoint is already persisted, per the transition guard
// below) and is left for a future stage to resume or retry.
//
// Reconciliation contract for pruning/deleting (deferred to the Tier-1/Tier-2
// execution stage that actually performs trim/delete, not implemented here):
// a job found in pruning or deleting on restart must be resumed using its
// already-persisted checkpoint as the sole source of truth (never re-derive or
// replace it), and the resumed trim/delete operation itself must be idempotent
// — re-trimming already-trimmed content and re-deleting an already-deleted/
// missing thread must both be safe no-ops — so re-attempting from this state
// is never a partial or duplicate mutation. This store does not decide when or
// whether to resume; a future coordinator does that by polling
// list({status: 'pruning'}) / list({status: 'deleting'}) on startup.
const RECOVERABLE_INTERRUPTED_STATUSES: readonly ConsolidationJobStatus[] = ['extracting']

// Local to this file: the session/consolidation layer must not depend on
// kun/src/memory/ internals, so this does not reuse memory-mutation-queue.ts.
//
// Single-writer scope: like memory-distillation-pending-store.ts's mutex, this
// only serializes writers within one process. It assumes exactly one process
// ever constructs a ConsolidationJobStore against a given dataDir (matching
// design.md's single bounded daily background task). If Kun's runtime ever
// needs this store driven from more than one OS process against the same
// dataDir, a Manager-RPC remote adapter (mirroring
// ManagerRemoteMemoryDistillationPendingStore) must be introduced first —
// this store must not be constructed directly from multiple processes.
const mutationQueues = new Map<string, Promise<void>>()

function withPathMutation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const resolved = resolve(path)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const run = (mutationQueues.get(key) ?? Promise.resolve()).then(operation, operation)
  const settled = run.then(() => undefined, () => undefined)
  mutationQueues.set(key, settled)
  void settled.then(() => { if (mutationQueues.get(key) === settled) mutationQueues.delete(key) })
  return run
}

export class ConsolidationJobStore {
  private state: ConsolidationJobStoreStateValue | undefined

  constructor(private readonly options: {
    dataDir: string
    nowIso?: () => string
  }) {}

  async ready(): Promise<void> {
    await this.withMutation(async () => {
      await this.load()
      await this.recoverInterruptedLocked()
    })
  }

  async ensureJob(input: {
    threadId: string
    cutoffRevision: string
    pipelineVersion?: string
    reclaimMode?: ConsolidationReclaimMode
    reclaimTier?: ConsolidationReclaimTier
  }): Promise<ConsolidationJobValue> {
    return this.withMutation(async () => {
      const pipelineVersion = input.pipelineVersion ?? CONSOLIDATION_PIPELINE_VERSION
      const id = deriveConsolidationJobId(input.threadId, input.cutoffRevision, pipelineVersion)
      const memoryId = deriveConsolidationMemoryId(input.threadId, input.cutoffRevision, pipelineVersion)
      const inputHash = deriveConsolidationInputHash(input.threadId, input.cutoffRevision, pipelineVersion)
      const state = copyState(await this.load())
      const existing = state.jobs[id]
      if (existing) {
        // The id is derived from exactly these three fields, so a mismatch here
        // can only mean a hash collision or on-disk corruption — never a normal
        // idempotent replay. Fail loudly rather than silently returning a job
        // that does not actually correspond to this call's inputs.
        if (
          existing.threadId !== input.threadId ||
          existing.cutoffRevision !== input.cutoffRevision ||
          existing.pipelineVersion !== pipelineVersion ||
          existing.inputHash !== inputHash
        ) {
          throw new Error(
            `consolidation job id collision for ${id}: stored job derives from ` +
            `(threadId=${existing.threadId}, cutoffRevision=${existing.cutoffRevision}, ` +
            `pipelineVersion=${existing.pipelineVersion}) but this call derives from ` +
            `(threadId=${input.threadId}, cutoffRevision=${input.cutoffRevision}, pipelineVersion=${pipelineVersion})`
          )
        }
        return existing
      }

      const createdAt = this.now()
      const job = ConsolidationJob.parse({
        schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
        id,
        threadId: input.threadId,
        cutoffRevision: input.cutoffRevision,
        pipelineVersion,
        inputHash,
        memoryIds: [memoryId],
        status: 'eligible',
        ...(input.reclaimMode ? { reclaimMode: input.reclaimMode } : {}),
        ...(input.reclaimTier ? { reclaimTier: input.reclaimTier } : {}),
        retryCount: 0,
        history: [{ status: 'eligible', at: createdAt }],
        createdAt,
        updatedAt: createdAt
      })
      state.jobs[id] = job
      await this.persist(state)
      return job
    })
  }

  async get(jobId: string): Promise<ConsolidationJobValue | null> {
    return this.withMutation(async () => {
      const state = await this.load()
      return state.jobs[jobId] ?? null
    })
  }

  async list(filter: { status?: ConsolidationJobStatus } = {}): Promise<ConsolidationJobValue[]> {
    return this.withMutation(async () => {
      const state = await this.load()
      return Object.values(state.jobs)
        .filter((job) => !filter.status || job.status === filter.status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id))
    })
  }

  async transition(
    jobId: string,
    from: readonly ConsolidationJobStatus[],
    to: ConsolidationJobStatus,
    patch: {
      reason?: string
      error?: string
      measuredBytes?: ConsolidationJobMeasuredBytes
    } = {}
  ): Promise<ConsolidationJobValue> {
    return this.withMutation(async () => {
      const state = copyState(await this.load())
      const current = state.jobs[jobId]
      if (!current) throw new Error(`consolidation job not found: ${jobId}`)
      if (!from.includes(current.status)) {
        throw new Error(
          `consolidation job ${jobId} is ${current.status}, expected one of [${from.join(', ')}]`
        )
      }
      if ((to === 'pruning' || to === 'deleting') && !current.checkpoint) {
        throw new Error(
          `consolidation job ${jobId} cannot transition to ${to} without a persisted checkpoint`
        )
      }
      const at = this.now()
      const next = ConsolidationJob.parse({
        ...current,
        status: to,
        ...(patch.error ? { error: patch.error.slice(0, 512) } : {}),
        ...(to === 'failed' ? { retryCount: current.retryCount + 1 } : {}),
        ...(patch.measuredBytes ? { measuredBytes: { ...current.measuredBytes, ...patch.measuredBytes } } : {}),
        history: [...current.history, {
          status: to,
          at,
          ...(patch.reason ? { reason: patch.reason.slice(0, 512) } : {})
        }],
        updatedAt: at
      })
      state.jobs[jobId] = next
      await this.persist(state)
      return next
    })
  }

  async persistCheckpoint(
    jobId: string,
    checkpoint: { memoryIds: string[]; cutoffRevision: string }
  ): Promise<ConsolidationJobValue> {
    return this.withMutation(async () => {
      const state = copyState(await this.load())
      const current = state.jobs[jobId]
      if (!current) throw new Error(`consolidation job not found: ${jobId}`)
      const at = this.now()
      const persisted: ConsolidationJobCheckpoint = {
        memoryIds: checkpoint.memoryIds,
        cutoffRevision: checkpoint.cutoffRevision,
        persistedAt: at
      }
      const next = ConsolidationJob.parse({
        ...current,
        checkpoint: persisted,
        updatedAt: at
      })
      state.jobs[jobId] = next
      await this.persist(state)
      return next
    })
  }

  // Explicit retry entry point for a failed job: transitions failed -> eligible
  // so a coordinator can re-run the pipeline from scratch. Deliberately not
  // folded into ensureJob — ensureJob's idempotent return-existing behavior
  // must never silently re-arm a failed job (that would hide failures behind
  // an unrelated call), so retry is only ever explicit. retryCount is carried
  // over unchanged; it only increments when a job enters `failed`, not when it
  // leaves it, so it reflects the total number of failures across all retries.
  async retryFailedJob(jobId: string, patch: { reason?: string } = {}): Promise<ConsolidationJobValue> {
    return this.transition(jobId, ['failed'], 'eligible', { reason: patch.reason ?? 'retry' })
  }

  private async recoverInterruptedLocked(): Promise<void> {
    const current = await this.load()
    const stuck = Object.values(current.jobs)
      .filter((job) => RECOVERABLE_INTERRUPTED_STATUSES.includes(job.status))
    if (stuck.length === 0) return
    const state = copyState(current)
    const at = this.now()
    for (const job of stuck) {
      state.jobs[job.id] = ConsolidationJob.parse({
        ...job,
        status: 'failed',
        error: 'interrupted',
        retryCount: job.retryCount + 1,
        history: [...job.history, { status: 'failed', at, reason: 'interrupted' }],
        updatedAt: at
      })
    }
    await this.persist(state)
  }

  private async load(): Promise<ConsolidationJobStoreStateValue> {
    if (this.state) return this.state
    try {
      const text = await readFile(this.path(), 'utf8')
      this.state = ConsolidationJobStoreState.parse(JSON.parse(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = ConsolidationJobStoreState.parse({
        schemaVersion: CONSOLIDATION_JOB_STORE_VERSION,
        jobs: {}
      })
    }
    return this.state
  }

  private async persist(state: ConsolidationJobStoreStateValue): Promise<void> {
    const parsed = ConsolidationJobStoreState.parse(state)
    const contents = `${JSON.stringify(parsed, null, 2)}\n`
    await atomicWriteFile(this.path(), contents, {
      durable: true,
      allowDirectWriteFallback: false
    })
    this.state = parsed
  }

  private path(): string {
    return join(this.options.dataDir, 'consolidation-jobs', 'state.json')
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withPathMutation(this.path(), async () => {
      // Another instance in this process may have committed since our last read.
      this.state = undefined
      return operation()
    })
  }
}

function copyState(state: ConsolidationJobStoreStateValue): ConsolidationJobStoreStateValue {
  return ConsolidationJobStoreState.parse(structuredClone(state))
}

export type ConsolidationJobStorePort = Pick<ConsolidationJobStore,
  'ready' | 'ensureJob' | 'get' | 'list' | 'transition' | 'persistCheckpoint' | 'retryFailedJob'>
