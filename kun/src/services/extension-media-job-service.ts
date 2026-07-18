import { createHash } from 'node:crypto'
import {
  MediaStartFfmpegJobRequestSchema,
  type GeneratedArtifact,
  type JobReference,
  type MediaJobPriority,
  type MediaStartFfmpegJobRequest,
  type MediaProbeResult
} from '@kun/extension-api'
import type { JsonValue } from '../extensions/types.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionArtifactService,
  type CreateGeneratedArtifactInput
} from './extension-artifact-service.js'
import { ExtensionJobService, type ExtensionJobCoreExecutor } from './extension-job-service.js'
import type { ExtensionJobSnapshot } from './extension-job-types.js'
import {
  ExtensionMediaFfmpegService,
  type ExtensionFfmpegOutputTransaction,
  type ExtensionFfmpegProgress
} from './extension-media-ffmpeg-service.js'
import {
  ExtensionMediaProcessError,
  ExtensionMediaProcessService
} from './extension-media-process-service.js'

const MEDIA_FFMPEG_JOB_KIND = 'media.ffmpeg'
const MAX_MEDIA_RETRY_DELAY_MS = 30_000
const REQUIRED_PERMISSIONS = [
  'jobs.manage',
  'media.read',
  'media.process',
  'media.export',
  'workspace.read',
  'workspace.write'
] as const

export class ExtensionMediaJobError extends Error {
  constructor(
    readonly code:
      | 'permission_denied'
      | 'workspace_denied'
      | 'invalid_checkpoint'
      | 'invalid_output',
    message: string
  ) {
    super(message)
  }
}

type MediaExecutionRelease = () => void

type MediaExecutionWaiter = {
  sequence: number
  priority: MediaJobPriority
  signal: AbortSignal
  resolve(release: MediaExecutionRelease): void
  reject(error: unknown): void
  abort(): void
}

const MEDIA_PRIORITY_ORDER: Readonly<Record<MediaJobPriority, number>> = Object.freeze({
  background: 100,
  user: 200,
  interactive: 300,
  export: 400
})

/**
 * Runtime-owned native-media admission gate. It is intentionally independent
 * of any one extension or derived-media kind: every opted-in FFmpeg job shares
 * bounded concurrency and queued work is selected by priority then FIFO.
 */
class MediaExecutionScheduler {
  private readonly waiting: MediaExecutionWaiter[] = []
  private active = 0
  private sequence = 0
  private disposed = false

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new ExtensionMediaJobError(
        'invalid_checkpoint',
        'Media scheduling concurrency must be from 1 through 16'
      )
    }
  }

  async acquire(priority: MediaJobPriority, signal: AbortSignal): Promise<MediaExecutionRelease> {
    if (signal.aborted) throw cancelledError()
    if (this.disposed) throw cancelledError('Media scheduler is shutting down')
    return await new Promise<MediaExecutionRelease>((resolve, reject) => {
      const waiter: MediaExecutionWaiter = {
        sequence: this.sequence++,
        priority,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(waiter)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(cancelledError())
        }
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.waiting.push(waiter)
      this.waiting.sort((left, right) =>
        MEDIA_PRIORITY_ORDER[right.priority] - MEDIA_PRIORITY_ORDER[left.priority] ||
        left.sequence - right.sequence)
      this.pump()
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const waiter of this.waiting.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.reject(cancelledError('Media scheduler is shutting down'))
    }
  }

  private pump(): void {
    while (!this.disposed && this.active < this.maxConcurrent && this.waiting.length > 0) {
      const waiter = this.waiting.shift()!
      waiter.signal.removeEventListener('abort', waiter.abort)
      if (waiter.signal.aborted) {
        waiter.reject(cancelledError())
        continue
      }
      this.active += 1
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        this.active -= 1
        this.pump()
      })
    }
  }
}

/** Bridges handle-confined FFmpeg execution into the durable core job state machine. */
export class ExtensionMediaJobService {
  private readonly unregisterExecutor: () => void
  private readonly pendingOutputs = new Map<string, ExtensionFfmpegOutputTransaction>()
  private readonly scheduler: MediaExecutionScheduler
  private readonly retryDelay: (delayMs: number, signal: AbortSignal) => Promise<void>

