import {
  MediaAudioAnalysisResultSchema,
  type Disposable,
  type ExtensionContext,
  type JobProgress,
  type JobSnapshot,
  type MediaAudioAnalysisCapabilities,
  type MediaAudioAnalysisResult,
  type MediaStartAudioAnalysisJobRequest,
  type MediaVisualModelStatus
} from '@kun/extension-api'
import type {
  BeatObservation,
  VisualEmbeddingEvidence,
  VisualModelDescriptor,
  VisualModelInstallReceipt,
  SourceIdentity,
  VadFrameEvidence
} from '../engine/index.js'
import type { LocalMediaIntelligenceBroker } from './media-intelligence-service.js'

export class KunAudioAnalysisUnavailableError extends Error {
  readonly networkUsed = false

  constructor(
    readonly code: string,
    readonly remediation: string,
    readonly retryable: boolean
  ) {
    super(remediation)
    this.name = 'KunAudioAnalysisUnavailableError'
  }
}

export class KunAudioAnalysisJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'KunAudioAnalysisJobError'
  }
}

export class KunVisualAnalysisUnavailableError extends Error {
  readonly networkUsed = false

  constructor(
    readonly code: string,
    readonly remediation: string,
    readonly retryable: boolean
  ) {
    super(remediation)
    this.name = 'KunVisualAnalysisUnavailableError'
  }
}

/**
 * Public Extension API adapter for the video editor's existing local media
 * intelligence contract. It receives only opaque handles and bounded JSON;
 * Kun owns native process execution, durable progress, cancellation, and
 * source-identity calculation.
 */
export class KunLocalAudioAnalysisBroker implements LocalMediaIntelligenceBroker {
  readonly id = 'kun.host.audio-analysis'
  readonly version = '1.0.0'

  constructor(private readonly context: ExtensionContext) {}

  capabilities(): Promise<MediaAudioAnalysisCapabilities> {
    return this.context.media.getAudioAnalysisCapabilities()
  }

  denoiseMetadataCapability: NonNullable<LocalMediaIntelligenceBroker['denoiseMetadataCapability']> = async () => ({
    outcome: 'unavailable',
    code: 'denoise_metadata_algorithm_unavailable',
    remediation: 'This Kun Extension API exposes no verified local noise-profile analyzer yet. No media was uploaded or modified, and no denoise levels were fabricated.',
    retryable: false,
    local: true,
    networkUsed: false
  })

  validateMediaGrant: NonNullable<LocalMediaIntelligenceBroker['validateMediaGrant']> = async (mediaHandleId) => {
    try {
      const metadata = await this.context.media.stat({ handleId: mediaHandleId })
      return metadata.mode === 'read' && !metadata.revoked
    } catch {
      return false
    }
  }

  visualModelStatus: NonNullable<LocalMediaIntelligenceBroker['visualModelStatus']> = async () => {
    const [status, media] = await Promise.all([
      this.context.media.getVisualModelStatus(),
      this.context.media.getCapabilities()
    ])
    const projected = visualBrokerStatus(status)
    if (!media.ffmpeg.available || !media.ffprobe.available) {
      return {
        ...projected,
        state: 'failed',
        receipt: undefined,
        remediation: 'The signed local visual package is present, but verified frame decoding requires FFmpeg and FFprobe in a reviewed Kun Host location.'
      }
    }
    return projected
  }

  requestVisualModelInstall: NonNullable<LocalMediaIntelligenceBroker['requestVisualModelInstall']> = async ({ signal }) => {
    signal.throwIfAborted()
    await this.context.media.installVisualModel()
    signal.throwIfAborted()
    return await this.visualModelStatus()
  }

