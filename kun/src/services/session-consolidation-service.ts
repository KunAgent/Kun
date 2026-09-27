import type { ThreadRecord } from '../contracts/threads.js'
import { join } from 'node:path'
import type { MemoryCreateRequest, MemoryRecord } from '../contracts/memory.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ThreadService } from './thread-service.js'
import type { TurnService } from './turn-service-core.js'
import type { RolesConfig } from '../config/kun-config.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { ThreadSnapshotStore } from './thread-snapshot-store.js'
import { resolveRoleModel } from '../loop/title-generator.js'
import {
  type ConsolidationJob,
  type ConsolidationReclaimMode,
  type ConsolidationReclaimTier
} from '../contracts/consolidation-job.js'
import type { ConsolidationJobStorePort } from './consolidation-job-store.js'
import { SessionConsolidationCandidateScheduler } from './session-consolidation-candidate-scheduler.js'
import { SessionConsolidationPreviewService } from './session-consolidation-preview.js'
import type { ConsolidationExclusionReason } from './session-consolidation-preview.js'
import { computeDirectoryByteSize } from './fs-directory-size.js'
import { buildConsolidationEpisode } from './session-consolidation-episode.js'
import { ConsolidationRecoveryStore } from './consolidation-recovery-store.js'
import { consolidationMemoryHash, verifyConsolidationEvidence } from './session-consolidation-evidence.js'

export type SessionConsolidationConfig = {
  enabled: boolean
  tier: ConsolidationReclaimTier
  reclaimMode: ConsolidationReclaimMode
  idleAfterMs: number
  minBytes: number
  archiveTtlMs: number
  maxThreadsPerRun: number
  summaryInputMaxBytes: number
  summaryMaxTokens: number
}

export type SessionConsolidationRunReport = {
  enabled: boolean
  scheduled: number
  processed: number
  completed: number
  episodesWritten: number
  durableCandidatesQueued: number
  bytesReclaimed: number
  skippedByReason: Partial<Record<ConsolidationExclusionReason, number>>
  pendingArchiveCleanup: number
  failures: Array<{ jobId: string; threadId: string; error: string }>
}

type RunCounters = {
  episodesWritten: number
  durableCandidatesQueued: number
}

type ThreadRetentionPort = Pick<TurnService, 'pruneThread'>

/** Narrow public memory capability consumed by the session layer. */
type ConsolidationMemoryStore = {
  createWithId?: (id: string, input: MemoryCreateRequest) => Promise<MemoryRecord>
  getById?: (id: string) => Promise<MemoryRecord>
  list: (filter?: { all?: boolean }) => Promise<MemoryRecord[]>
}

export class SessionConsolidationService {
  private readonly recovery: ConsolidationRecoveryStore
  private activeRun: Promise<SessionConsolidationRunReport> | undefined
  private stopped = false

  constructor(private readonly options: {
    config: () => SessionConsolidationConfig
    dataDir: string
    threadStore: Pick<ThreadStore, 'list' | 'get' | 'getMetadata'>
    sessionStore: SessionStore
    threadService: Pick<ThreadService, 'delete'>
    turnService: ThreadRetentionPort
    snapshots: ThreadSnapshotStore
    jobStore: ConsolidationJobStorePort
    memoryStore: () => ConsolidationMemoryStore | undefined
    modelClient?: ModelClient
    defaultModel?: () => string | undefined
    roles?: () => RolesConfig | undefined
    immutablePrefix?: () => ImmutablePrefix | undefined
    nowIso?: () => string
    hasPendingInteractions?: (threadId: string) => boolean
    /** Existing per-turn distillation queue; never gates episode deletion. */
    queueDurableCandidates?: (threadId: string, turnId: string) => void
    /** Releases only linked artifact owners after Tier-2 deletion is final. */
    artifactStore?: Pick<ArtifactStore, 'releaseOwner'>
  }) {
    this.recovery = new ConsolidationRecoveryStore(options.dataDir)
  }

