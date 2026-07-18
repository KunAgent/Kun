import { createHash } from 'node:crypto'
import type {
  ExtensionContext,
  GeneratedArtifact,
  JobSnapshot,
  JsonObject,
  JsonValue
} from '@kun/extension-api'
import {
  DerivedMediaStore,
  ProjectService,
  buildDerivedJobPlan,
  derivedDedupeKey,
  fingerprintAssetIdentity,
  type BrokeredDerivedKind,
  type DerivedMediaPersistence,
  type DerivedMediaPriority,
  type DerivedMediaRecord,
  type DerivedMediaSnapshot,
  type DerivedMediaStoreOptions,
  type DerivedRequest,
  type MediaAsset,
  type SourceFingerprint,
  type VideoProject
} from '../engine/index.js'

const DERIVED_SNAPSHOT_KEY = 'derived-media:snapshot'
const DERIVED_OUTPUT_PREFIX = 'derived-media:output:'
const TERMINAL_STATUSES = new Set(['ready', 'failed', 'cancelled', 'interrupted', 'invalid'])

export type DerivedMediaStartInput = {
  project: VideoProject
  assetId: string
  kind: BrokeredDerivedKind
  /** Optional persistent export grant. Omitted derived outputs use Host-owned cache targets. */
  outputHandleId?: string
  priority?: DerivedMediaPriority
  normalizedParameters?: Readonly<Record<string, unknown>>
  retryRecordId?: string
}

export type DerivedMediaListResult = {
  records: JsonObject[]
  usage: JsonObject
  recoveryDiagnostics: string[]
}

export type DerivedMediaServiceOptions = {
  /** Test/embedding seam; production loads the authoritative workspace project. */
  loadProject?: (projectId: string) => Promise<VideoProject | undefined>
  store?: Pick<DerivedMediaStoreOptions, 'quotaBytes' | 'maxRecords' | 'now'>
}

type PendingStage = {
  id: 'partial' | 'final'
  outputHandleId: string
  partial: boolean
}

type PendingOutput = {
  schemaVersion: 3
  recordId: string
  sourceHandleId: string
  pinnedRevision: number
  stages: PendingStage[]
  stageIndex: number
  durationUs: number
  createdAt: string
}

class WorkspaceDerivedPersistence implements DerivedMediaPersistence {
  constructor(private readonly context: ExtensionContext) {}

  async load(): Promise<unknown | undefined> {
    return await this.context.storage.workspace.get<JsonValue>(DERIVED_SNAPSHOT_KEY)
  }

  async save(snapshot: DerivedMediaSnapshot): Promise<void> {
    await this.context.storage.workspace.set(
      DERIVED_SNAPSHOT_KEY,
      snapshot as unknown as JsonValue
    )
  }
}

/**
 * Host-facing orchestration for derived media. It never receives or persists
 * filesystem paths: inputs and outputs remain opaque Host media handles and
 * execution is delegated to the durable FFmpeg/job brokers.
 *
 * Kun owns durable native execution, the generic priority/concurrency gate,
 * explicitly-transient bounded retry, cancellation/restart fencing, cache
 * handles, and successful View-lease access clocks. This service owns only the
 * editor's semantic dependency graph and selects dependency-safe LRU records;
 * eviction releases opaque Host cache handles so bytes remain runtime-owned.
 */
export class DerivedMediaService {
  private storePromise?: Promise<DerivedMediaStore>
  private projectService?: ProjectService

  constructor(
    private readonly context: ExtensionContext,
    private readonly options: DerivedMediaServiceOptions = {}
  ) {}

  async list(projectId: string): Promise<DerivedMediaListResult> {
    const store = await this.store()
    const project = await this.loadProject(projectId)
    if (project) await this.synchronizeProject(project)
    else await this.synchronizeRecordAccess(store, projectId)
    await this.reconcile({ projectId })
    await this.scheduleQueued(projectId)
    const records = await store.list({ owner: this.owner({ projectId }) })
    const usage = await store.usage()
    return {
      records: records.map(derivedRecordProjection),
      usage: usage as unknown as JsonObject,
      recoveryDiagnostics: store.recoveryDiagnostics.slice(0, 32)
    }
  }