  indexVisual: NonNullable<LocalMediaIntelligenceBroker['indexVisual']> = async ({
    mediaHandleId,
    samples,
    adapter,
    signal,
    report
  }) => {
    const embeddings: VisualEmbeddingEvidence[] = []
    for (let offset = 0; offset < samples.length; offset += 16) {
      signal.throwIfAborted()
      const batch = samples.slice(offset, offset + 16)
      const result = await this.context.media.analyzeVisualFrames({
        inputHandleId: mediaHandleId,
        samples: batch.map((sample) => ({
          sampleId: sample.id,
          startMicros: sample.startUs,
          endMicros: sample.endUs,
          representativeMicros: sample.representativeUs
        })),
        adapter
      }, { signal, timeoutMs: 60_000 })
      if (result.outcome === 'unavailable') {
        throw new KunVisualAnalysisUnavailableError(
          result.code,
          result.remediation,
          result.retryable
        )
      }
      embeddings.push(...result.embeddings.map((embedding) => ({
        sampleId: embedding.sampleId,
        vector: [...embedding.vector]
      })))
      await report(
        Math.min(samples.length, offset + batch.length),
        samples.length,
        'Measured verified local visual frame features'
      )
    }
    return embeddings
  }

  embedVisualQuery: NonNullable<LocalMediaIntelligenceBroker['embedVisualQuery']> = async ({
    query,
    adapter,
    signal
  }) => {
    signal.throwIfAborted()
    const result = await this.context.media.embedVisualQuery(
      { query, adapter },
      { signal, timeoutMs: 30_000 }
    )
    if (result.outcome === 'unavailable') {
      throw new KunVisualAnalysisUnavailableError(
        result.code,
        result.remediation,
        result.retryable
      )
    }
    return [...result.vector]
  }

  analyzeVad: NonNullable<LocalMediaIntelligenceBroker['analyzeVad']> = async ({
    mediaHandleId,
    signal,
    report
  }) => {
    const result = await this.startAndWait({
      analysis: 'silence',
      inputHandleId: mediaHandleId,
      idempotencyKey: boundedIdempotencyKey(`silence:${mediaHandleId}`)
    }, signal, report)
    if (result.analysis !== 'silence') throw mismatchedResult('silence')
    return {
      frames: silenceFrames(result.intervals, result.analyzedDurationMicros),
      completeness: result.truncated ? 'partial' : 'complete',
      sourceFingerprint: sourceFingerprint(result.source.fingerprint)
    }
  }

  analyzeBeats: NonNullable<LocalMediaIntelligenceBroker['analyzeBeats']> = async ({
    mediaHandleId,
    signal,
    report
  }) => {
    const result = await this.startAndWait({
      analysis: 'beat-grid',
      inputHandleId: mediaHandleId,
      idempotencyKey: boundedIdempotencyKey(`beat-grid:${mediaHandleId}`)
    }, signal, report)
    if (result.analysis !== 'beat-grid') throw mismatchedResult('beat-grid')
    const observations: BeatObservation[] = result.markers.map((marker, index) => ({
      id: `host-beat-${String(index + 1).padStart(6, '0')}`,
      timeUs: marker.timeMicros,
      strength: marker.strength,
      beatProbability: marker.confidence,
      ...(marker.kind === 'downbeat' ? { downbeatProbability: marker.confidence } : {})
    }))
    return {
      observations,
      ...(result.tempoBpm === undefined ? {} : { tempoBpm: result.tempoBpm }),
      completeness: result.truncated ? 'partial' : 'complete',
      sourceFingerprint: sourceFingerprint(result.source.fingerprint)
    }
  }