  async preview() {
    const config = this.options.config()
    const preview = new SessionConsolidationPreviewService({
      threadStore: this.options.threadStore,
      dataDir: this.options.dataDir,
      nowIso: () => this.now(),
      idleAfterMs: config.idleAfterMs,
      minBytes: config.minBytes
    })
    return preview.run()
  }

  async runOnce(): Promise<SessionConsolidationRunReport> {
    if (this.activeRun) return this.activeRun
    const run = this.runOnceInternal()
    this.activeRun = run
    try {
      return await run
    } finally {
      if (this.activeRun === run) this.activeRun = undefined
    }
  }

  stop(): void {
    this.stopped = true
  }

  private async runOnceInternal(): Promise<SessionConsolidationRunReport> {
    const config = this.options.config()
    if (!config.enabled || this.stopped) {
      return {
        enabled: false, scheduled: 0, processed: 0, completed: 0,
        episodesWritten: 0, durableCandidatesQueued: 0, bytesReclaimed: 0,
        skippedByReason: {}, pendingArchiveCleanup: 0, failures: []
      }
    }
    await this.options.jobStore.ready()
    const selection = await this.scheduler().run()
    const jobs = (await this.options.jobStore.list())
      .filter((job) => ['eligible', 'materialized', 'verified', 'pruning', 'deleting'].includes(job.status))
      .slice(0, config.maxThreadsPerRun)
    const failures: SessionConsolidationRunReport['failures'] = []
    const counters: RunCounters = { episodesWritten: 0, durableCandidatesQueued: 0 }
    let completed = 0
    for (const job of jobs) {
      if (this.stopped) break
      try {
        const result = await this.process(job, counters)
        if (result === 'completed') completed += 1
      } catch (error) {
        const message = safeError(error)
        failures.push({ jobId: job.id, threadId: job.threadId, error: message })
        await this.fail(job.id, message).catch(() => undefined)
      }
    }
    let bytesReclaimed = 0
    for (const job of jobs) {
      if (job.status === 'completed') continue
      const current = await this.options.jobStore.get(job.id)
      if (current?.status === 'completed') bytesReclaimed += current.measuredBytes?.reclaimed ?? 0
    }
    const skippedByReason: SessionConsolidationRunReport['skippedByReason'] = {}
    for (const entry of selection.excluded) {
      skippedByReason[entry.reason] = (skippedByReason[entry.reason] ?? 0) + 1
    }
    const pendingArchiveCleanup = (await this.options.jobStore.list())
      .filter((job) => ['pruning', 'deleting'].includes(job.status) && job.archiveExpiresAt).length
    return {
      enabled: true,
      scheduled: selection.scheduled.length,
      processed: jobs.length,
      completed,
      episodesWritten: counters.episodesWritten,
      durableCandidatesQueued: counters.durableCandidatesQueued,
      bytesReclaimed,
      skippedByReason,
      pendingArchiveCleanup,
      failures
    }
  }

  private scheduler(): SessionConsolidationCandidateScheduler {
    const config = this.options.config()
    return new SessionConsolidationCandidateScheduler({
      threadStore: this.options.threadStore,
      jobStore: this.options.jobStore,
      dataDir: this.options.dataDir,
      nowIso: () => this.now(),
      idleAfterMs: config.idleAfterMs,
      minBytes: config.minBytes,
      reclaimMode: config.reclaimMode,
      reclaimTier: config.tier,
      policy: {
        archiveTtlMs: config.archiveTtlMs,
        summaryInputMaxBytes: config.summaryInputMaxBytes,
        summaryMaxTokens: config.summaryMaxTokens
      }
    })
  }

  private async process(job: ConsolidationJob, counters?: RunCounters): Promise<'completed' | 'pending'> {
    this.assertRunning()
    this.policy(job)
    if (job.status === 'eligible') return this.extract(job, counters)
    if (job.status === 'materialized') {
      let current = job
      if (job.error) {
        if (!this.options.memoryStore()?.createWithId) return 'pending'
        current = await this.options.jobStore.transition(job.id, ['materialized'], 'materialized', {
          clearError: true,
          reason: 'memory store capability is available again'
        })
      }
      return this.prepareVerified(current)
    }
    if (job.status === 'verified') return this.reclaim(job)
    if (job.status === 'pruning' || job.status === 'deleting') return this.reclaim(job)
    return 'pending'
  }