  async start(input: DerivedMediaStartInput): Promise<{
    outcome: 'queued' | 'deduplicated' | 'backoff' | 'unavailable'
    record: JsonObject
    jobId?: string
    message?: string
  }> {
    const asset = requiredAsset(input.project, input.assetId)
    if (!asset.mediaHandleId) {
      throw new Error(`Asset ${asset.id} must be reauthorized before derived media can be generated.`)
    }
    await this.synchronizeProject(input.project)
    const requested = await this.requestRecord(input, asset)
    if (requested.deduplicated) {
      return {
        outcome: requested.backoffActive ? 'backoff' : 'deduplicated',
        record: derivedRecordProjection(requested.record),
        ...(requested.record.jobId ? { jobId: requested.record.jobId } : {})
      }
    }
    const capabilities = await this.context.media.getCapabilities()
    if (!capabilities.ffmpeg.available) {
      const unavailable = await (await this.store()).fail(requested.record.id, {
        code: 'ffmpeg_unavailable',
        message: 'FFmpeg is unavailable. Install or configure the local media tools and retry.',
        retryable: true
      })
      await this.publish(unavailable, 'capability-unavailable')
      return {
        outcome: 'unavailable',
        record: derivedRecordProjection(unavailable),
        message: 'FFmpeg is unavailable. Install or configure the local media tools and retry.'
      }
    }

    let pending: PendingOutput
    try {
      pending = {
        schemaVersion: 3,
        recordId: requested.record.id,
        sourceHandleId: opaqueHandle(asset.mediaHandleId, 'sourceHandleId'),
        pinnedRevision: input.project.currentRevision,
        stages: await this.createStages(input.kind, input.outputHandleId),
        stageIndex: 0,
        durationUs: Math.max(1, asset.durationUs),
        createdAt: new Date().toISOString()
      }
    } catch (error) {
      const interrupted = await (await this.store()).interrupt(
        requested.record.id,
        'The Host could not allocate bounded derived cache targets; retry to request fresh grants.'
      )
      await this.publish(interrupted, 'cache-allocation-interrupted')
      throw error
    }
    await this.savePendingOutput(pending)
    const scheduled = await this.scheduleRecord(requested.record, pending)
    return {
      outcome: 'queued',
      record: derivedRecordProjection(scheduled),
      ...(scheduled.jobId ? { jobId: scheduled.jobId } : {})
    }
  }

  async cancel(projectId: string, recordId: string): Promise<JsonObject> {
    const store = await this.store()
    const record = await this.scopedRecord(store, projectId, recordId)
    if (TERMINAL_STATUSES.has(record.status)) {
      if (record.status !== 'ready') await this.discardPending(record)
      return derivedRecordProjection(record)
    }
    if (record.jobId) {
      await this.context.jobs.cancel({
        jobId: record.jobId,
        reason: 'Derived media generation cancelled from the video editor sidebar'
      })
    }
    const cancelled = await store.cancel(record.id)
    await this.discardPending(record)
    await this.publish(cancelled, 'cancelled')
    return derivedRecordProjection(cancelled)
  }

  async cleanup(projectId: string, includeReady: boolean): Promise<{
    removedIds: string[]
    usage: JsonObject
  }> {
    const store = await this.store()
    const removed = await store.cleanup({
      owner: this.owner({ projectId }),
      includeReady,
      includeFailed: true,
      includeInvalid: true,
      includeCancelled: true
    })
    return {
      removedIds: removed.map(({ id }) => id),
      usage: await store.usage() as unknown as JsonObject
    }
  }

  /**
   * Reconciles real cache records against the authoritative project grant and
   * source identity. This is safe to call after every relink/reauthorize and is
   * also invoked by list/start so stale persisted results cannot be reused.
   */
  async synchronizeProject(project: VideoProject): Promise<JsonObject[]> {
    const store = await this.store()
    await this.synchronizeRecordAccess(store, project.id)
    const records = await store.list({ owner: this.owner({ projectId: project.id }) })
    if (records.length === 0) return []

    const invalidated = new Map<string, DerivedMediaRecord>()
    const assetIds = new Set(records.flatMap(({ owner }) => owner.assetId ? [owner.assetId] : []))
    for (const assetId of assetIds) {
      const owner = this.owner({ projectId: project.id, assetId })
      const asset = project.assets.find(({ id }) => id === assetId)
      if (!asset || !asset.mediaHandleId || (asset.availability !== undefined && asset.availability !== 'online')) {
        for (const record of await store.invalidateOwner(owner, {
          code: 'source_unavailable',
          message: 'Source media is missing, revoked, or changed; reauthorize it before recomputing this result.'
        })) invalidated.set(record.id, record)
        continue
      }

      const currentFingerprint = effectiveSourceFingerprint(asset)
      for (const record of await store.invalidateOwnerSourceChange(owner, currentFingerprint)) {
        invalidated.set(record.id, record)
      }
      try {
        const metadata = await this.context.media.stat({ handleId: asset.mediaHandleId })
        if (metadata.revoked) throw new Error('source grant was revoked')
      } catch {
        for (const record of await store.invalidateOwner(owner, {
          code: 'source_unavailable',
          message: 'The Host rejected the source grant because it was revoked, replaced, or changed.'
        })) invalidated.set(record.id, record)
      }
    }

    const finalized: JsonObject[] = []
    for (const record of invalidated.values()) {
      const result = await this.finalizeInvalidation(store, record)
      await this.publish(result, record.error?.code ?? 'source-invalidated')
      finalized.push(derivedRecordProjection(result))
    }
    return finalized
  }

