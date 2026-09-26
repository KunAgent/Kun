import type { ThreadRecord } from '../contracts/threads.js'
import { join } from 'node:path'
import {
  MemoryRecord as MemoryRecordSchema,
  type MemoryCreateRequest,
  type MemoryRecord
} from '../contracts/memory.js'
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
    const cleanup = await this.cleanupExpiredArchives(config.maxThreadsPerRun)
    return {
      enabled: true,
      scheduled: selection.scheduled.length,
      processed: jobs.length,
      completed,
      episodesWritten: counters.episodesWritten,
      durableCandidatesQueued: counters.durableCandidatesQueued,
      bytesReclaimed,
      skippedByReason,
      pendingArchiveCleanup: cleanup.pending,
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
      reclaimTier: config.tier
    })
  }

  private async process(job: ConsolidationJob, counters?: RunCounters): Promise<'completed' | 'pending'> {
    if (job.status === 'eligible') return this.extract(job, counters)
    if (job.status === 'materialized') {
      if (job.error) return 'pending'
      return this.prepareVerified(job)
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
      inputMaxBytes: this.options.config().summaryInputMaxBytes,
      maxTokens: this.options.config().summaryMaxTokens,
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
      itemRevision: snapshot.revision
    })
    return this.prepareVerified(current)
  }

  private async prepareVerified(job: ConsolidationJob): Promise<'completed' | 'pending'> {
    const checkpoint = job.checkpoint
    if (!checkpoint) throw new Error('consolidation checkpoint is missing')
    const config = this.options.config()
    let current = job
    if (config.reclaimMode === 'safe' && !current.recoverySnapshotId) {
      const thread = await this.currentThread(current)
      // Tier-1 snapshots live inside the thread directory. Capture the
      // source size before creating that snapshot so the later delta cannot
      // count the recovery copy as reclaimed payload.
      const baselineBytes = config.tier === 'tier-1'
        ? await computeDirectoryByteSize(this.threadPath(thread.id))
        : undefined
      if (config.tier === 'tier-1') {
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
          archiveExpiresAt: new Date(Date.parse(this.now()) + config.archiveTtlMs).toISOString(),
          ...(baselineBytes === undefined ? {} : { measuredBytes: { before: baselineBytes } })
        })
      } else {
        await this.recovery.capture({ jobId: current.id, threadId: thread.id })
        current = await this.options.jobStore.transition(current.id, ['materialized'], 'materialized', {
          recoverySnapshotId: current.id,
          archiveExpiresAt: new Date(Date.parse(this.now()) + config.archiveTtlMs).toISOString()
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
    const memory = await this.readMemory(job.memoryIds[0]!)
    const parsed = MemoryRecordSchema.parse(memory)
    const evidence = parsed.sources.find((source) => source.threadId === job.threadId)
    if (!evidence?.excerpt || !evidence.contentHash || parsed.type !== 'episode' || parsed.authority !== 'reference') {
      throw new Error('episode evidence is incomplete')
    }
    if (this.options.config().reclaimMode === 'safe') {
      if (!job.recoverySnapshotId) throw new Error('recovery archive is missing')
      const valid = this.options.config().tier === 'tier-1'
        ? await this.options.snapshots.verify(job.threadId, job.recoverySnapshotId)
        : await this.recovery.verify(job.recoverySnapshotId, job.threadId)
      if (!valid) throw new Error('recovery archive verification failed')
    }
  }

  private async reclaim(job: ConsolidationJob): Promise<'completed' | 'pending'> {
    const config = this.options.config()
    if (config.tier === 'tier-1') {
      return this.reclaimTier1(job, config.reclaimMode)
    }
    return this.reclaimTier2(job, config.reclaimMode)
  }

  private async reclaimTier1(job: ConsolidationJob, mode: ConsolidationReclaimMode): Promise<'completed' | 'pending'> {
    let current = job
    const thread = await this.currentThread(current)
    if (current.status === 'verified') {
      await this.assertEligibleForMutation(thread, current)
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
      if (mode === 'safe' && current.archiveExpiresAt && Date.parse(current.archiveExpiresAt) <= Date.parse(this.now())) {
        if (current.recoverySnapshotId) await this.options.snapshots.remove(latest.id, current.recoverySnapshotId)
        const after = await computeDirectoryByteSize(this.threadPath(latest.id))
        const reclaimed = Math.max(0, (current.measuredBytes?.before ?? after) - after)
        if (reclaimed <= 0) throw new Error('thread payload space reclamation was not observed')
        await this.options.jobStore.transition(current.id, ['pruning'], 'completed', {
          measuredBytes: { after, reclaimed },
          reason: 'recovery archive ttl expired'
        })
        return 'completed'
      }
      const cutoff = current.cutoffTurnId ?? completedCutoff(latest)
      if (!cutoff) throw new Error('completed cutoff turn is unavailable')
      const alreadyPruned = !latest.turns.some((turn) => turn.id === cutoff)
      if (!alreadyPruned) {
        await this.options.turnService.pruneThread({
          threadId: latest.id,
          request: { throughTurnId: cutoff, archiveBeforePrune: false, expectedThreadRevision: Number(current.cutoffRevision) }
        })
      }
      const after = await computeDirectoryByteSize(this.threadPath(latest.id))
      if (mode === 'safe' && current.archiveExpiresAt && Date.parse(current.archiveExpiresAt) > Date.parse(this.now())) {
        await this.options.jobStore.transition(current.id, ['pruning'], 'pruning', {
          measuredBytes: { after, reclaimed: Math.max(0, (current.measuredBytes?.before ?? after) - after) },
          reason: 'waiting for recovery archive ttl'
        })
        return 'pending'
      }
      if (mode === 'safe' && current.recoverySnapshotId) {
        await this.options.snapshots.remove(latest.id, current.recoverySnapshotId)
      }
      const finalAfter = await computeDirectoryByteSize(this.threadPath(latest.id))
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
      await this.assertEligibleForMutation(thread, current)
      const before = await computeDirectoryByteSize(this.threadPath(thread.id))
      current = await this.options.jobStore.transition(current.id, ['verified'], 'deleting', {
        measuredBytes: { before },
        artifactOwnerIds: [thread.id, ...thread.turns.map((turn) => turn.id)]
      })
    }
    if (current.status !== 'deleting') return 'pending'
    if (mode === 'safe' && current.recoverySnapshotId && !await this.recovery.verify(current.recoverySnapshotId, current.threadId)) {
      throw new Error('external recovery archive verification failed')
    }
    const exists = await this.options.threadStore.get(current.threadId).catch(() => null)
    if (exists) await this.options.threadService.delete(current.threadId)
    const after = await computeDirectoryByteSize(this.threadPath(current.threadId))
    if (mode === 'safe' && current.archiveExpiresAt && Date.parse(current.archiveExpiresAt) > Date.parse(this.now())) {
      await this.options.jobStore.transition(current.id, ['deleting'], 'deleting', {
        measuredBytes: { after, reclaimed: Math.max(0, (current.measuredBytes?.before ?? after) - after) },
        reason: 'waiting for recovery archive ttl'
      })
      return 'pending'
    }
    if (mode === 'safe') await this.recovery.remove(current.id)
    for (const ownerId of current.artifactOwnerIds ?? [current.threadId]) {
      await this.options.artifactStore?.releaseOwner?.(ownerId)
    }
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

  private async cleanupExpiredArchives(limit: number): Promise<{ pending: number }> {
    const jobs = (await this.options.jobStore.list())
      .filter((job) => (job.status === 'pruning' || job.status === 'deleting') && job.archiveExpiresAt)
      .slice(0, limit)
    let pending = 0
    for (const job of jobs) {
      if (Date.parse(job.archiveExpiresAt!) > Date.parse(this.now())) { pending += 1; continue }
      await this.process(job).catch(async (error) => {
        await this.fail(job.id, safeError(error)).catch(() => undefined)
      })
    }
    return { pending }
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

  private async assertEligibleForMutation(thread: ThreadRecord, job: ConsolidationJob): Promise<void> {
    if (thread.status !== 'archived') throw new Error('thread is no longer archived')
    if (thread.pinned === true) throw new Error('thread is pinned')
    if (thread.parentThreadId || thread.forkedFromThreadId) throw new Error('thread has a fork dependency')
    if (thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) {
      throw new Error('thread has an active turn')
    }
    if (this.options.hasPendingInteractions?.(thread.id)) throw new Error('thread has pending interaction')
    if (String(thread.revision ?? 0) !== job.cutoffRevision) throw new Error('thread revision changed')
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