  private async extract(job: ConsolidationJob, counters?: RunCounters): Promise<'completed' | 'pending'> {
    const thread = await this.currentThread(job)
    await this.assertEligibleForMutation(thread, job)
    if (!this.options.modelClient) throw new Error('session consolidation model client is unavailable')
    const resolved = resolveRoleModel({
      roles: this.options.roles?.(),
      mainModel: thread.model ?? this.options.defaultModel?.(),
      mainProviderId: thread.providerId,
      mainAccountId: thread.accountId
    })
    if (!resolved) throw new Error('no model is configured for session consolidation')
    let current = await this.options.jobStore.transition(job.id, ['eligible'], 'extracting')
    const snapshot = await this.options.sessionStore.loadItemSnapshot(thread.id)
    const now = this.now()
    const episode = await buildConsolidationEpisode({
      thread,
      items: snapshot.items,
      cutoffRevision: current.cutoffRevision,
      modelClient: this.options.modelClient,
      model: resolved.model,
      ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
      ...(resolved.accountId ? { accountId: resolved.accountId } : {}),
      ...(this.options.immutablePrefix?.()?.systemPrompt
        ? { systemPrompt: this.options.immutablePrefix()!.systemPrompt }
        : {}),
      ...(this.options.roles?.()?.summaryReasoningEffort
        ? { reasoningEffort: this.options.roles()!.summaryReasoningEffort }
        : {}),
      inputMaxBytes: this.policy(job).summaryInputMaxBytes,
      maxTokens: this.policy(job).summaryMaxTokens,
      nowIso: now
    })
    if ('blocked' in episode) throw new Error(`episode ${episode.blocked}${'reason' in episode ? `: ${episode.reason}` : ''}`)
    const memoryStore = this.options.memoryStore()
    if (!memoryStore?.createWithId) {
      await this.options.jobStore.transition(current.id, ['extracting'], 'materialized', {
        reason: 'memory store lacks createWithId',
        error: 'memory store lacks createWithId'
      })
      return 'pending'
    }
    await memoryStore.createWithId(current.memoryIds[0]!, episode.input)
    const persistedMemory = await this.readMemory(current.memoryIds[0]!)
    verifyConsolidationEvidence(current, persistedMemory)
    if (persistedMemory.sources.find((source) => source.threadId === current.threadId)?.contentHash !== episode.contentHash) {
      throw new Error('existing episode evidence differs from extraction input')
    }
    if (counters) counters.episodesWritten += 1
    const durableTurnId = completedCutoff(thread)
    if (durableTurnId) {
      try {
        this.options.queueDurableCandidates?.(thread.id, durableTurnId)
        if (counters && this.options.queueDurableCandidates) counters.durableCandidatesQueued += 1
      } catch {
        // Durable-fact approval is deliberately best effort and never blocks
        // the reference episode checkpoint or the storage-reclamation gate.
      }
    }
    current = await this.options.jobStore.transition(current.id, ['extracting'], 'materialized')
    current = await this.options.jobStore.persistCheckpoint(current.id, {
      memoryIds: current.memoryIds,
      cutoffRevision: current.cutoffRevision,
      itemRevision: snapshot.revision,
      memoryHash: consolidationMemoryHash(persistedMemory)
    })
    return this.prepareVerified(current)
  }