  private async requestRecord(
    input: DerivedMediaStartInput,
    asset: MediaAsset
  ): Promise<Awaited<ReturnType<DerivedMediaStore['request']>>> {
    const store = await this.store()
    const request: DerivedRequest = {
      kind: input.kind,
      owner: this.owner({ projectId: input.project.id, assetId: asset.id }),
      sourceFingerprint: effectiveSourceFingerprint(asset),
      normalizedParameters: input.normalizedParameters ?? {},
      producer: { id: `kun-video-editor.${input.kind}`, version: this.context.extension.version },
      priority: input.priority ?? (input.kind === 'proof' || input.kind === 'preview' ? 'interactive' : 'user')
    }
    if (input.retryRecordId) {
      const existing = await this.scopedRecord(store, input.project.id, input.retryRecordId)
      if (existing.dedupeKey === derivedDedupeKey(request) && !TERMINAL_STATUSES.has(existing.status)) {
        return { record: existing, deduplicated: true, backoffActive: false }
      }
      if (
        existing.dedupeKey === derivedDedupeKey(request) &&
        ['failed', 'cancelled', 'interrupted', 'invalid'].includes(existing.status)
      ) {
        return {
          record: await store.retry(existing.id, request.priority),
          deduplicated: false,
          backoffActive: false
        }
      }
    }
    return await store.request(request)
  }

  private async reconcile(filter: { projectId: string }): Promise<void> {
    const store = await this.store()
    const records = await store.list({ owner: this.owner(filter) })
    for (const record of records) {
      if (TERMINAL_STATUSES.has(record.status)) {
        if (record.status === 'ready') {
          await this.context.storage.workspace.delete(outputKey(record.id)).catch(() => false)
        } else if (
          record.jobId !== undefined || record.bytes > 0 ||
          record.artifactHandleIds.length > 0 || record.partialArtifactHandleIds.length > 0 ||
          (await this.pendingHandleIds(record.id)).length > 0
        ) {
          await this.discardPending(record)
          await store.discardArtifacts(record.id)
        }
        continue
      }
      if (!record.jobId || !['running', 'partial'].includes(record.status)) continue
      const pending = await this.pendingOutput(record.id)
      let snapshot: JobSnapshot
      try {
        snapshot = await this.context.jobs.get(record.jobId)
        this.assertOwnedSnapshot(snapshot)
      } catch {
        await this.discardPending(record)
        const interrupted = await store.interrupt(record.id, 'The durable derived job is no longer available for reconciliation.')
        await this.publish(interrupted, 'job-unavailable')
        continue
      }
      if (snapshot.state === 'queued' || snapshot.state === 'running') {
        const progress = normalizedStageProgress(snapshot, pending)
        if (progress && !sameProgress(record, progress)) {
          const progressed = await store.reportProgress(record.id, progress)
          await this.publish(progressed, 'progress')
        }
        continue
      }
      if (snapshot.state === 'completed') {
        if (pending && record.status === 'partial' && pending.stageIndex > 0) {
          const previousStageIndex = pending.stageIndex - 1
          const previousStage = pending.stages[previousStageIndex]
          const previousArtifacts = previousStage?.partial
            ? await this.verifiedArtifacts(
                snapshot,
                record,
                previousStage,
                previousStageIndex,
                pending.stages.length,
                pending.pinnedRevision
              )
            : []
          if (
            previousArtifacts.length > 0 &&
            previousArtifacts.every(({ mediaHandleId }) =>
              record.partialArtifactHandleIds.includes(mediaHandleId))
          ) {
            const queued = await store.queueNextStage(record.id)
            await this.publish(queued, 'partial-stage-recovered')
            continue
          }
        }
        const stage = pending?.stages[pending.stageIndex]
        const artifacts = await this.verifiedArtifacts(
          snapshot,
          record,
          stage,
          pending?.stageIndex,
          pending?.stages.length,
          pending?.pinnedRevision
        )
        if (artifacts.length === 0) {
          await this.discardPending(record)
          const failed = await store.fail(record.id, {
            code: 'invalid_output',
            message: 'The derived job completed without a verified owned artifact.',
            retryable: true
          })
          await this.publish(failed, 'invalid-output')
          continue
        }
        if (pending && stage?.partial) {
          const partialHandleIds = artifacts.map(({ mediaHandleId }) => mediaHandleId)
          await this.releaseHandles(record.partialArtifactHandleIds.filter((handleId) =>
            !partialHandleIds.includes(handleId)))
          await store.reportProgress(record.id, {
            completed: pending.stageIndex + 1,
            total: pending.stages.length,
            unit: 'phase',
            message: `${stage.id} ready`,
            partialArtifactHandleIds: partialHandleIds
          })
          pending.stageIndex += 1
          await this.savePendingOutput(pending)
          const queued = await store.queueNextStage(record.id)
          await this.publish(queued, 'partial-ready')
          continue
        }
        await this.releaseHandles(record.partialArtifactHandleIds)
        try {
          const ready = await store.complete(record.id, {
            bytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
            artifactHandleIds: artifacts.map(({ mediaHandleId }) => mediaHandleId)
          })
          await this.context.storage.workspace.delete(outputKey(record.id)).catch(() => false)
          await this.publish(ready, 'ready')
        } catch (error) {
          await this.releaseHandles(artifacts.map(({ mediaHandleId }) => mediaHandleId))
          await this.discardPending(record)
          const failed = await store.fail(record.id, {
            code: 'cache_quota',
            message: error instanceof Error ? error.message : 'Derived cache capacity was exceeded.',
            retryable: false
          })
          await this.publish(failed, 'capacity-failed')
        }
        continue
      }
      if (snapshot.state === 'cancelled') {
        await this.discardPending(record)
        const cancelled = await store.cancel(record.id)
        await this.publish(cancelled, 'cancelled')
        continue
      }
      if (snapshot.state === 'interrupted') {
        await this.discardPending(record)
        const interrupted = await store.interrupt(
          record.id,
          snapshot.error?.message ?? 'The durable derived job was interrupted.'
        )
        await this.publish(interrupted, 'interrupted')
        continue
      }
      await this.discardPending(record)
      const failed = await store.fail(record.id, {
        code: snapshot.error?.code?.toLowerCase() ?? 'derived_failed',
        message: snapshot.error?.message ?? 'The durable derived job failed.',
        retryable: snapshot.error?.retryable ?? true
      })
      await this.publish(failed, 'failed')
    }
  }