  constructor(private readonly options: {
    jobs: ExtensionJobService
    ffmpeg: ExtensionMediaFfmpegService
    media: ExtensionMediaProcessService
    artifacts: ExtensionArtifactService
    maxConcurrent?: number
    retryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>
  }) {
    this.scheduler = new MediaExecutionScheduler(options.maxConcurrent ?? 2)
    this.retryDelay = options.retryDelay ?? abortableDelay
    const executor: ExtensionJobCoreExecutor = {
      kind: MEDIA_FFMPEG_JOB_KIND,
      execute: async (snapshot, context) => {
        const request = parseCheckpoint(context.checkpoint?.data)
        const release = await this.scheduler.acquire(
          request.scheduling?.priority ?? inferredPriority(request),
          context.signal
        )
        try {
          const principal = executionPrincipal(snapshot, context.workspaceRoot)
          let transaction: ExtensionFfmpegOutputTransaction | undefined
          let generatedArtifacts: GeneratedArtifact[] = []
          try {
            transaction = await this.executeTransactionWithRetry(
              principal,
              request,
              snapshot.id,
              context
            )
            const provenanceMetadata = safeProvenanceMetadata(request.metadata)
            const artifactInputs: CreateGeneratedArtifactInput[] = []
            for (const generated of transaction.generatedMedia) {
              // A successful ffmpeg exit is insufficient: require bounded metadata
              // while the prior user target and handle state remain reversible.
              const validated = generated.mimeType === 'application/x-otio+json'
                ? validateGeneratedOtioOutput(generated, request)
                : validateGeneratedOutput(
                    generated,
                    await this.options.media.probe(principal, generated.id, { signal: context.signal })
                  )
              artifactInputs.push({
                workspaceId: snapshot.workspaceId,
                mediaHandleId: generated.id,
                ...(validated.width !== undefined ? { width: validated.width } : {}),
                ...(validated.height !== undefined ? { height: validated.height } : {}),
                ...(validated.durationMicros !== undefined
                  ? { durationMicros: validated.durationMicros }
                  : {}),
                provenance: {
                  jobId: snapshot.id,
                  operation: snapshot.initiatingOperation,
                  ...(provenanceMetadata ? { metadata: provenanceMetadata } : {})
                }
              })
            }
            context.signal.throwIfAborted()
            generatedArtifacts = await this.options.artifacts.createMany(principal, artifactInputs)
            if (this.pendingOutputs.has(snapshot.id)) {
              throw new ExtensionMediaJobError(
                'invalid_output',
                'Media output transaction is already pending for this job'
              )
            }
            this.pendingOutputs.set(snapshot.id, transaction)
            return {
              schemaVersion: 1,
              data: {
                outputs: transaction.generatedMedia.map((media) => ({
                  mediaHandleId: media.id,
                  displayName: media.displayName,
                  mimeType: media.mimeType
                }))
              } as JsonValue,
              generatedArtifacts
            }
          } catch (error) {
            const cleanupErrors: unknown[] = []
            if (generatedArtifacts.length > 0) {
              try {
                await this.options.artifacts.discardUncommittedJobArtifacts(
                  principal,
                  snapshot.id,
                  generatedArtifacts
                )
              } catch (cleanupError) {
                cleanupErrors.push(cleanupError)
              }
            }
            if (transaction !== undefined) {
              try {
                await transaction.rollback()
              } catch (cleanupError) {
                cleanupErrors.push(cleanupError)
              }
            }
            if (cleanupErrors.length > 0) {
              throw new ExtensionMediaJobError(
                'invalid_output',
                'Media output validation failed and cleanup did not finish safely'
              )
            }
            throw error
          }
        } finally {
          release()
        }
      },
      commitResult: async (snapshot) => {
        const transaction = this.pendingOutputs.get(snapshot.id)
        if (transaction === undefined) return
        await transaction.commit()
        this.pendingOutputs.delete(snapshot.id)
      },
      discardResult: async (snapshot, result, context) => {
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        const transaction = this.pendingOutputs.get(snapshot.id)
        const cleanupErrors: unknown[] = []
        try {
          await this.options.artifacts.discardUncommittedJobArtifacts(
            principal,
            snapshot.id,
            result.generatedArtifacts
          )
        } catch (error) {
          cleanupErrors.push(error)
        }
        if (transaction !== undefined) {
          try {
            await transaction.rollback()
          } catch (error) {
            cleanupErrors.push(error)
          } finally {
            this.pendingOutputs.delete(snapshot.id)
          }
        }
        if (cleanupErrors.length > 0) {
          throw new ExtensionMediaJobError(
            'invalid_output',
            'Media output transaction could not be discarded safely'
          )
        }
      },
      cancel: async (snapshot, context) => {
        // Active attempts are aborted and awaited by ExtensionJobService. A
        // checkpoint here means the process belonged to a previous runtime, so
        // this hook must reconcile its deterministic output transaction.
        if (context.checkpoint === undefined) return
        const request = parseCheckpoint(context.checkpoint.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        await this.options.ffmpeg.rollbackInterruptedTransaction(
          principal,
          request,
          snapshot.id
        )
      },
      recover: async (snapshot, checkpoint, context) => {
        const request = parseCheckpoint(checkpoint?.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        await this.options.ffmpeg.rollbackInterruptedTransaction(
          principal,
          request,
          snapshot.id
        )
        return 'interrupt' as const
      },
      recoverTerminal: async (snapshot, checkpoint, context) => {
        const request = parseCheckpoint(checkpoint?.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        if (snapshot.state === 'completed') {
          await this.options.ffmpeg.commitRecoveredTransaction(
            principal,
            request,
            snapshot.id
          )
          return
        }
        const cleanupErrors: unknown[] = []
        try {
          await this.options.ffmpeg.rollbackInterruptedTransaction(
            principal,
            request,
            snapshot.id
          )
        } catch (error) {
          cleanupErrors.push(error)
        }
        try {
          await this.options.artifacts.discardUncommittedJobArtifactsByJob(
            principal,
            snapshot.id
          )
        } catch (error) {
          cleanupErrors.push(error)
        }
        if (cleanupErrors.length > 0) {
          throw new ExtensionMediaJobError(
            'invalid_output',
            'Recovered terminal media cleanup did not finish safely'
          )
        }
      }
    }
    this.unregisterExecutor = options.jobs.registerCoreExecutor(executor)
  }

  private async executeTransactionWithRetry(
    principal: ExtensionPrincipal,
    request: MediaStartFfmpegJobRequest,
    operationId: string,
    context: Parameters<ExtensionJobCoreExecutor['execute']>[1]
  ): Promise<ExtensionFfmpegOutputTransaction> {
    const scheduling = request.scheduling ?? {
      priority: inferredPriority(request),
      maxAttempts: 1,
      retryBaseDelayMs: 250
    }
    for (let attempt = 1; attempt <= scheduling.maxAttempts; attempt += 1) {
      context.signal.throwIfAborted()
      try {
        return await this.options.ffmpeg.executeTransaction(principal, request, {
          // Reusing the durable job id is intentional. The FFmpeg transaction
          // fully rolls back before an explicitly transient retry; recovery can
          // therefore deterministically find the one possible staging identity.
          operationId,
          signal: context.signal,
          onProgress: (progress) => {
            void context.reportProgress(jobProgress(progress)).catch(() => undefined)
          }
        })
      } catch (error) {
        if (
          attempt >= scheduling.maxAttempts ||
          !isExplicitlyTransientMediaFailure(error) ||
          context.signal.aborted
        ) throw error
        const delayMs = retryDelayMs(scheduling.retryBaseDelayMs, attempt)
        await context.reportProgress({
          phase: `retry-backoff-${attempt}`,
          message: `Transient media admission failed; retrying attempt ${attempt + 1} of ${scheduling.maxAttempts}`
        })
        await this.retryDelay(delayMs, context.signal)
      }
    }
    throw new ExtensionMediaJobError('invalid_output', 'Media retry loop ended without an outcome')
  }

  async start(
    principal: ExtensionPrincipal,
    request: MediaStartFfmpegJobRequest
  ): Promise<JobReference> {
    assertAuthorized(principal)
    const input = MediaStartFfmpegJobRequestSchema.parse(request)
    if (principal.workspaceRoots.length !== 1) {
      throw new ExtensionMediaJobError(
        'workspace_denied',
        'Media jobs require exactly one active workspace scope'
      )
    }
    const workspaceRoot = principal.workspaceRoots[0]!
    const created = await this.options.jobs.createAndDispatch({
      owner: {
        extensionId: principal.extensionId,
        extensionVersion: principal.extensionVersion,
        workspaceId: extensionWorkspaceKey(workspaceRoot)
      },
      workspaceRoot,
      kind: MEDIA_FFMPEG_JOB_KIND,
      kindSchemaVersion: 1,
      initiatingOperation: 'media.startFfmpegJob',
      permissionsSnapshot: [...principal.permissions],
      ...(input.idempotencyKey ? { idempotencyKey: boundIdempotencyKey(input) } : {}),
      checkpoint: { schemaVersion: 1, data: input as JsonValue }
    })
    return reference(created.snapshot)
  }

  dispose(): void {
    this.scheduler.dispose()
    this.unregisterExecutor()
    for (const transaction of this.pendingOutputs.values()) {
      void transaction.rollback().catch(() => undefined)
    }
    this.pendingOutputs.clear()
  }
}

function parseCheckpoint(value: JsonValue | undefined): MediaStartFfmpegJobRequest {
  const parsed = MediaStartFfmpegJobRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ExtensionMediaJobError('invalid_checkpoint', 'Media job checkpoint is invalid')
  }
  return parsed.data
}

function validateGeneratedOutput(
  generated: {
    id: string
    mimeType: string
    byteSize?: number
    completionIdentity?: string
  },
  probe: MediaProbeResult
): { width?: number; height?: number; durationMicros?: number } {
  if (probe.handleId !== generated.id || !Number.isSafeInteger(generated.byteSize) ||
    Number(generated.byteSize) <= 0 || !generated.completionIdentity) {
    throw invalidOutput('Generated media identity is incomplete')
  }
  const durationMicros = positiveDurationMicros(probe)
  if (generated.mimeType.startsWith('video/')) {
    const video = probe.streams.find((stream) => stream.kind === 'video')
    if (!video || durationMicros === undefined) {
      throw invalidOutput('Generated video is missing a video stream or positive duration')
    }
    return {
      ...(video.width !== undefined ? { width: video.width } : {}),
      ...(video.height !== undefined ? { height: video.height } : {}),
      durationMicros
    }
  }
  if (generated.mimeType.startsWith('audio/')) {
    if (!probe.streams.some((stream) => stream.kind === 'audio') || durationMicros === undefined) {
      throw invalidOutput('Generated audio is missing an audio stream or positive duration')
    }
    return { durationMicros }
  }
  if (generated.mimeType.startsWith('image/')) {
    const image = probe.streams.find((stream) =>
      stream.kind === 'video' && stream.width !== undefined && stream.height !== undefined)
    if (!image) throw invalidOutput('Generated image is missing a bounded image stream')
    return { width: image.width, height: image.height }
  }
  if (generated.mimeType === 'application/x-subrip' || generated.mimeType === 'text/vtt') {
    const expectedFormat = generated.mimeType === 'application/x-subrip' ? 'srt' : 'webvtt'
    if (!probe.container.formatNames.includes(expectedFormat) ||
      !probe.streams.some((stream) => stream.kind === 'subtitle')) {
      throw invalidOutput('Generated subtitle is missing its expected subtitle stream')
    }
    // ffprobe commonly omits duration for standalone SRT/WebVTT. The Host has
    // already enforced a non-empty, bounded file and an actual subtitle stream.
    return durationMicros === undefined ? {} : { durationMicros }
  }
  throw invalidOutput('Generated output MIME type is not supported for artifact publication')
}

function validateGeneratedOtioOutput(
  generated: {
    id: string
    mimeType: string
    byteSize?: number
    completionIdentity?: string
  },
  request: MediaStartFfmpegJobRequest
): { width?: number; height?: number; durationMicros?: number } {
  if (!Number.isSafeInteger(generated.byteSize) || Number(generated.byteSize) <= 0 ||
    !generated.completionIdentity) {
    throw invalidOutput('Generated OpenTimelineIO document identity is incomplete')
  }
  const candidates = Object.values(request.textOutputs ?? {}).filter((output) =>
    output.mimeType === 'application/x-otio+json' &&
    Buffer.byteLength(output.content, 'utf8') === generated.byteSize
  )
  if (candidates.length === 0) {
    throw invalidOutput('Generated OpenTimelineIO document does not match its declared bounded content')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(candidates[0]!.content)
  } catch {
    throw invalidOutput('Generated OpenTimelineIO document is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    !['SerializableCollection.1', 'Timeline.1']
      .includes(String((parsed as Record<string, unknown>).OTIO_SCHEMA))) {
    throw invalidOutput('Generated OpenTimelineIO document root schema is invalid')
  }
  return {}
}

function positiveDurationMicros(probe: MediaProbeResult): number | undefined {
  const values = [
    probe.container.durationMicros,
    ...probe.streams.map((stream) => stream.durationMicros)
  ].filter((value): value is number => value !== undefined && value > 0)
  return values.length === 0 ? undefined : Math.max(...values)
}

function safeProvenanceMetadata(
  value: MediaStartFfmpegJobRequest['metadata']
): GeneratedArtifact['provenance']['metadata'] | undefined {
  if (!value) return undefined
  const metadata: NonNullable<GeneratedArtifact['provenance']['metadata']> = {}
  if (typeof value.projectId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.projectId)) {
    metadata.projectId = value.projectId
  }
  if (Number.isSafeInteger(value.pinnedRevision) && Number(value.pinnedRevision) >= 0) {
    metadata.pinnedRevision = Number(value.pinnedRevision)
  }
  if (typeof value.sequenceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.sequenceId)) {
    metadata.sequenceId = value.sequenceId
  }
  if (value.interchangeAdapterId === 'kun.otio-json') {
    metadata.interchangeAdapterId = value.interchangeAdapterId
  }
  if (typeof value.interchangeAdapterVersion === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.interchangeAdapterVersion)) {
    metadata.interchangeAdapterVersion = value.interchangeAdapterVersion
  }
  for (const key of ['documentDigest', 'projectDigest'] as const) {
    const digest = value[key]
    if (typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest)) metadata[key] = digest
  }
  if (Number.isSafeInteger(value.lossCount) && Number(value.lossCount) >= 0 && Number(value.lossCount) <= 128) {
    metadata.lossCount = Number(value.lossCount)
  }
  if (typeof value.portableLossless === 'boolean') metadata.portableLossless = value.portableLossless
  if (typeof value.kunRoundTripLossless === 'boolean') metadata.kunRoundTripLossless = value.kunRoundTripLossless
  if (value.renderKind === 'proof-frame' || value.renderKind === 'preview' ||
    value.renderKind === 'h264-mp4' || value.renderKind === 'h265-mp4' ||
    value.renderKind === 'prores-mov' || value.renderKind === 'ffv1-mkv' ||
    value.renderKind === 'audio-aac' ||
    value.renderKind === 'subtitles') {
    metadata.renderKind = value.renderKind
  }
  if (value.requestedRenderKind === 'h264-mp4' || value.requestedRenderKind === 'h265-mp4' ||
    value.requestedRenderKind === 'prores-mov') {
    metadata.requestedRenderKind = value.requestedRenderKind
  }
  for (const key of [
    'renderIrDigest',
    'backendCapabilitiesDigest',
    'advancedSettingsDigest',
    'advancedCapabilitiesDigest',
    'effectSemanticsDigest'
  ] as const) {
    const digest = value[key]
    if (typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest)) metadata[key] = digest
  }
  if (typeof value.portableEquivalent === 'boolean') {
    metadata.portableEquivalent = value.portableEquivalent
  }
  const renderRange = value.renderRange
  if (
    renderRange && typeof renderRange === 'object' && !Array.isArray(renderRange) &&
    Number.isSafeInteger(renderRange.startFrame) && Number(renderRange.startFrame) >= 0 &&
    Number.isSafeInteger(renderRange.endFrame) &&
    Number(renderRange.endFrame) > Number(renderRange.startFrame)
  ) {
    metadata.renderRange = {
      startFrame: Number(renderRange.startFrame),
      endFrame: Number(renderRange.endFrame)
    }
  }
  if (value.playbackMode === 'source-fast-path' || value.playbackMode === 'composed-proof') {
    metadata.playbackMode = value.playbackMode
  }
  if (value.canvasPreset === '16:9' || value.canvasPreset === '9:16' ||
    value.canvasPreset === '1:1') {
    metadata.canvasPreset = value.canvasPreset
  }
  if (Number.isSafeInteger(value.proofFrame) && Number(value.proofFrame) >= 0) {
    metadata.proofFrame = Number(value.proofFrame)
  }
  if (value.captionMode === 'none' || value.captionMode === 'burned' ||
    value.captionMode === 'sidecar' || value.captionMode === 'both') {
    metadata.captionMode = value.captionMode
  }
  if (value.subtitleFormat === 'srt' || value.subtitleFormat === 'vtt') {
    metadata.subtitleFormat = value.subtitleFormat
  }
  if (typeof value.derivedId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.derivedId)) {
    metadata.derivedId = value.derivedId
  }
  if (typeof value.assetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.assetId)) {
    metadata.assetId = value.assetId
  }
  if (typeof value.dedupeKey === 'string' && /^[a-f0-9]{64}$/u.test(value.dedupeKey)) {
    metadata.dedupeKey = value.dedupeKey
  }
  if (
    value.derivedKind === 'waveform' || value.derivedKind === 'thumbnail' ||
    value.derivedKind === 'filmstrip' || value.derivedKind === 'proxy' ||
    value.derivedKind === 'proof' || value.derivedKind === 'preview'
  ) {
    metadata.derivedKind = value.derivedKind
  }
  if (typeof value.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(value.sourceFingerprint)) {
    metadata.sourceFingerprint = value.sourceFingerprint
  }
  if (typeof value.producerId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.producerId)) {
    metadata.producerId = value.producerId
  }
  if (typeof value.producerVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(value.producerVersion)) {
    metadata.producerVersion = value.producerVersion
  }
  if (
    value.priority === 'background' || value.priority === 'user' ||
    value.priority === 'interactive' || value.priority === 'export'
  ) metadata.priority = value.priority
  if (typeof value.derivedPhase === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value.derivedPhase)) {
    metadata.derivedPhase = value.derivedPhase
  }
  if (Number.isSafeInteger(value.derivedPhaseIndex) && Number(value.derivedPhaseIndex) >= 0 && Number(value.derivedPhaseIndex) <= 16) {
    metadata.derivedPhaseIndex = Number(value.derivedPhaseIndex)
  }
  if (Number.isSafeInteger(value.derivedPhaseCount) && Number(value.derivedPhaseCount) >= 1 && Number(value.derivedPhaseCount) <= 16) {
    metadata.derivedPhaseCount = Number(value.derivedPhaseCount)
  }
  return Object.keys(metadata).length === 0 ? undefined : metadata
}