  private async prepareVerified(job: ConsolidationJob): Promise<'completed' | 'pending'> {
    const checkpoint = job.checkpoint
    if (!checkpoint) throw new Error('consolidation checkpoint is missing')
    const policy = this.policy(job)
    let current = job
    if (job.reclaimMode === 'safe' && !current.recoverySnapshotId) {
      const thread = await this.currentThread(current)
      // Tier-1 snapshots live inside the thread directory. Capture the
      // source size before creating that snapshot so the later delta cannot
      // count the recovery copy as reclaimed payload.
      const baselineBytes = job.reclaimTier === 'tier-1'
        ? await computeDirectoryByteSize(this.threadPath(thread.id))
        : undefined
      if (job.reclaimTier === 'tier-1') {
        const itemSnapshot = await this.options.sessionStore.loadItemSnapshot(thread.id)
        const manifest = await this.options.snapshots.capture({
          threadId: thread.id,
          reason: 'scheduled',
          threadRevision: thread.revision ?? 0,
          itemRevision: itemSnapshot.revision,
          eventHighWaterSeq: await this.options.sessionStore.highestSeq(thread.id)
        })
        current = await this.options.jobStore.transition(current.id, ['materialized'], 'materialized', {
          recoverySnapshotId: manifest.snapshotId,
          archiveExpiresAt: new Date(Date.parse(this.now()) + policy.archiveTtlMs).toISOString(),
          ...(baselineBytes === undefined ? {} : { measuredBytes: { before: baselineBytes } })
        })
      } else {
        await this.recovery.capture({ jobId: current.id, threadId: thread.id })
        current = await this.options.jobStore.transition(current.id, ['materialized'], 'materialized', {
          recoverySnapshotId: current.id,
          archiveExpiresAt: new Date(Date.parse(this.now()) + policy.archiveTtlMs).toISOString()
        })
      }
    }
    await this.verify(current)
    current = await this.options.jobStore.transition(current.id, ['materialized'], 'verified')
    return this.reclaim(current)
  }

  private async verify(job: ConsolidationJob): Promise<void> {
    const thread = await this.currentThread(job)
    await this.assertEligibleForMutation(thread, job)
    const snapshot = await this.options.sessionStore.loadItemSnapshot(thread.id)
    if (job.checkpoint?.itemRevision !== undefined && snapshot.revision !== job.checkpoint.itemRevision) {
      throw new Error('session item revision changed during consolidation')
    }
    await this.verifyMemory(job)
    await this.verifyRecovery(job)
  }

  private async verifyMemory(job: ConsolidationJob): Promise<void> {
    if (!job.checkpoint || job.checkpoint.cutoffRevision !== job.cutoffRevision ||
      JSON.stringify(job.checkpoint.memoryIds) !== JSON.stringify(job.memoryIds)) {
      throw new Error('consolidation checkpoint is missing or mismatched')
    }
    verifyConsolidationEvidence(job, await this.readMemory(job.memoryIds[0]!))
  }

  private async verifyRecovery(job: ConsolidationJob): Promise<void> {
    if (job.reclaimMode === 'safe') {
      if (!job.recoverySnapshotId) throw new Error('recovery archive is missing')
      if (!job.archiveExpiresAt) throw new Error('recovery archive expiry is missing')
      const valid = job.reclaimTier === 'tier-1'
        ? await this.options.snapshots.verify(job.threadId, job.recoverySnapshotId)
        : await this.recovery.verify(job.recoverySnapshotId, job.threadId)
      if (!valid) throw new Error('recovery archive verification failed')
    }
  }

  private async reclaim(job: ConsolidationJob): Promise<'completed' | 'pending'> {
    this.assertRunning()
    this.policy(job)
    await this.verifyMemory(job)
    if (job.reclaimTier === 'tier-1') {
      return this.reclaimTier1(job, job.reclaimMode!)
    }
    return this.reclaimTier2(job, job.reclaimMode!)
  }