  private async verifiedArtifacts(
    snapshot: JobSnapshot,
    record: DerivedMediaRecord,
    stage?: PendingStage,
    stageIndex?: number,
    stageCount?: number,
    pinnedRevision?: number
  ): Promise<GeneratedArtifact[]> {
    const artifacts = snapshot.result?.generatedArtifacts ?? []
    const verified: GeneratedArtifact[] = []
    const expected = expectedDerivedArtifact(record.kind)
    if (!expected) return verified
    for (const artifact of artifacts) {
      const metadata = artifact.provenance.metadata
      if (
        artifact.ownerExtensionId !== this.context.extension.id ||
        artifact.ownerExtensionVersion !== this.context.extension.version ||
        artifact.workspaceId !== this.workspaceId() ||
        artifact.availability !== 'available' ||
        artifact.provenance.jobId !== snapshot.id ||
        metadata?.derivedId !== record.id ||
        metadata?.dedupeKey !== record.dedupeKey ||
        metadata?.derivedKind !== record.kind ||
        metadata?.projectId !== record.owner.projectId ||
        metadata?.assetId !== record.owner.assetId ||
        metadata?.sourceFingerprint !== record.sourceFingerprint.value ||
        metadata?.producerId !== record.producer.id ||
        metadata?.producerVersion !== record.producer.version ||
        metadata?.priority !== record.priority ||
        (pinnedRevision !== undefined && metadata?.pinnedRevision !== pinnedRevision) ||
        (stage !== undefined && metadata?.derivedPhase !== stage.id) ||
        (stageIndex !== undefined && metadata?.derivedPhaseIndex !== stageIndex) ||
        (stageCount !== undefined && metadata?.derivedPhaseCount !== stageCount) ||
        artifact.mediaKind !== expected.mediaKind ||
        artifact.mimeType !== expected.mimeType ||
        artifact.byteSize <= 0
      ) continue
      try {
        const stat = await this.context.media.stat({ handleId: artifact.mediaHandleId })
        if (!stat.revoked && (stat.byteSize ?? artifact.byteSize) > 0) verified.push(artifact)
      } catch {
        // A result that cannot be resolved through its opaque handle is not ready.
      }
    }
    return verified
  }

  private async scopedRecord(
    store: DerivedMediaStore,
    projectId: string,
    recordId: string
  ): Promise<DerivedMediaRecord> {
    const record = await store.get(recordId, false)
    if (!record || !ownerMatches(record, this.owner({ projectId }))) {
      throw new Error(`Derived record is unavailable in project ${projectId}: ${recordId}`)
    }
    return record
  }