function invalidOutput(message: string): ExtensionMediaJobError {
  return new ExtensionMediaJobError('invalid_output', message)
}

function executionPrincipal(
  snapshot: ExtensionJobSnapshot,
  workspaceRoot: string
): ExtensionPrincipal {
  return {
    extensionId: snapshot.ownerExtensionId,
    extensionVersion: snapshot.ownerExtensionVersion,
    permissions: [...REQUIRED_PERMISSIONS],
    workspaceRoots: [workspaceRoot],
    workspaceTrusted: true
  }
}

function assertAuthorized(principal: ExtensionPrincipal): void {
  if (!principal.workspaceTrusted) {
    throw new ExtensionMediaJobError('workspace_denied', 'Workspace is not trusted')
  }
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!principal.permissions.includes(permission)) {
      throw new ExtensionMediaJobError('permission_denied', `Missing permission: ${permission}`)
    }
  }
}

function jobProgress(progress: ExtensionFfmpegProgress) {
  return {
    phase: progress.terminal ? 'finalizing' : 'encoding',
    ...(progress.outputBytes !== undefined ? {
      completed: progress.outputBytes,
      unit: 'bytes'
    } : {}),
    message: progress.terminal ? 'Validating generated media' : 'Encoding media'
  }
}

function inferredPriority(request: MediaStartFfmpegJobRequest): MediaJobPriority {
  const renderKind = request.metadata?.renderKind
  if (renderKind === 'proof-frame' || renderKind === 'preview') return 'interactive'
  if (typeof renderKind === 'string') return 'export'
  return 'user'
}