  private async reclaimTier1(job: ConsolidationJob, mode: ConsolidationReclaimMode): Promise<'completed' | 'pending'> {
    let current = job
    const thread = await this.currentThread(current)
    if (current.status === 'verified') {
      await this.verify(current)
      const before = current.measuredBytes?.before ?? await computeDirectoryByteSize(this.threadPath(thread.id))
      const cutoff = completedCutoff(thread)
      if (!cutoff) throw new Error('completed cutoff turn is unavailable')
      current = await this.options.jobStore.transition(current.id, ['verified'], 'pruning', {
        ...(current.measuredBytes?.before === undefined ? { measuredBytes: { before } } : {}),
        cutoffTurnId: cutoff
      })
    }
    if (current.status === 'pruning') {
      const latest = await this.currentThread(current)
      const cutoff = current.cutoffTurnId
      if (!cutoff) throw new Error('completed cutoff turn is unavailable')
      if (!current.prunedRevision) {
        // Missing cutoff alone cannot prove that our prune committed. Preserve
        // the archive if a crash lost the durable post-prune receipt.
        await this.verify(current)
        if (!latest.turns.some((turn) => turn.id === cutoff)) throw new Error('prune completion is ambiguous')
        this.assertRunning()
        await this.options.turnService.pruneThread({
          threadId: latest.id,
          request: { throughTurnId: cutoff, archiveBeforePrune: false, expectedThreadRevision: Number(current.cutoffRevision) }
        })
        const pruned = await this.currentThread(current)
        if (pruned.turns.some((turn) => turn.id === cutoff)) throw new Error('prune did not remove cutoff turn')
        const snapshot = await this.options.sessionStore.loadItemSnapshot(pruned.id)
        current = await this.options.jobStore.transition(current.id, ['pruning'], 'pruning', {
          prunedRevision: { thread: pruned.revision ?? 0, items: snapshot.revision }
        })
      }
      const afterPruneThread = await this.currentThread(current)
      await this.assertEligibleForMutation(afterPruneThread, current, current.prunedRevision!.thread)
      const snapshot = await this.options.sessionStore.loadItemSnapshot(afterPruneThread.id)
      if (snapshot.revision !== current.prunedRevision!.items) throw new Error('pruned session revision changed')
      const after = await computeDirectoryByteSize(this.threadPath(afterPruneThread.id))
      if (mode === 'safe' && current.archiveExpiresAt && Date.parse(current.archiveExpiresAt) > Date.parse(this.now())) {
        await this.verifyRecovery(current)
        await this.options.jobStore.transition(current.id, ['pruning'], 'pruning', {
          measuredBytes: { after, reclaimed: Math.max(0, (current.measuredBytes?.before ?? after) - after) },
          reason: 'waiting for recovery archive ttl'
        })
        return 'pending'
      }
      if (mode === 'safe' && current.recoverySnapshotId) {
        this.assertRunning()
        await this.verifyRecovery(current)
        await this.options.snapshots.remove(afterPruneThread.id, current.recoverySnapshotId)
      }
      const finalAfter = await computeDirectoryByteSize(this.threadPath(afterPruneThread.id))
      const reclaimed = Math.max(0, (current.measuredBytes?.before ?? finalAfter) - finalAfter)
      if (reclaimed <= 0) throw new Error('thread payload space reclamation was not observed')
      await this.options.jobStore.transition(current.id, ['pruning'], 'completed', {
        measuredBytes: { after: finalAfter, reclaimed }
      })
      return 'completed'
    }
    return 'pending'
  }

  private async reclaimTier2(job: ConsolidationJob, mode: ConsolidationReclaimMode): Promise<'completed' | 'pending'> {
    let current = job
    if (current.status === 'verified') {
      const thread = await this.currentThread(current)
      await this.verify(current)
      const before = await computeDirectoryByteSize(this.threadPath(thread.id))
      current = await this.options.jobStore.transition(current.id, ['verified'], 'deleting', {
        measuredBytes: { before },
        artifactOwnerIds: [thread.id, ...thread.turns.map((turn) => turn.id)]
      })
    }
    if (current.status !== 'deleting') return 'pending'
    // Read errors are not evidence of deletion. Never swallow them here.
    const exists = await this.options.threadStore.get(current.threadId)
    if (exists) {
      if (current.deletedAt) throw new Error('deleted thread was recreated; refusing cleanup')
      await this.verify(current)
      this.assertRunning()
      await this.options.threadService.delete(current.threadId)
      if (await this.options.threadStore.get(current.threadId)) throw new Error('thread deletion was not observed')
    }
    if (!current.deletedAt) {
      if (!exists) {
        if (mode !== 'safe') throw new Error('thread deletion is ambiguous without a recovery archive')
        await this.verifyRecovery(current)
      }
      current = await this.options.jobStore.transition(current.id, ['deleting'], 'deleting', { deletedAt: this.now() })
    }
    const after = await computeDirectoryByteSize(this.threadPath(current.threadId))
    if (mode === 'safe' && current.archiveExpiresAt && Date.parse(current.archiveExpiresAt) > Date.parse(this.now())) {
      await this.verifyRecovery(current)
      await this.options.jobStore.transition(current.id, ['deleting'], 'deleting', {
        measuredBytes: { after, reclaimed: Math.max(0, (current.measuredBytes?.before ?? after) - after) },
        reason: 'waiting for recovery archive ttl'
      })
      return 'pending'
    }
    this.assertRunning()
    for (const ownerId of current.artifactOwnerIds ?? [current.threadId]) {
      await this.options.artifactStore?.releaseOwner?.(ownerId)
    }
    if (mode === 'safe') await this.recovery.remove(current.id)
    const finalAfter = await computeDirectoryByteSize(this.threadPath(current.threadId))
    const reclaimed = Math.max(0, (current.measuredBytes?.before ?? finalAfter) - finalAfter)
    if (reclaimed <= 0) throw new Error('thread payload space reclamation was not observed')
    await this.options.jobStore.transition(current.id, ['deleting'], 'completed', {
      measuredBytes: {
        after: finalAfter,
        reclaimed
      }
    })
    return 'completed'
  }