  private async finalizeInvalidation(
    store: DerivedMediaStore,
    record: DerivedMediaRecord
  ): Promise<DerivedMediaRecord> {
    if (record.jobId) {
      await this.context.jobs.cancel({
        jobId: record.jobId,
        reason: 'Derived source identity changed or its grant was revoked'
      }).catch(() => undefined)
    }
    await this.discardPending(record)
    return await store.discardArtifacts(record.id)
  }

  private async synchronizeRecordAccess(
    store: DerivedMediaStore,
    projectId: string
  ): Promise<void> {
    const records = await store.list({ owner: this.owner({ projectId }) })
    for (const record of records) {
      if (record.status !== 'ready' && record.status !== 'partial') continue
      let latest = record.lastAccessedAt
      for (const handleId of record.status === 'ready'
        ? record.artifactHandleIds
        : record.partialArtifactHandleIds) {
        try {
          const metadata = await this.context.media.stat({ handleId })
          if (metadata.lastAccessedAt && metadata.lastAccessedAt > latest) latest = metadata.lastAccessedAt
        } catch {
          // Artifact availability is reconciled separately; a stat failure is
          // never treated as an access and must not make it newer for eviction.
        }
      }
      if (latest > record.lastAccessedAt) await store.touch(record.id, latest)
    }
  }

  private async loadProject(projectId: string): Promise<VideoProject | undefined> {
    if (this.options.loadProject) return await this.options.loadProject(projectId)
    const workspace = this.context.workspaceContext
    if (!workspace?.active || !workspace.trusted) return undefined
    this.projectService ??= new ProjectService(workspace.root)
    try {
      return await this.projectService.loadProject(projectId)
    } catch {
      return undefined
    }
  }

  private assertOwnedSnapshot(snapshot: JobSnapshot): void {
    if (
      snapshot.ownerExtensionId !== this.context.extension.id ||
      snapshot.ownerExtensionVersion !== this.context.extension.version ||
      snapshot.workspaceId !== this.workspaceId() ||
      snapshot.kind !== 'media.ffmpeg' ||
      snapshot.initiatingOperation !== 'media.startFfmpegJob'
    ) throw new Error('The durable job is not owned derived work in this workspace.')
  }

  private async createStages(
    kind: BrokeredDerivedKind,
    suppliedFinalHandleId?: string
  ): Promise<PendingStage[]> {
    const format = kind === 'proxy' || kind === 'preview' ? 'mp4' as const : 'png' as const
    const progressive = kind === 'waveform' || kind === 'filmstrip' || kind === 'proxy'
    const allocated: string[] = []
    try {
      const stages: PendingStage[] = []
      if (progressive) {
        const partial = await this.context.media.createCacheTarget({
          format,
          purpose: `derived-${kind}-partial`
        })
        allocated.push(partial.target.handleId)
        stages.push({ id: 'partial', outputHandleId: partial.target.handleId, partial: true })
      }
      const finalHandleId = suppliedFinalHandleId === undefined
        ? (await this.context.media.createCacheTarget({
            format,
            purpose: `derived-${kind}-final`
          })).target.handleId
        : opaqueHandle(suppliedFinalHandleId, 'outputHandleId')
      if (suppliedFinalHandleId === undefined) allocated.push(finalHandleId)
      stages.push({ id: 'final', outputHandleId: finalHandleId, partial: false })
      return stages
    } catch (error) {
      await this.releaseHandles(allocated)
      throw error
    }
  }

  private async scheduleQueued(projectId: string): Promise<void> {
    const store = await this.store()
    const records = await store.list({ owner: this.owner({ projectId }) })
    if (records.some((record) =>
      record.jobId && (record.status === 'running' || record.status === 'partial'))) return
    for (const record of records) {
      if (!(
        record.status === 'queued' ||
        (record.status === 'partial' && record.jobId === undefined)
      )) continue
      const pending = await this.pendingOutput(record.id)
      if (!pending) {
        await this.discardPending(record)
        const interrupted = await store.interrupt(
          record.id,
          'Derived scheduling metadata is unavailable; retry to allocate fresh cache targets.'
        )
        await this.publish(interrupted, 'schedule-metadata-missing')
        continue
      }
      await this.scheduleRecord(record, pending)
      return
    }
  }