/**
 * Bind core idempotency to the complete normalized broker request. A caller
 * reusing a friendly key with changed handles, arguments, metadata, revision,
 * source identity, or scheduling policy cannot alias the earlier durable job.
 */
function boundIdempotencyKey(request: MediaStartFfmpegJobRequest): string {
  const { idempotencyKey, ...operation } = request
  return `ffmpeg:${createHash('sha256')
    .update(idempotencyKey ?? '')
    .update('\0')
    .update(canonicalJson(operation))
    .digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function isExplicitlyTransientMediaFailure(error: unknown): boolean {
  // Validation, process exit codes, output validation, publication, and any
  // unknown error may have side effects and are never retried automatically.
  return error instanceof ExtensionMediaProcessError && error.retryable === true &&
    (error.code === 'executable_unavailable' || error.code === 'process_timeout')
}

function retryDelayMs(baseDelayMs: number, failedAttempt: number): number {
  return Math.min(
    MAX_MEDIA_RETRY_DELAY_MS,
    baseDelayMs * 2 ** Math.min(8, Math.max(0, failedAttempt - 1))
  )
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw cancelledError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    timer.unref?.()
    const abort = () => {
      clearTimeout(timer)
      reject(cancelledError())
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function cancelledError(message = 'Media scheduling was cancelled'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function reference(snapshot: ExtensionJobSnapshot): JobReference {
  return {
    jobId: snapshot.id,
    kind: snapshot.kind,
    state: snapshot.state,
    cursor: snapshot.latestCursor
  }
}