  private policy(job: ConsolidationJob): NonNullable<ConsolidationJob['policy']> {
    if (!job.reclaimMode || !job.reclaimTier || !job.policy) throw new Error('job has no frozen consolidation policy')
    if ((job.status === 'pruning' && job.reclaimTier !== 'tier-1') ||
      (job.status === 'deleting' && job.reclaimTier !== 'tier-2')) throw new Error('job phase contradicts frozen tier')
    return job.policy
  }

  private assertRunning(): void {
    if (this.stopped || !this.options.config().enabled) throw new Error('session consolidation is stopped or disabled')
  }

  private async readMemory(id: string): Promise<MemoryRecord> {
    const store = this.options.memoryStore()
    if (!store) throw new Error('memory store is unavailable')
    const record = store.getById
      ? await store.getById(id).catch(() => null)
      : (await store.list({ all: true })).find((candidate) => candidate.id === id) ?? null
    if (!record) throw new Error(`consolidation memory record is missing: ${id}`)
    return record
  }

  private async currentThread(job: ConsolidationJob): Promise<ThreadRecord> {
    const thread = await this.options.threadStore.get(job.threadId)
    if (!thread) throw new Error(`thread not found: ${job.threadId}`)
    return thread
  }

  private async assertEligibleForMutation(thread: ThreadRecord, job: ConsolidationJob, expectedRevision = Number(job.cutoffRevision)): Promise<void> {
    this.assertRunning()
    if (thread.status !== 'archived') throw new Error('thread is no longer archived')
    if (thread.pinned === true) throw new Error('thread is pinned')
    if (thread.parentThreadId || thread.forkedFromThreadId) throw new Error('thread has a fork dependency')
    if (thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) {
      throw new Error('thread has an active turn')
    }
    if (this.options.hasPendingInteractions?.(thread.id)) throw new Error('thread has pending interaction')
    if ((thread.revision ?? 0) !== expectedRevision) throw new Error('thread revision changed')
    const summaries = await this.options.threadStore.list({ includeArchived: true, includeSide: true })
    if (summaries.some((summary) => summary.id !== thread.id &&
      (summary.parentThreadId === thread.id || summary.forkedFromThreadId === thread.id))) {
      throw new Error('thread has a fork dependency')
    }
  }

  private async fail(jobId: string, message: string): Promise<void> {
    const current = await this.options.jobStore.get(jobId)
    if (!current || current.status === 'failed' || current.status === 'completed') return
    await this.options.jobStore.transition(jobId, [current.status], 'failed', { error: message, reason: message })
  }

  private threadPath(threadId: string): string {
    return join(this.options.dataDir, 'threads', threadId)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function completedCutoff(thread: ThreadRecord): string | undefined {
  return [...thread.turns]
    .filter((turn) => turn.status === 'completed' && Boolean(turn.finishedAt))
    .sort((left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!))[0]?.id
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').trim().slice(0, 512) || 'consolidation failed'
}