  private async scheduleRecord(
    record: DerivedMediaRecord,
    pending: PendingOutput
  ): Promise<DerivedMediaRecord> {
    if (record.jobId) return record
    const store = await this.store()
    const workspaceRecords = await store.list({ owner: this.owner() })
    if (workspaceRecords.some((candidate) =>
      candidate.id !== record.id && candidate.jobId &&
      (candidate.status === 'running' || candidate.status === 'partial'))) return record
    if (record.priority !== 'export' && await this.hasExportWork(workspaceRecords)) return record
    const stage = pending.stages[pending.stageIndex]
    if (!stage) {
      await this.discardPending(record)
      const interrupted = await store.interrupt(record.id, 'Derived stage metadata is incomplete.')
      await this.publish(interrupted, 'stage-metadata-invalid')
      return interrupted
    }
    const parameters = stageParameters(record, pending, stage)
    const plan = buildDerivedJobPlan({
      record,
      sourceHandleId: pending.sourceHandleId,
      outputHandleId: stage.outputHandleId,
      pinnedRevision: pending.pinnedRevision,
      ...parameters,
      phase: {
        id: stage.id,
        index: pending.stageIndex,
        count: pending.stages.length,
        partial: stage.partial
      }
    })
    try {
      const started = await this.context.media.startFfmpegJob({
        arguments: plan.arguments,
        inputs: plan.inputs,
        outputs: plan.outputs,
        idempotencyKey: plan.idempotencyKey,
        metadata: plan.metadata,
        scheduling: plan.scheduling
      })
      const running = await store.markRunning(record.id, started.job.jobId)
      await this.publish(running, stage.partial ? 'partial-job-started' : 'final-job-started')
      return running
    } catch (error) {
      await this.discardPending(record)
      const interrupted = await store.interrupt(
        record.id,
        'The durable media broker rejected this derived stage; retry allocates fresh cache targets.'
      )
      await this.publish(interrupted, 'job-admission-interrupted')
      return interrupted
    }
  }

  private async hasExportWork(records: readonly DerivedMediaRecord[]): Promise<boolean> {
    const derivedJobIds = new Set(records.flatMap(({ jobId }) => jobId ? [jobId] : []))
    const page = await this.context.jobs.list({
      filter: {
        states: ['queued', 'running'],
        kinds: ['media.ffmpeg'],
        workspaceId: this.workspaceId()
      },
      limit: 100
    })
    return page.items.some(({ id }) => !derivedJobIds.has(id))
  }

  private async savePendingOutput(pending: PendingOutput): Promise<void> {
    const existingHandles = await this.pendingHandleIds(pending.recordId)
    const nextHandles = new Set(pending.stages.map(({ outputHandleId }) => outputHandleId))
    await this.releaseHandles(existingHandles.filter((handleId) => !nextHandles.has(handleId)))
    await this.context.storage.workspace.set(outputKey(pending.recordId), pending)
  }

  private async pendingOutput(recordId: string): Promise<PendingOutput | undefined> {
    const value = await this.context.storage.workspace.get<JsonValue>(outputKey(recordId))
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.schemaVersion !== 3 ||
      value.recordId !== recordId ||
      !isOpaqueHandle(value.sourceHandleId) ||
      !Number.isSafeInteger(value.pinnedRevision) ||
      Number(value.pinnedRevision) < 0 ||
      !Array.isArray(value.stages) ||
      value.stages.length < 1 ||
      value.stages.length > 2 ||
      !Number.isSafeInteger(value.stageIndex) ||
      Number(value.stageIndex) < 0 ||
      Number(value.stageIndex) >= value.stages.length ||
      !Number.isSafeInteger(value.durationUs) ||
      Number(value.durationUs) < 1 ||
      typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    ) return undefined
    if (!value.stages.every(isPendingStage)) return undefined
    if (
      value.stages.at(-1)?.id !== 'final' ||
      (value.stages.length === 2 && value.stages[0]?.id !== 'partial')
    ) return undefined
    return value as PendingOutput
  }

  private async pendingHandleIds(recordId: string): Promise<string[]> {
    const value = await this.context.storage.workspace.get<JsonValue>(outputKey(recordId))
    if (value === null || typeof value !== 'object' || Array.isArray(value) || value.recordId !== recordId) return []
    if (value.schemaVersion === 1 && typeof value.outputHandleId === 'string') {
      return [value.outputHandleId]
    }
    if ((value.schemaVersion === 2 || value.schemaVersion === 3) && Array.isArray(value.stages)) {
      return value.stages.flatMap((stage) =>
        stage !== null && typeof stage === 'object' && !Array.isArray(stage) &&
        typeof stage.outputHandleId === 'string'
          ? [stage.outputHandleId]
          : [])
    }
    return []
  }

  private async releaseRecordHandles(record: DerivedMediaRecord): Promise<void> {
    const pending = await this.pendingOutput(record.id)
    const handles = new Set([
      ...record.artifactHandleIds,
      ...record.partialArtifactHandleIds,
      ...(pending
        ? pending.stages.map(({ outputHandleId }) => outputHandleId)
        : await this.pendingHandleIds(record.id))
    ])
    await this.releaseHandles([...handles])
  }

  private async discardPending(record: DerivedMediaRecord): Promise<void> {
    await this.releaseRecordHandles(record)
    await this.context.storage.workspace.delete(outputKey(record.id)).catch(() => false)
  }

  private async releaseHandles(handles: readonly string[]): Promise<void> {
    await Promise.all([...new Set(handles)].map((handleId) =>
      this.context.media.release({ resource: 'handle', handleId }).catch(() => undefined)
    ))
  }

  private async publish(record: DerivedMediaRecord, reason: string): Promise<void> {
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.derived-changed',
      payload: {
        schemaVersion: 1,
        generation: record.generation,
        statusGeneration: record.statusGeneration,
        projectId: record.owner.projectId ?? null,
        assetId: record.owner.assetId ?? null,
        reason,
        record: derivedRecordProjection(record)
      }
    })
  }

  private owner(input: { projectId?: string; assetId?: string } = {}): {
    extensionId: string
    extensionVersion: string
    workspaceId: string
    projectId?: string
    assetId?: string
  } {
    return {
      extensionId: this.context.extension.id,
      extensionVersion: this.context.extension.version,
      workspaceId: this.workspaceId(),
      ...input
    }
  }

  private workspaceId(): string {
    const workspace = this.context.workspaceContext
    if (!workspace?.active || !workspace.trusted) {
      throw new Error('Derived media requires an active trusted workspace.')
    }
    return workspace.id
  }

  private async store(): Promise<DerivedMediaStore> {
    this.storePromise ??= DerivedMediaStore.open(
      new WorkspaceDerivedPersistence(this.context),
      {
        ...this.options.store,
        onEvict: async (record) => {
          await this.releaseRecordHandles(record)
          await this.context.storage.workspace.delete(outputKey(record.id)).catch(() => false)
        }
      }
    )
    return await this.storePromise
  }
}