  extractSyncFeatures: NonNullable<LocalMediaIntelligenceBroker['extractSyncFeatures']> = async ({
    referenceHandleId,
    targetHandleId,
    seed,
    signal,
    report
  }) => {
    const result = await this.startAndWait({
      analysis: 'sync-features',
      referenceHandleId,
      targetHandleId,
      seed,
      idempotencyKey: boundedIdempotencyKey(`sync:${referenceHandleId}:${targetHandleId}:${seed}`)
    }, signal, report)
    if (result.analysis !== 'sync-features') throw mismatchedResult('sync-features')
    if (
      result.reference.handleId !== referenceHandleId ||
      result.target.handleId !== targetHandleId ||
      result.seed !== seed
    ) {
      throw new KunAudioAnalysisJobError(
        'AUDIO_ANALYSIS_RESULT_MISMATCH',
        'Local synchronization evidence does not match the requested handles and seed',
        false
      )
    }
    return {
      referenceFeatures: [...result.referenceFeatures],
      targetFeatures: [...result.targetFeatures],
      samplePeriodUs: result.samplePeriodMicros,
      referenceFingerprint: sourceFingerprint(result.reference.fingerprint),
      targetFingerprint: sourceFingerprint(result.target.fingerprint)
    }
  }

  private async startAndWait(
    request: MediaStartAudioAnalysisJobRequest,
    signal: AbortSignal,
    report: (completed: number, total: number, message?: string) => Promise<void>
  ): Promise<MediaAudioAnalysisResult> {
    signal.throwIfAborted()
    const started = await this.context.media.startAudioAnalysisJob(request)
    if (started.outcome === 'unavailable') {
      throw new KunAudioAnalysisUnavailableError(
        started.code,
        started.remediation,
        started.retryable
      )
    }
    const subscription = await this.context.jobs.subscribe({ jobId: started.job.jobId })
    try {
      const snapshot = await waitForTerminal(
        this.context,
        subscription,
        signal,
        report
      )
      if (snapshot.state !== 'completed' || snapshot.result?.data === undefined) {
        if (signal.aborted || snapshot.state === 'cancelled') throw abortError()
        throw new KunAudioAnalysisJobError(
          snapshot.error?.code ?? 'AUDIO_ANALYSIS_JOB_INCOMPLETE',
          snapshot.error?.message ?? `Local audio-analysis job ended as ${snapshot.state}`,
          snapshot.error?.retryable ?? snapshot.state === 'interrupted'
        )
      }
      return MediaAudioAnalysisResultSchema.parse(snapshot.result.data)
    } finally {
      await subscription.dispose()
    }
  }
}

async function waitForTerminal(
  context: ExtensionContext,
  subscription: Awaited<ReturnType<ExtensionContext['jobs']['subscribe']>>,
  signal: AbortSignal,
  report: (completed: number, total: number, message?: string) => Promise<void>
): Promise<JobSnapshot> {
  if (isTerminal(subscription.snapshot)) return subscription.snapshot
  return await new Promise<JobSnapshot>((resolve, reject) => {
    let settled = false
    let listener: Disposable | undefined
    let progress = Promise.resolve()
    let progressFailure: unknown
    const cleanup = (): void => {
      listener?.dispose()
      signal.removeEventListener('abort', cancel)
    }
    const settle = (operation: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      void progress.then(() => progressFailure === undefined ? operation() : reject(progressFailure))
    }
    const cancel = (): void => {
      void context.jobs.cancel({
        jobId: subscription.snapshot.id,
        reason: 'local-media-analysis-cancelled'
      }).catch(() => undefined)
      settle(() => reject(abortError()))
    }
    signal.addEventListener('abort', cancel, { once: true })
    listener = subscription.onEvent((event) => {
      if (event.progress) {
        progress = progress
          .then(() => reportProgress(event.progress!, report))
          .catch((error: unknown) => { progressFailure ??= error })
      }
      if (isTerminalState(event.state)) {
        settle(() => resolve(subscription.snapshot))
      }
    })
    if (settled) {
      listener.dispose()
      return
    }
    if (subscription.snapshot.progress) {
      progress = progress
        .then(() => reportProgress(subscription.snapshot.progress!, report))
        .catch((error: unknown) => { progressFailure ??= error })
    }
    if (isTerminal(subscription.snapshot)) settle(() => resolve(subscription.snapshot))
    if (signal.aborted) cancel()
  })
}