function effectiveSourceFingerprint(asset: MediaAsset): SourceFingerprint {
  const grantFingerprint = fingerprintAssetIdentity(asset)
  if (asset.sourceIdentity?.algorithm !== 'sha256') return grantFingerprint
  return {
    algorithm: 'sha256',
    value: createHash('sha256')
      .update(asset.sourceIdentity.value)
      .update('\0')
      .update(grantFingerprint.value)
      .digest('hex'),
    ...(asset.sourceIdentity.sizeBytes === undefined ? {} : { sizeBytes: asset.sourceIdentity.sizeBytes })
  }
}

export function derivedRecordProjection(record: DerivedMediaRecord): JsonObject {
  const artifactHandleId = record.status === 'partial'
    ? record.partialArtifactHandleIds[0]
    : record.status === 'ready'
      ? record.artifactHandleIds[0]
      : undefined
  return {
    schemaVersion: 1,
    id: record.id,
    generation: record.generation,
    statusGeneration: record.statusGeneration,
    kind: record.kind,
    projectId: record.owner.projectId ?? null,
    assetId: record.owner.assetId ?? null,
    status: record.status,
    priority: record.priority,
    bytes: record.bytes,
    pinned: record.pinned,
    attempt: record.attempt,
    jobId: record.jobId ?? null,
    progress: record.progress ? record.progress as unknown as JsonValue : null,
    error: record.error ? record.error as unknown as JsonValue : null,
    retryAfter: record.retryAfter ?? null,
    artifactHandleId: artifactHandleId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastAccessedAt: record.lastAccessedAt
  }
}

function requiredAsset(project: VideoProject, assetId: string): MediaAsset {
  const asset = project.assets.find(({ id }) => id === assetId)
  if (!asset) throw new Error(`Asset does not exist in project ${project.id}: ${assetId}`)
  return asset
}

function expectedDerivedArtifact(kind: DerivedMediaRecord['kind']): {
  mediaKind: 'image' | 'video'
  mimeType: 'image/png' | 'video/mp4'
} | undefined {
  if (kind === 'proxy' || kind === 'preview') {
    return { mediaKind: 'video', mimeType: 'video/mp4' }
  }
  if (kind === 'waveform' || kind === 'thumbnail' || kind === 'filmstrip' || kind === 'proof') {
    return { mediaKind: 'image', mimeType: 'image/png' }
  }
  return undefined
}

function outputKey(recordId: string): string {
  return `${DERIVED_OUTPUT_PREFIX}${recordId}`.slice(0, 256)
}

function ownerMatches(
  record: DerivedMediaRecord,
  expected: Partial<DerivedMediaRecord['owner']>
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    record.owner[key as keyof DerivedMediaRecord['owner']] === value
  )
}

function opaqueHandle(value: string, path: string): string {
  if (!isOpaqueHandle(value)) {
    throw new Error(`${path} must be an opaque Host media handle.`)
  }
  return value
}

function isOpaqueHandle(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 512 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
}

function isPendingStage(value: JsonValue): value is PendingStage & JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (value.id === 'partial' || value.id === 'final') &&
    isOpaqueHandle(value.outputHandleId) && typeof value.partial === 'boolean' &&
    value.partial === (value.id === 'partial')
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function normalizedProgress(snapshot: JobSnapshot): {
  completed: number
  total: number
  unit: string
  message?: string
} | undefined {
  const progress = snapshot.progress
  if (!progress) return undefined
  const total = progress.total ?? 100
  const completed = progress.completed ?? progress.percentage ?? 0
  if (total <= 0 || completed < 0 || completed > total) return undefined
  return {
    completed,
    total,
    unit: progress.unit ?? (progress.percentage === undefined ? 'work' : 'percent'),
    ...(progress.message ? { message: progress.message.slice(0, 512) } : {})
  }
}

function normalizedStageProgress(
  snapshot: JobSnapshot,
  pending: PendingOutput | undefined
): {
  completed: number
  total: number
  unit: string
  message?: string
} | undefined {
  const progress = normalizedProgress(snapshot)
  if (!progress || !pending) return progress
  const ratio = Math.max(0, Math.min(1, progress.completed / progress.total))
  return {
    completed: Math.min(pending.stages.length, pending.stageIndex + ratio),
    total: pending.stages.length,
    unit: 'phase',
    ...(progress.message ? { message: progress.message } : {})
  }
}

function stageParameters(
  record: DerivedMediaRecord,
  pending: PendingOutput,
  stage: PendingStage
): {
  seekUs?: number
  durationUs?: number
  width?: number
  height?: number
  filmstripIntervalUs?: number
  filmstripColumns?: number
  filmstripRows?: number
} {
  const parameters = record.normalizedParameters
  const seekUs = optionalInteger(parameters.seekUs)
  const requestedDurationUs = optionalInteger(parameters.durationUs) ?? pending.durationUs
  const requestedWidth = optionalInteger(parameters.width)
  const requestedHeight = optionalInteger(parameters.height)
  const requestedIntervalUs = optionalInteger(parameters.filmstripIntervalUs)
  const requestedColumns = optionalInteger(parameters.filmstripColumns)
  const requestedRows = optionalInteger(parameters.filmstripRows)
  if (!stage.partial) {
    const gridCells = Math.max(1, (requestedColumns ?? 5) * (requestedRows ?? 2))
    return {
      ...(seekUs === undefined ? {} : { seekUs }),
      durationUs: requestedDurationUs,
      ...(requestedWidth === undefined ? {} : { width: requestedWidth }),
      ...(requestedHeight === undefined ? {} : { height: requestedHeight }),
      ...(record.kind !== 'filmstrip'
        ? (requestedIntervalUs === undefined ? {} : { filmstripIntervalUs: requestedIntervalUs })
        : { filmstripIntervalUs: requestedIntervalUs ?? Math.max(1, Math.ceil(requestedDurationUs / gridCells)) }),
      ...(requestedColumns === undefined ? {} : { filmstripColumns: requestedColumns }),
      ...(requestedRows === undefined ? {} : { filmstripRows: requestedRows })
    }
  }
  if (record.kind === 'waveform') {
    const partialDurationUs = Math.min(60_000_000, requestedDurationUs)
    return {
      ...(seekUs === undefined ? {} : { seekUs }),
      durationUs: partialDurationUs,
      width: Math.min(512, requestedWidth ?? 1280),
      height: Math.min(96, requestedHeight ?? 240)
    }
  }
  if (record.kind === 'filmstrip') {
    const partialDurationUs = Math.min(60_000_000, requestedDurationUs)
    return {
      ...(seekUs === undefined ? {} : { seekUs }),
      durationUs: partialDurationUs,
      width: Math.min(320, requestedWidth ?? 1280),
      height: Math.min(180, requestedHeight ?? 720),
      filmstripIntervalUs: Math.max(
        requestedIntervalUs ?? 5_000_000,
        Math.max(1, Math.ceil(partialDurationUs / 3))
      ),
      filmstripColumns: Math.min(3, requestedColumns ?? 5),
      filmstripRows: 1
    }
  }
  return {
    ...(seekUs === undefined ? {} : { seekUs }),
    durationUs: Math.min(10_000_000, requestedDurationUs),
    width: Math.min(640, requestedWidth ?? 1280),
    height: Math.min(360, requestedHeight ?? 720)
  }
}

function sameProgress(
  record: DerivedMediaRecord,
  progress: { completed: number; total: number; unit: string; message?: string }
): boolean {
  return record.progress?.completed === progress.completed &&
    record.progress.total === progress.total &&
    record.progress.unit === progress.unit &&
    record.progress.message === progress.message
}