async function reportProgress(
  progress: JobProgress,
  report: (completed: number, total: number, message?: string) => Promise<void>
): Promise<void> {
  if (
    Number.isSafeInteger(progress.completed) &&
    Number.isSafeInteger(progress.total) &&
    Number(progress.total) > 0
  ) {
    await report(
      Number(progress.completed),
      Number(progress.total),
      progress.message
    )
    return
  }
  if (progress.percentage !== undefined) {
    await report(Math.round(progress.percentage), 100, progress.message)
  }
}

function silenceFrames(
  intervals: readonly { startMicros: number; endMicros: number }[],
  durationMicros: number
): VadFrameEvidence[] {
  const frames: VadFrameEvidence[] = []
  let cursor = 0
  let sequence = 0
  const append = (startUs: number, endUs: number, speechProbability: number): void => {
    if (endUs <= startUs) return
    sequence += 1
    frames.push({
      id: `host-vad-${String(sequence).padStart(6, '0')}`,
      startUs,
      endUs,
      // This is an explicit binary threshold classifier, not a calibrated
      // probabilistic model. Runtime provenance preserves that distinction.
      speechProbability
    })
  }
  for (const interval of intervals) {
    append(cursor, interval.startMicros, 1)
    append(interval.startMicros, interval.endMicros, 0)
    cursor = interval.endMicros
  }
  append(cursor, durationMicros, 1)
  return frames
}

function visualBrokerStatus(status: MediaVisualModelStatus): {
  schemaVersion: 1
  state: 'missing' | 'installed' | 'failed'
  descriptor: VisualModelDescriptor
  receipt?: VisualModelInstallReceipt
  installSupported: boolean
  checkedAt: string
  remediation: string
} {
  return {
    schemaVersion: 1,
    state: status.state,
    descriptor: {
      adapterId: status.descriptor.adapterId,
      adapterVersion: status.descriptor.adapterVersion,
      modelId: status.descriptor.modelId,
      modelVersion: status.descriptor.modelVersion,
      packageId: status.descriptor.packageId,
      manifestSha256: status.descriptor.manifestSha256,
      files: status.descriptor.files.map((file) => ({ ...file })),
      embeddingDimensions: status.descriptor.embeddingDimensions
    },
    ...(status.receipt ? {
      receipt: {
        broker: status.receipt.broker,
        packageSource: status.receipt.packageSource,
        packageId: status.receipt.packageId,
        modelId: status.receipt.modelId,
        modelVersion: status.receipt.modelVersion,
        manifestSha256: status.receipt.manifestSha256,
        files: status.receipt.files.map((file) => ({ ...file })),
        downloadVerified: status.receipt.downloadVerified,
        sourceVerified: status.receipt.sourceVerified,
        installVerified: status.receipt.installVerified,
        signatureVerified: status.receipt.signatureVerified,
        installedAt: status.receipt.installedAt
      }
    } : {}),
    installSupported: status.installSupported,
    checkedAt: status.checkedAt,
    remediation: status.remediation
  }
}

function sourceFingerprint(value: string): SourceIdentity {
  return { algorithm: 'sha256', value }
}

function boundedIdempotencyKey(value: string): string {
  return value.length <= 256 ? value : `${value.slice(0, 127)}:${value.slice(-128)}`
}

function mismatchedResult(expected: string): KunAudioAnalysisJobError {
  return new KunAudioAnalysisJobError(
    'AUDIO_ANALYSIS_RESULT_MISMATCH',
    `Local audio-analysis job did not return ${expected} evidence`,
    false
  )
}

function isTerminal(snapshot: JobSnapshot): boolean {
  return isTerminalState(snapshot.state)
}

function isTerminalState(state: JobSnapshot['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function abortError(): Error {
  const error = new Error('Local audio analysis cancelled')
  error.name = 'AbortError'
  return error
}
