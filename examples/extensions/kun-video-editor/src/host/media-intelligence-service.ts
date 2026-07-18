import type {
  ExtensionContext,
  JsonObject,
  JsonValue,
  MediaAudioAnalysisCapabilities
} from '@kun/extension-api'
import {
  containsAsciiControlCharacters,
  replaceAsciiControlCharacters
} from '../text-safety.js'
import {
  SpeakerIdentityRegistry,
  SpeakerRegistry,
  VisualIndexProgressTracker,
  analyzeAudioSynchronization,
  audioSyncAnalysisId,
  analyzeBeatEvidence,
  analyzeVadEvidence,
  buildFrameSamplingPlan,
  createVisualIndexRecord,
  combineAudioSourceFingerprints,
  createDenoiseMetadataRecord,
  diarizeSpeakerEvidence,
  defaultSpeakerDiarizationAdapterRegistry,
  fingerprintAssetIdentity,
  importSpeakerDiarizationEvidence,
  isValidVisualIndexRecord,
  isValidDenoiseMetadataAdapterDescriptor,
  isValidDenoiseMetadataRecord,
  negotiateSpeakerAdapter,
  negotiateVisualAdapter,
  readMediaIntelligenceEvidence,
  searchProjectMedia,
  searchVisualMoments,
  verifyVisualModelInstallation,
  type AudioSyncAnalysis,
  type BeatAnalysisRecord,
  type BeatObservation,
  type DiarizationRecord,
  type DiarizationTurnEvidence,
  type DenoiseMetadataCapability,
  type DenoiseMetadataRecord,
  type DenoiseNoiseProfileEvidence,
  type MediaSearchPage,
  type MediaSearchRequest,
  type SourceIdentity,
  type ImportedDiarizationTurn,
  type SpeakerDiarizationAdapterStatus,
  type SpeakerIdentity,
  type SpeakerModelDescriptor,
  type VadAnalysisRecord,
  type VadFrameEvidence,
  type VideoProject,
  type VisualEmbeddingEvidence,
  type VisualIndexRecord,
  type VisualModelDescriptor,
  type VisualModelInstallReceipt,
  type VisualMomentPage
} from '../engine/index.js'

const RECORD_PREFIX = 'media-intelligence:record:'
const GRANT_BINDING_PREFIX = 'media-intelligence:grant-binding:'
const VISUAL_OPT_IN_KEY = 'media-intelligence:visual-opt-in'
const SPEAKER_REGISTRY_PREFIX = 'media-intelligence:speaker-registry:'
const MAX_RECORDS = 512

export type VisualModelBrokerStatus = {
  schemaVersion: 1
  state: 'missing' | 'downloading' | 'installed' | 'failed'
  descriptor: VisualModelDescriptor
  receipt?: VisualModelInstallReceipt
  installSupported: boolean
  checkedAt: string
  remediation: string
}

export type VisualProvisioningState = {
  schemaVersion: 1
  optIn: boolean
  state: 'disabled' | 'broker-unavailable' | 'missing' | 'downloading' | 'unverified' | 'inference-unavailable' | 'ready' | 'failed'
  code:
    | 'visual_model_disabled'
    | 'visual_model_broker_unavailable'
    | 'visual_model_missing'
    | 'visual_model_downloading'
    | 'visual_model_unverified'
    | 'visual_inference_broker_unavailable'
    | 'visual_model_ready'
    | 'visual_model_install_failed'
  installSupported: boolean
  packageSource?: 'bundled' | 'downloaded'
  model?: {
    adapterId: string
    adapterVersion: string
    packageId: string
    modelId: string
    modelVersion: string
    embeddingDimensions: number
    manifestSha256: string
  }
  verification: {
    brokerAttested: boolean
    downloadVerified: boolean
    sourceVerified: boolean
    installVerified: boolean
    signatureVerified: boolean
    manifestVerified: boolean
    errors: string[]
  }
  local: true
  networkUsedForInference: false
  rawPathsExposed: false
  urlsAccepted: false
  remediation: string
  checkedAt: string
}

export type MediaIntelligenceProgress = {
  schemaVersion: 1
  operationId: string
  projectId: string
  projectRevision: number
  kind: 'visual-index' | 'vad' | 'speaker' | 'beats' | 'denoise-metadata' | 'audio-sync'
  generation: number
  status: 'queued' | 'running' | 'cancelled' | 'ready' | 'failed'
  completed: number
  total: number
  message?: string
  error?: { code: string; message: string; retryable: boolean }
}

export type LocalMediaIntelligenceBroker = {
  readonly id: string
  readonly version: string
  validateMediaGrant?(mediaHandleId: string): Promise<boolean>
  capabilities?(): Promise<MediaAudioAnalysisCapabilities>
  denoiseMetadataCapability?(): Promise<DenoiseMetadataCapability>
  visualModelStatus?(): Promise<VisualModelBrokerStatus>
  requestVisualModelInstall?(request: {
    signal: AbortSignal
  }): Promise<VisualModelBrokerStatus>
  indexVisual?(request: {
    mediaHandleId: string
    samples: ReturnType<typeof buildFrameSamplingPlan>['samples']
    adapter: Extract<ReturnType<typeof negotiateVisualAdapter>, { outcome: 'ready' }>['adapter']
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<VisualEmbeddingEvidence[]>
  embedVisualQuery?(request: {
    query: string
    adapter: VisualIndexRecord['adapter']
    signal: AbortSignal
  }): Promise<number[]>
  analyzeVad?(request: {
    mediaHandleId: string
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<{
    frames: VadFrameEvidence[]
    completeness: 'complete' | 'partial'
    sourceFingerprint?: SourceIdentity
  }>
  diarize?(request: {
    mediaHandleId: string
    adapter: Extract<ReturnType<typeof negotiateSpeakerAdapter>, { outcome: 'ready' }>['adapter']
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<{ turns: DiarizationTurnEvidence[]; completeness: 'complete' | 'partial' }>
  analyzeBeats?(request: {
    mediaHandleId: string
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<{
    observations: BeatObservation[]
    tempoBpm?: number
    completeness: 'complete' | 'partial'
    sourceFingerprint?: SourceIdentity
  }>
  analyzeDenoiseMetadata?(request: {
    mediaHandleId: string
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<{
    evidence: DenoiseNoiseProfileEvidence
    sourceFingerprint: SourceIdentity
  }>
  extractSyncFeatures?(request: {
    referenceHandleId: string
    targetHandleId: string
    seed: number
    signal: AbortSignal
    report(completed: number, total: number, message?: string): Promise<void>
  }): Promise<{
    referenceFeatures: number[]
    targetFeatures: number[]
    samplePeriodUs: number
    referenceFingerprint?: SourceIdentity
    targetFingerprint?: SourceIdentity
  }>
}

export type IntelligenceRecord =
  | VisualIndexRecord
  | VadAnalysisRecord
  | DiarizationRecord
  | BeatAnalysisRecord
  | DenoiseMetadataRecord
  | AudioSyncAnalysis

type Operation = {
  controller: AbortController
  progress: MediaIntelligenceProgress
  detachExternalCancellation?: () => void
}

export class MediaIntelligenceService {
  private readonly operations = new Map<string, Operation>()
  private sequence = 0

  constructor(
    private readonly context: ExtensionContext,
    private readonly broker?: LocalMediaIntelligenceBroker
  ) {}

  search(project: VideoProject, request: MediaSearchRequest): MediaSearchPage {
    return searchProjectMedia(project, request)
  }

  visualCapability(input: {
    optIn: boolean
    descriptor: VisualModelDescriptor
    receipt?: VisualModelInstallReceipt
  }): ReturnType<typeof negotiateVisualAdapter> {
    return negotiateVisualAdapter({
      ...input,
      inferenceBrokerAvailable: Boolean(this.broker?.indexVisual && this.broker?.embedVisualQuery)
    })
  }

  async visualProvisioning(): Promise<VisualProvisioningState> {
    return (await this.resolveVisualProvisioning()).projection
  }

  async setVisualOptIn(optIn: boolean): Promise<VisualProvisioningState> {
    await this.context.storage.workspace.set(VISUAL_OPT_IN_KEY, {
      schemaVersion: 1,
      optIn
    })
    return await this.visualProvisioning()
  }

  async requestVisualModelInstall(signal?: AbortSignal): Promise<
    | { outcome: 'ready'; capability: VisualProvisioningState }
    | { outcome: 'unavailable'; capability: VisualProvisioningState }
  > {
    const before = await this.resolveVisualProvisioning()
    if (before.capability?.outcome === 'ready') {
      return { outcome: 'ready', capability: before.projection }
    }
    if (!before.projection.optIn || !this.broker?.requestVisualModelInstall) {
      return { outcome: 'unavailable', capability: before.projection }
    }
    const controller = new AbortController()
    const cancel = (): void => controller.abort()
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
    try {
      await this.broker.requestVisualModelInstall({ signal: controller.signal })
      const after = await this.resolveVisualProvisioning()
      return after.capability?.outcome === 'ready'
        ? { outcome: 'ready', capability: after.projection }
        : { outcome: 'unavailable', capability: after.projection }
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  async audioCapabilities(): Promise<MediaAudioAnalysisCapabilities> {
    if (this.broker?.capabilities) return await this.broker.capabilities()
    const remediation = 'Install or enable Kun\'s verified local audio-analysis runtime; no media was uploaded and no evidence was fabricated.'
    return {
      schemaVersion: 1,
      probedAt: new Date().toISOString(),
      analyses: (['silence', 'beat-grid', 'sync-features'] as const).map((analysis) => ({
        analysis,
        available: false as const,
        code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE' as const,
        remediation,
        retryable: false,
        local: true as const,
        networkUsed: false as const
      }))
    }
  }

  async denoiseMetadataCapability(): Promise<DenoiseMetadataCapability> {
    const fallback = (): Extract<DenoiseMetadataCapability, { outcome: 'unavailable' }> => ({
      outcome: 'unavailable',
      code: 'denoise_metadata_broker_unavailable',
      remediation: 'This Kun Host does not expose verified local noise-profile analysis. No media was uploaded or modified, and no denoise values were fabricated.',
      retryable: false,
      local: true,
      networkUsed: false
    })
    if (!this.broker?.denoiseMetadataCapability) return fallback()
    let capability: DenoiseMetadataCapability
    try {
      capability = await this.broker.denoiseMetadataCapability()
    } catch {
      return {
        ...fallback(),
        remediation: 'The Host could not negotiate its local noise-profile analyzer. Repair or update the approved Host analysis runtime and retry.',
        retryable: true
      }
    }
    if (capability.outcome === 'unavailable') {
      if (
        ![
          'denoise_metadata_broker_unavailable',
          'denoise_metadata_algorithm_unavailable',
          'denoise_metadata_model_unverified'
        ].includes(capability.code) ||
        capability.local !== true || capability.networkUsed !== false
      ) return fallback()
      return {
        ...structuredClone(capability),
        remediation: boundedRemediation(capability.remediation)
      }
    }
    if (!this.broker.analyzeDenoiseMetadata) return fallback()
    if (
      capability.local !== true || capability.networkUsed !== false ||
      !isValidDenoiseMetadataAdapterDescriptor(capability.descriptor)
    ) {
      return {
        outcome: 'unavailable',
        code: 'denoise_metadata_model_unverified',
        remediation: 'The Host denoise analyzer did not provide a bounded algorithm/model identity and version. No analysis was run.',
        retryable: false,
        local: true,
        networkUsed: false
      }
    }
    return structuredClone(capability)
  }

  speakerAdapters(): SpeakerDiarizationAdapterStatus[] {
    const localAvailable = Boolean(this.broker?.diarize)
    return defaultSpeakerDiarizationAdapterRegistry({
      localDescriptor: {
        adapterId: 'kun.host.local-speaker',
        adapterVersion: this.broker?.version ?? '1.0.0',
        modelId: 'speaker-diarization',
        modelVersion: this.broker?.version ?? 'unavailable',
        embeddingDimensions: 512
      },
      localInstallationVerified: localAvailable,
      localInferenceBrokerAvailable: localAvailable
    }).list()
  }

  async listSpeakerIdentities(projectId: string): Promise<SpeakerIdentity[]> {
    const value = await this.context.storage.workspace.get<JsonValue>(speakerRegistryKey(projectId))
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error('Stored speaker identity registry is unreadable.')
    try {
      return new SpeakerIdentityRegistry(value as unknown as SpeakerIdentity[]).list()
    } catch {
      throw new Error('Stored speaker identity registry failed bounded validation.')
    }
  }

  async importSpeakerEvidence(input: {
    project: VideoProject
    assetId: string
    identities: readonly SpeakerIdentity[]
    turns: readonly ImportedDiarizationTurn[]
    confidenceThreshold?: number
    completeness?: 'complete' | 'partial'
    signal?: AbortSignal
  }): Promise<AnalysisOutcome<DiarizationRecord>> {
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    const existingIdentities = await this.listSpeakerIdentities(input.project.id)
    const identities = new SpeakerIdentityRegistry(existingIdentities)
    for (const identity of input.identities) identities.upsert(identity)
    const adapter = defaultSpeakerDiarizationAdapterRegistry()
      .requireReady('kun.imported-speaker-labels')
    const total = Math.max(1, input.turns.length + 1)
    const operation = this.startOperation(input.project, 'speaker', total, input.signal)
    try {
      for (let offset = 0; offset < input.turns.length; offset += 128) {
        operation.controller.signal.throwIfAborted()
        await yieldToCancellation()
        await this.report(
          operation.progress.operationId,
          Math.min(input.turns.length, offset + 128),
          total,
          'Validating imported speaker turns'
        )
      }
      operation.controller.signal.throwIfAborted()
      const record = importSpeakerDiarizationEvidence({
        assetId: asset.id,
        sourceFingerprint: sourceFingerprint(asset),
        adapter,
        identities,
        turns: input.turns,
        confidenceThreshold: input.confidenceThreshold,
        completeness: input.completeness
      })
      const stored = await this.getRecord(input.project.id, record.id)
      if (stored && isDiarizationRecord(stored) &&
        await this.matchesGrantBinding(input.project.id, stored.id, [handleId])) {
        await this.finish(operation.progress.operationId, 'ready', 'Cached imported speaker evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: stored, deduplicated: true }
      }
      const recordKey = `${RECORD_PREFIX}${safePart(input.project.id)}:${safePart(record.id)}`
      const grantKey = grantBindingKey(input.project.id, record.id)
      const registryKey = speakerRegistryKey(input.project.id)
      const previousRecord = await this.context.storage.workspace.get<JsonValue>(recordKey)
      const previousGrant = await this.context.storage.workspace.get<JsonValue>(grantKey)
      const previousRegistry = await this.context.storage.workspace.get<JsonValue>(registryKey)
      try {
        const deduplicated = await this.persistImmutable(input.project.id, record)
        await this.persistGrantBinding(input.project.id, record.id, [handleId])
        await this.context.storage.workspace.set(registryKey, identities.list() as unknown as JsonValue)
        await this.report(operation.progress.operationId, total, total, 'Imported speaker evidence ready')
        await this.finish(operation.progress.operationId, 'ready', 'Imported speaker evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record, deduplicated }
      } catch (error) {
        await restoreStorageValue(this.context, recordKey, previousRecord)
        await restoreStorageValue(this.context, grantKey, previousGrant)
        await restoreStorageValue(this.context, registryKey, previousRegistry)
        throw error
      }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async startVisualIndex(input: {
    project: VideoProject
    assetId: string
    intervalUs?: number
    maxFrames?: number
    allowPartial?: boolean
    signal?: AbortSignal
  }): Promise<
    | { outcome: 'ready'; operationId: string; record: VisualIndexRecord; deduplicated: boolean }
    | { outcome: 'cancelled'; operationId: string }
    | { outcome: 'failed'; operationId: string; error: { code: string; message: string; retryable: boolean } }
    | { outcome: 'unavailable'; capability: VisualProvisioningState }
  > {
    const provisioning = await this.resolveVisualProvisioning()
    const capability = provisioning.capability
    if (!capability || capability.outcome !== 'ready') {
      return { outcome: 'unavailable', capability: provisioning.projection }
    }
    const broker = this.broker?.indexVisual
    if (!broker) throw new Error('Visual capability negotiation and broker availability diverged.')
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    await this.assertCurrentMediaGrant(handleId)
    const plan = buildFrameSamplingPlan({
      assetId: asset.id,
      durationUs: asset.durationUs,
      sourceFingerprint: sourceFingerprint(asset),
      intervalUs: input.intervalUs,
      maxFrames: input.maxFrames
    })
    const cached = (await this.listRecords(input.project.id)).find((record): record is VisualIndexRecord =>
      isVisualIndexRecord(record) &&
      record.assetId === asset.id &&
      record.sourceFingerprint.value === plan.sourceFingerprint.value &&
      record.adapter.id === capability.adapter.id &&
      record.adapter.version === capability.adapter.version &&
      record.adapter.modelId === capability.adapter.modelId &&
      record.adapter.modelVersion === capability.adapter.modelVersion &&
      record.adapter.packageId === capability.adapter.packageId &&
      record.adapter.manifestSha256 === capability.adapter.manifestSha256 &&
      record.parameters.intervalUs === plan.intervalUs &&
      record.parameters.durationUs === plan.durationUs &&
      record.parameters.maxFrames === plan.maxFrames &&
      record.parameters.samplingStrategy === plan.strategy &&
      record.parameters.embeddingDimensions === capability.adapter.embeddingDimensions &&
      record.plannedSampleCount === plan.samples.length
    )
    if (cached && await this.matchesGrantBinding(input.project.id, cached.id, [handleId])) {
      return {
        outcome: 'ready',
        operationId: `cached-${cached.id}`.slice(0, 512),
        record: cached,
        deduplicated: true
      }
    }
    const operation = this.startOperation(input.project, 'visual-index', plan.samples.length, input.signal)
    const tracker = new VisualIndexProgressTracker(plan.samples.length)
    tracker.start('Starting verified local visual indexing')
    try {
      const embeddings = await broker.call(this.broker, {
        mediaHandleId: handleId,
        samples: plan.samples,
        adapter: capability.adapter,
        signal: operation.controller.signal,
        report: async (completed, total, message) => {
          tracker.report(completed, message)
          await this.report(operation.progress.operationId, completed, total, message)
        }
      })
      if (operation.controller.signal.aborted) {
        tracker.cancel()
        await this.finish(operation.progress.operationId, 'cancelled', 'Local visual indexing cancelled')
        return { outcome: 'cancelled', operationId: operation.progress.operationId }
      }
      const record = createVisualIndexRecord({
        capability,
        plan,
        embeddings,
        allowPartial: input.allowPartial
      })
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [handleId])
      tracker.complete()
      await this.finish(operation.progress.operationId, 'ready', 'Visual index ready')
      const canonical = deduplicated
        ? await this.getRecord(input.project.id, record.id)
        : record
      if (!canonical || !isVisualIndexRecord(canonical)) {
        throw new Error('Immutable visual index could not be reloaded after persistence.')
      }
      return { outcome: 'ready', operationId: operation.progress.operationId, record: canonical, deduplicated }
    } catch (error) {
      return await this.handleOperationError(operation.progress.operationId, error)
    }
  }

  async searchVisual(input: {
    project: VideoProject
    indexId: string
    query: string
    minimumScore?: number
    offset?: number
    pageSize?: number
  }): Promise<
    | { outcome: 'ready'; page: VisualMomentPage }
    | {
        outcome: 'unavailable'
        code: 'visual_query_broker_unavailable' | 'visual_query_unsupported' | 'visual_index_stale' | 'visual_model_changed'
        remediation: string
        networkUsed: false
      }
  > {
    const query = input.query.normalize('NFKC').trim()
    if (!query || query.length > 256 || containsAsciiControlCharacters(query)) {
      throw new Error('Visual moment query must contain 1 through 256 printable characters.')
    }
    const index = await this.getRecord(input.project.id, input.indexId)
    if (!index || !isVisualIndexRecord(index)) {
      return {
        outcome: 'unavailable',
        code: 'visual_index_stale',
        remediation: 'The requested immutable visual index is missing. Refresh records and index the current media grant.',
        networkUsed: false
      }
    }
    const asset = input.project.assets.find(({ id }) => id === index.assetId)
    if (
      !asset?.mediaHandleId ||
      sourceFingerprint(asset).value !== index.sourceFingerprint.value ||
      !await this.matchesGrantBinding(input.project.id, index.id, [asset.mediaHandleId])
    ) {
      return {
        outcome: 'unavailable',
        code: 'visual_index_stale',
        remediation: 'The visual index belongs to older source evidence or a revoked media grant. Reauthorize and index again.',
        networkUsed: false
      }
    }
    try {
      await this.assertCurrentMediaGrant(asset.mediaHandleId)
    } catch {
      return {
        outcome: 'unavailable',
        code: 'visual_index_stale',
        remediation: 'The authorized media file changed or is no longer readable. Reauthorize it and build a new immutable visual index.',
        networkUsed: false
      }
    }
    const provisioning = await this.resolveVisualProvisioning()
    const capability = provisioning.capability
    if (
      !capability || capability.outcome !== 'ready' ||
      capability.adapter.id !== index.adapter.id ||
      capability.adapter.version !== index.adapter.version ||
      capability.adapter.modelId !== index.adapter.modelId ||
      capability.adapter.modelVersion !== index.adapter.modelVersion ||
      capability.adapter.packageId !== index.adapter.packageId ||
      capability.adapter.manifestSha256 !== index.adapter.manifestSha256
    ) {
      return {
        outcome: 'unavailable',
        code: 'visual_model_changed',
        remediation: 'The verified local model no longer matches this immutable index. Re-index before searching.',
        networkUsed: false
      }
    }
    const broker = this.broker?.embedVisualQuery
    if (!broker) {
      return {
        outcome: 'unavailable',
        code: 'visual_query_broker_unavailable',
        remediation: 'Install and enable a verified local visual model and approved inference broker; no result was fabricated.',
        networkUsed: false
      }
    }
    const controller = new AbortController()
    let queryVector: number[]
    try {
      queryVector = await broker.call(this.broker, {
        query,
        adapter: index.adapter,
        signal: controller.signal
      })
    } catch (error) {
      if (!isUnavailableError(error)) throw error
      return {
        outcome: 'unavailable',
        code: error.code === 'VISUAL_QUERY_UNSUPPORTED'
          ? 'visual_query_unsupported'
          : 'visual_query_broker_unavailable',
        remediation: error.remediation,
        networkUsed: false
      }
    }
    return {
      outcome: 'ready',
      page: searchVisualMoments({
        index,
        queryVector,
        minimumScore: input.minimumScore,
        offset: input.offset,
        pageSize: input.pageSize
      })
    }
  }

  async analyzeVad(input: { project: VideoProject; assetId: string; signal?: AbortSignal }): Promise<AnalysisOutcome<VadAnalysisRecord>> {
    const broker = this.broker?.analyzeVad
    if (!broker) return unavailableAnalysis('vad_broker_unavailable', 'No approved local VAD broker is available.')
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    const cached = (await this.listRecords(input.project.id)).find((record): record is VadAnalysisRecord =>
      isVadRecord(record) &&
      record.assetId === asset.id &&
      record.provenance.sourceFingerprint.value === sourceFingerprint(asset).value &&
      record.provenance.adapterId === this.broker!.id &&
      record.provenance.adapterVersion === this.broker!.version
    )
    if (cached && await this.matchesGrantBinding(input.project.id, cached.id, [handleId])) {
      return cachedOutcome(cached)
    }
    const operation = this.startOperation(input.project, 'vad', 100, input.signal)
    try {
      const evidence = await broker.call(this.broker, {
        mediaHandleId: handleId,
        signal: operation.controller.signal,
        report: (completed, total, message) => this.report(operation.progress.operationId, completed, total, message)
      })
      if (operation.controller.signal.aborted) return { outcome: 'cancelled', operationId: operation.progress.operationId }
      const record = analyzeVadEvidence({
        assetId: asset.id,
        sourceFingerprint: evidence.sourceFingerprint ?? sourceFingerprint(asset),
        frames: evidence.frames,
        completeness: evidence.completeness,
        adapterId: this.broker!.id,
        adapterVersion: this.broker!.version
      })
      const existing = await this.getRecord(input.project.id, record.id)
      if (existing && isVadRecord(existing)) {
        await this.persistGrantBinding(input.project.id, existing.id, [handleId])
        await this.finish(operation.progress.operationId, 'ready', 'Cached VAD evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: existing, deduplicated: true }
      }
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [handleId])
      await this.finish(operation.progress.operationId, 'ready', 'VAD evidence ready')
      return { outcome: 'ready', operationId: operation.progress.operationId, record, deduplicated }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async analyzeSpeakers(input: {
    project: VideoProject
    assetId: string
    optIn: boolean
    descriptor: SpeakerModelDescriptor
    installationVerified: boolean
    registry: SpeakerRegistry
    signal?: AbortSignal
  }): Promise<AnalysisOutcome<DiarizationRecord> | { outcome: 'unavailable'; capability: Exclude<ReturnType<typeof negotiateSpeakerAdapter>, { outcome: 'ready' }> }> {
    const capability = negotiateSpeakerAdapter({
      optIn: input.optIn,
      descriptor: input.descriptor,
      installationVerified: input.installationVerified,
      inferenceBrokerAvailable: Boolean(this.broker?.diarize)
    })
    if (capability.outcome !== 'ready') return { outcome: 'unavailable', capability }
    const broker = this.broker!.diarize!
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    const cached = (await this.listRecords(input.project.id)).find((record): record is DiarizationRecord =>
      isDiarizationRecord(record) &&
      record.assetId === asset.id &&
      record.provenance.sourceFingerprint.value === sourceFingerprint(asset).value &&
      record.provenance.adapterId === capability.adapter.adapterId &&
      record.provenance.adapterVersion === capability.adapter.adapterVersion &&
      record.provenance.modelId === `${capability.adapter.modelId}@${capability.adapter.modelVersion}`
    )
    if (cached && await this.matchesGrantBinding(input.project.id, cached.id, [handleId])) {
      return cachedOutcome(cached)
    }
    const operation = this.startOperation(input.project, 'speaker', 100, input.signal)
    try {
      const evidence = await broker.call(this.broker, {
        mediaHandleId: handleId,
        adapter: capability.adapter,
        signal: operation.controller.signal,
        report: (completed, total, message) => this.report(operation.progress.operationId, completed, total, message)
      })
      if (operation.controller.signal.aborted) return { outcome: 'cancelled', operationId: operation.progress.operationId }
      const record = diarizeSpeakerEvidence({
        assetId: asset.id,
        sourceFingerprint: sourceFingerprint(asset),
        capability,
        registry: input.registry,
        turns: evidence.turns,
        completeness: evidence.completeness
      })
      const existing = await this.getRecord(input.project.id, record.id)
      if (existing && isDiarizationRecord(existing)) {
        await this.persistGrantBinding(input.project.id, existing.id, [handleId])
        await this.finish(operation.progress.operationId, 'ready', 'Cached speaker evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: existing, deduplicated: true }
      }
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [handleId])
      await this.finish(operation.progress.operationId, 'ready', 'Speaker evidence ready')
      return { outcome: 'ready', operationId: operation.progress.operationId, record, deduplicated }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async analyzeBeats(input: { project: VideoProject; assetId: string; signal?: AbortSignal }): Promise<AnalysisOutcome<BeatAnalysisRecord>> {
    const broker = this.broker?.analyzeBeats
    if (!broker) return unavailableAnalysis('beat_broker_unavailable', 'No approved local beat-analysis broker is available.')
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    const cached = (await this.listRecords(input.project.id)).find((record): record is BeatAnalysisRecord =>
      isBeatRecord(record) &&
      record.assetId === asset.id &&
      record.provenance.sourceFingerprint.value === sourceFingerprint(asset).value &&
      record.provenance.adapterId === this.broker!.id &&
      record.provenance.adapterVersion === this.broker!.version
    )
    if (cached && await this.matchesGrantBinding(input.project.id, cached.id, [handleId])) {
      return cachedOutcome(cached)
    }
    const operation = this.startOperation(input.project, 'beats', 100, input.signal)
    try {
      const evidence = await broker.call(this.broker, {
        mediaHandleId: handleId,
        signal: operation.controller.signal,
        report: (completed, total, message) => this.report(operation.progress.operationId, completed, total, message)
      })
      if (operation.controller.signal.aborted) return { outcome: 'cancelled', operationId: operation.progress.operationId }
      const record = analyzeBeatEvidence({
        assetId: asset.id,
        sourceFingerprint: evidence.sourceFingerprint ?? sourceFingerprint(asset),
        observations: evidence.observations,
        tempoBpm: evidence.tempoBpm,
        completeness: evidence.completeness,
        adapterId: this.broker!.id,
        adapterVersion: this.broker!.version
      })
      const existing = await this.getRecord(input.project.id, record.id)
      if (existing && isBeatRecord(existing)) {
        await this.persistGrantBinding(input.project.id, existing.id, [handleId])
        await this.finish(operation.progress.operationId, 'ready', 'Cached beat evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: existing, deduplicated: true }
      }
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [handleId])
      await this.finish(operation.progress.operationId, 'ready', 'Beat evidence ready')
      return { outcome: 'ready', operationId: operation.progress.operationId, record, deduplicated }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async analyzeDenoiseMetadata(input: {
    project: VideoProject
    assetId: string
    confidenceThreshold?: number
    signal?: AbortSignal
  }): Promise<AnalysisOutcome<DenoiseMetadataRecord>> {
    const capability = await this.denoiseMetadataCapability()
    if (capability.outcome === 'unavailable') {
      return unavailableAnalysis(capability.code, capability.remediation)
    }
    const broker = this.broker
    const analyze = broker?.analyzeDenoiseMetadata
    if (!broker || !analyze) {
      return unavailableAnalysis(
        'denoise_metadata_broker_unavailable',
        'The negotiated local denoise analyzer is no longer available. No media was uploaded or modified.'
      )
    }
    const confidenceThreshold = boundedConfidence(input.confidenceThreshold ?? 0.7, 'confidenceThreshold')
    const asset = requiredAsset(input.project, input.assetId)
    const handleId = requiredHandle(asset)
    const expectedFingerprint = sourceFingerprint(asset)
    await this.assertCurrentMediaGrant(handleId)
    const cached = (await this.listRecords(input.project.id)).find((record): record is DenoiseMetadataRecord =>
      isDenoiseRecord(record) &&
      record.assetId === asset.id &&
      record.provenance.sourceFingerprint.value === expectedFingerprint.value &&
      record.provenance.adapterId === capability.descriptor.adapterId &&
      record.provenance.adapterVersion === capability.descriptor.adapterVersion &&
      record.provenance.algorithm === capability.descriptor.algorithm &&
      record.provenance.algorithmVersion === capability.descriptor.algorithmVersion &&
      record.provenance.modelId === capability.descriptor.modelId &&
      record.provenance.modelVersion === capability.descriptor.modelVersion &&
      record.confidenceThreshold === confidenceThreshold
    )
    if (cached && await this.matchesGrantBinding(input.project.id, cached.id, [handleId])) {
      return cachedOutcome(cached)
    }
    const operation = this.startOperation(input.project, 'denoise-metadata', 100, input.signal)
    try {
      const measured = await analyze.call(broker, {
        mediaHandleId: handleId,
        signal: operation.controller.signal,
        report: (completed, total, message) => this.report(operation.progress.operationId, completed, total, message)
      })
      if (operation.controller.signal.aborted) {
        return { outcome: 'cancelled', operationId: operation.progress.operationId }
      }
      if (
        measured.sourceFingerprint.algorithm !== 'sha256' ||
        measured.sourceFingerprint.value !== expectedFingerprint.value
      ) {
        throw unavailableError(
          'denoise_metadata_source_mismatch',
          'The local denoise result does not match the current source fingerprint. Reauthorize the source and analyze again.',
          false
        )
      }
      const record = createDenoiseMetadataRecord({
        assetId: asset.id,
        sourceFingerprint: measured.sourceFingerprint,
        descriptor: capability.descriptor,
        evidence: measured.evidence,
        confidenceThreshold
      })
      const existing = await this.getRecord(input.project.id, record.id)
      if (existing && isDenoiseRecord(existing)) {
        await this.persistGrantBinding(input.project.id, existing.id, [handleId])
        await this.finish(operation.progress.operationId, 'ready', 'Cached denoise metadata ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: existing, deduplicated: true }
      }
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [handleId])
      await this.finish(
        operation.progress.operationId,
        'ready',
        record.status === 'ready'
          ? 'Local denoise metadata ready; no audio was modified'
          : 'Low-confidence denoise metadata ready for review; no audio was modified'
      )
      const canonical = deduplicated
        ? await this.getRecord(input.project.id, record.id)
        : record
      if (!canonical || !isDenoiseRecord(canonical)) {
        throw new Error('Immutable denoise metadata could not be reloaded after persistence.')
      }
      return {
        outcome: 'ready',
        operationId: operation.progress.operationId,
        record: canonical,
        deduplicated
      }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async analyzeSync(input: {
    project: VideoProject
    referenceAssetId: string
    targetAssetId: string
    seed: number
    maximumOffsetUs: number
    threshold?: number
    minimumSeparation?: number
    signal?: AbortSignal
  }): Promise<AnalysisOutcome<AudioSyncAnalysis>> {
    const broker = this.broker?.extractSyncFeatures
    if (!broker) return unavailableAnalysis('sync_broker_unavailable', 'No approved local audio-feature broker is available.')
    const reference = requiredAsset(input.project, input.referenceAssetId)
    const target = requiredAsset(input.project, input.targetAssetId)
    const referenceHandleId = requiredHandle(reference)
    const targetHandleId = requiredHandle(target)
    const referenceSource = sourceFingerprint(reference)
    const targetSource = sourceFingerprint(target)
    const combinedSource = combineAudioSourceFingerprints(referenceSource, targetSource)
    const cached = (await this.listRecords(input.project.id)).find((record): record is AudioSyncAnalysis =>
      isAudioSyncRecord(record) &&
      record.referenceAssetId === reference.id &&
      record.targetAssetId === target.id &&
      record.seed === input.seed &&
      record.threshold === (input.threshold ?? 0.82) &&
      record.minimumSeparation === (input.minimumSeparation ?? 0.03) &&
      record.provenance.sourceFingerprint.value === combinedSource.value &&
      record.provenance.adapterId === this.broker!.id &&
      record.provenance.adapterVersion === this.broker!.version &&
      record.id === audioSyncAnalysisId({
        referenceAssetId: reference.id,
        targetAssetId: target.id,
        referenceFingerprint: referenceSource,
        targetFingerprint: targetSource,
        samplePeriodUs: record.samplePeriodUs,
        maximumOffsetUs: input.maximumOffsetUs,
        seed: input.seed,
        threshold: input.threshold,
        minimumSeparation: input.minimumSeparation,
        adapterId: this.broker!.id,
        adapterVersion: this.broker!.version
      })
    )
    if (
      cached &&
      await this.matchesGrantBinding(input.project.id, cached.id, [referenceHandleId, targetHandleId])
    ) return cachedOutcome(cached)
    const operation = this.startOperation(input.project, 'audio-sync', 100, input.signal)
    try {
      const evidence = await broker.call(this.broker, {
        referenceHandleId,
        targetHandleId,
        seed: input.seed,
        signal: operation.controller.signal,
        report: (completed, total, message) => this.report(operation.progress.operationId, completed, total, message)
      })
      if (operation.controller.signal.aborted) return { outcome: 'cancelled', operationId: operation.progress.operationId }
      const record = analyzeAudioSynchronization({
        referenceAssetId: reference.id,
        targetAssetId: target.id,
        referenceFeatures: evidence.referenceFeatures,
        targetFeatures: evidence.targetFeatures,
        samplePeriodUs: evidence.samplePeriodUs,
        maximumOffsetUs: input.maximumOffsetUs,
        seed: input.seed,
        threshold: input.threshold,
        minimumSeparation: input.minimumSeparation,
        referenceFingerprint: evidence.referenceFingerprint ?? referenceSource,
        targetFingerprint: evidence.targetFingerprint ?? targetSource,
        adapterId: this.broker!.id,
        adapterVersion: this.broker!.version
      })
      const existing = await this.getRecord(input.project.id, record.id)
      if (existing && isAudioSyncRecord(existing)) {
        await this.persistGrantBinding(input.project.id, existing.id, [referenceHandleId, targetHandleId])
        await this.finish(operation.progress.operationId, 'ready', 'Cached audio synchronization evidence ready')
        return { outcome: 'ready', operationId: operation.progress.operationId, record: existing, deduplicated: true }
      }
      const deduplicated = await this.persistImmutable(input.project.id, record)
      await this.persistGrantBinding(input.project.id, record.id, [referenceHandleId, targetHandleId])
      await this.finish(operation.progress.operationId, 'ready', 'Audio synchronization evidence ready')
      return { outcome: 'ready', operationId: operation.progress.operationId, record, deduplicated }
    } catch (error) {
      return await this.handleAnalysisError(operation.progress.operationId, error)
    }
  }

  async cancel(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId)
    if (!operation || ['cancelled', 'ready', 'failed'].includes(operation.progress.status)) return false
    operation.controller.abort()
    await this.finish(operationId, 'cancelled', 'Local media analysis cancelled')
    return true
  }

  status(operationId: string): MediaIntelligenceProgress | undefined {
    const progress = this.operations.get(operationId)?.progress
    return progress ? structuredClone(progress) : undefined
  }

  listOperations(projectId: string): MediaIntelligenceProgress[] {
    return [...this.operations.values()]
      .map(({ progress }) => progress)
      .filter((progress) => progress.projectId === projectId)
      .sort((left, right) => right.generation - left.generation || left.operationId.localeCompare(right.operationId))
      .slice(0, 100)
      .map((progress) => structuredClone(progress))
  }

  async listRecords(projectId: string): Promise<IntelligenceRecord[]> {
    const prefix = `${RECORD_PREFIX}${safePart(projectId)}:`
    const keys = (await this.context.storage.workspace.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()
      .slice(0, MAX_RECORDS)
    const records: IntelligenceRecord[] = []
    for (const key of keys) {
      const value = await this.context.storage.workspace.get<JsonValue>(key)
      if (isIntelligenceRecord(value)) records.push(value as unknown as IntelligenceRecord)
    }
    return records
  }

  async readEvidence(
    projectId: string,
    recordId: string,
    request: { offset?: number; limit?: number } = {}
  ): Promise<ReturnType<typeof readMediaIntelligenceEvidence>> {
    const record = (await this.listRecords(projectId)).find(({ id }) => id === recordId)
    if (!record) throw new Error(`Media-intelligence evidence does not exist: ${recordId}`)
    return readMediaIntelligenceEvidence(record, request)
  }

  async getRecord(projectId: string, recordId: string): Promise<IntelligenceRecord | undefined> {
    return (await this.listRecords(projectId)).find(({ id }) => id === recordId)
  }

  async matchesCurrentGrantBinding(
    project: VideoProject,
    record: IntelligenceRecord
  ): Promise<boolean> {
    if (isVisualIndexRecord(record)) {
      const asset = project.assets.find(({ id }) => id === record.assetId)
      if (!asset?.mediaHandleId) return false
      return await this.matchesGrantBinding(project.id, record.id, [asset.mediaHandleId])
    }
    if (record.kind === 'audio-sync') {
      const reference = project.assets.find(({ id }) => id === record.referenceAssetId)
      const target = project.assets.find(({ id }) => id === record.targetAssetId)
      if (!reference?.mediaHandleId || !target?.mediaHandleId) return false
      return await this.matchesGrantBinding(project.id, record.id, [reference.mediaHandleId, target.mediaHandleId])
    }
    const asset = project.assets.find(({ id }) => id === record.assetId)
    if (!asset?.mediaHandleId) return false
    return await this.matchesGrantBinding(project.id, record.id, [asset.mediaHandleId])
  }

  private startOperation(
    project: VideoProject,
    kind: MediaIntelligenceProgress['kind'],
    total: number,
    externalSignal?: AbortSignal
  ): Operation {
    const operationId = `media-analysis-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    const operation: Operation = {
      controller: new AbortController(),
      progress: {
        schemaVersion: 1,
        operationId,
        projectId: project.id,
        projectRevision: project.currentRevision,
        kind,
        generation: 1,
        status: 'queued',
        completed: 0,
        total: Math.max(1, total)
      }
    }
    if (externalSignal) {
      const cancel = (): void => operation.controller.abort()
      if (externalSignal.aborted) cancel()
      else {
        externalSignal.addEventListener('abort', cancel, { once: true })
        operation.detachExternalCancellation = () => externalSignal.removeEventListener('abort', cancel)
      }
    }
    this.operations.set(operationId, operation)
    if (this.operations.size > 256) {
      const removable = [...this.operations.entries()]
        .filter(([, candidate]) => ['cancelled', 'ready', 'failed'].includes(candidate.progress.status))
        .slice(0, this.operations.size - 256)
      for (const [id] of removable) this.operations.delete(id)
    }
    void this.publish(operation.progress)
    operation.progress = { ...operation.progress, generation: 2, status: 'running' }
    void this.publish(operation.progress)
    return operation
  }

  private async resolveVisualProvisioning(): Promise<{
    projection: VisualProvisioningState
    capability?: ReturnType<typeof negotiateVisualAdapter>
  }> {
    const checkedAt = new Date().toISOString()
    const optIn = await this.visualOptIn()
    const emptyVerification = {
      brokerAttested: false,
      downloadVerified: false,
      sourceVerified: false,
      installVerified: false,
      signatureVerified: false,
      manifestVerified: false,
      errors: [] as string[]
    }
    if (!optIn) {
      return {
        projection: visualProvisioningProjection({
          optIn,
          state: 'disabled',
          code: 'visual_model_disabled',
          installSupported: Boolean(this.broker?.requestVisualModelInstall),
          verification: emptyVerification,
          remediation: 'Enable local visual indexing for this workspace before checking or installing a model.',
          checkedAt
        })
      }
    }
    if (!this.broker?.visualModelStatus) {
      return {
        projection: visualProvisioningProjection({
          optIn,
          state: 'broker-unavailable',
          code: 'visual_model_broker_unavailable',
          installSupported: false,
          verification: emptyVerification,
          remediation: 'This Kun build has no approved model download/install Broker. Update Kun or install a Host build that exposes verified local-model provisioning; filename and transcript search remain available.',
          checkedAt
        })
      }
    }
    let status: VisualModelBrokerStatus
    try {
      status = await this.broker.visualModelStatus()
    } catch {
      return {
        projection: visualProvisioningProjection({
          optIn,
          state: 'failed',
          code: 'visual_model_install_failed',
          installSupported: Boolean(this.broker.requestVisualModelInstall),
          verification: emptyVerification,
          remediation: 'The Host model Broker could not verify local installation state. Retry the check or repair the Host model runtime.',
          checkedAt
        })
      }
    }
    let model: NonNullable<VisualProvisioningState['model']>
    let capability: ReturnType<typeof negotiateVisualAdapter>
    try {
      model = visualModelProjection(status.descriptor)
      capability = this.visualCapability({
        optIn,
        descriptor: status.descriptor,
        receipt: status.receipt
      })
    } catch {
      return {
        projection: visualProvisioningProjection({
          optIn,
          state: 'unverified',
          code: 'visual_model_unverified',
          installSupported: false,
          verification: {
            ...emptyVerification,
            errors: ['The Host model descriptor failed bounded identity or manifest validation.']
          },
          remediation: 'Repair or reinstall the model through an approved Host model Broker; unvalidated model metadata will not execute.',
          checkedAt
        })
      }
    }
    if (status.state === 'downloading') {
      return {
        projection: visualProvisioningProjection({
          optIn,
          state: 'downloading',
          code: 'visual_model_downloading',
          installSupported: status.installSupported,
          model,
          verification: emptyVerification,
          remediation: boundedRemediation(status.remediation),
          checkedAt: safeCheckedAt(status.checkedAt, checkedAt)
        })
      }
    }
    const verification = status.receipt
      ? verifyVisualReceiptProjection(status.descriptor, status.receipt)
      : emptyVerification
    const state = capability.outcome === 'ready'
      ? 'ready'
      : capability.code === 'visual_model_missing'
        ? status.state === 'failed' ? 'failed' : 'missing'
      : capability.code === 'visual_model_unverified'
          ? 'unverified'
          : 'inference-unavailable'
    const code = capability.outcome === 'ready'
      ? 'visual_model_ready'
      : status.state === 'failed'
        ? 'visual_model_install_failed'
        : capability.code
    return {
      projection: visualProvisioningProjection({
        optIn,
        state,
        code,
        installSupported: status.installSupported && Boolean(this.broker.requestVisualModelInstall),
        ...(status.receipt ? { packageSource: status.receipt.packageSource ?? 'downloaded' } : {}),
        model,
        verification,
        remediation: capability.outcome === 'ready'
          ? 'Verified local visual model is ready; inference remains local and receives only opaque media handles.'
          : boundedRemediation(status.remediation || capability.remediation),
        checkedAt: safeCheckedAt(status.checkedAt, checkedAt)
      }),
      capability
    }
  }

  private async visualOptIn(): Promise<boolean> {
    const value = await this.context.storage.workspace.get<JsonValue>(VISUAL_OPT_IN_KEY)
    return Boolean(
      value && typeof value === 'object' && !Array.isArray(value) &&
      value.schemaVersion === 1 && value.optIn === true
    )
  }

  private async assertCurrentMediaGrant(handleId: string): Promise<void> {
    if (!this.broker?.validateMediaGrant) return
    if (!await this.broker.validateMediaGrant(handleId)) {
      throw new Error('Media grant is revoked or is not readable.')
    }
  }

  private async report(operationId: string, completed: number, total: number, message?: string): Promise<void> {
    const operation = this.operations.get(operationId)
    if (!operation || operation.controller.signal.aborted) throw abortError()
    if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(total) || total < 1 || completed < operation.progress.completed || completed > total) {
      throw new Error('Local analysis progress must be bounded and monotonic.')
    }
    operation.progress = {
      ...operation.progress,
      generation: operation.progress.generation + 1,
      status: 'running',
      completed,
      total,
      ...(message ? { message: message.slice(0, 512) } : {})
    }
    await this.publish(operation.progress)
  }

  private async finish(
    operationId: string,
    status: 'cancelled' | 'ready' | 'failed',
    message: string,
    error?: MediaIntelligenceProgress['error']
  ): Promise<void> {
    const operation = this.operations.get(operationId)
    if (!operation || ['cancelled', 'ready', 'failed'].includes(operation.progress.status)) return
    operation.detachExternalCancellation?.()
    operation.detachExternalCancellation = undefined
    operation.progress = {
      ...operation.progress,
      generation: operation.progress.generation + 1,
      status,
      ...(status === 'ready' ? { completed: operation.progress.total } : {}),
      message: message.slice(0, 512),
      ...(error ? { error } : {})
    }
    await this.publish(operation.progress)
  }

  private async handleOperationError(operationId: string, error: unknown): Promise<OperationFailure> {
    const operation = this.operations.get(operationId)
    if (operation?.controller.signal.aborted || isAbortError(error)) {
      await this.finish(operationId, 'cancelled', 'Local media analysis cancelled')
      return { outcome: 'cancelled', operationId }
    }
    const message = error instanceof Error ? error.message : String(error)
    const boundedError = { code: 'local_analysis_failed', message: message.slice(0, 1_024), retryable: true }
    await this.finish(operationId, 'failed', 'Local media analysis failed', boundedError)
    return { outcome: 'failed', operationId, error: boundedError }
  }

  private async handleAnalysisError(operationId: string, error: unknown): Promise<OperationFailure | AnalysisUnavailable> {
    if (isUnavailableError(error)) {
      await this.finish(operationId, 'failed', error.remediation, {
        code: error.code,
        message: error.remediation,
        retryable: error.retryable
      })
      return {
        outcome: 'unavailable',
        code: error.code,
        remediation: error.remediation,
        networkUsed: false
      }
    }
    return await this.handleOperationError(operationId, error)
  }

  private async persistImmutable(projectId: string, record: IntelligenceRecord): Promise<boolean> {
    const key = `${RECORD_PREFIX}${safePart(projectId)}:${safePart(record.id)}`
    const existing = await this.context.storage.workspace.get<JsonValue>(key)
    const value = record as unknown as JsonValue
    if (existing !== undefined) {
      const sameVisualEvidence = isVisualIndexRecord(record) && isIntelligenceRecord(existing) &&
        isVisualIndexRecord(existing as unknown as IntelligenceRecord) &&
        JSON.stringify(withoutVisualCreatedAt(existing as unknown as VisualIndexRecord)) ===
          JSON.stringify(withoutVisualCreatedAt(record))
      const sameDenoiseEvidence = isDenoiseRecord(record) && isIntelligenceRecord(existing) &&
        isDenoiseRecord(existing as unknown as IntelligenceRecord) &&
        JSON.stringify(withoutDenoiseCreatedAt(existing as unknown as DenoiseMetadataRecord)) ===
          JSON.stringify(withoutDenoiseCreatedAt(record))
      if (!sameVisualEvidence && !sameDenoiseEvidence && JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new Error(`Immutable media-intelligence record changed for ${record.id}.`)
      }
      return true
    }
    await this.context.storage.workspace.set(key, value)
    return false
  }

  private async matchesGrantBinding(
    projectId: string,
    recordId: string,
    handleIds: readonly string[]
  ): Promise<boolean> {
    const value = await this.context.storage.workspace.get<JsonValue>(grantBindingKey(projectId, recordId))
    return Boolean(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.schemaVersion === 1 &&
      Array.isArray(value.handleIds) &&
      value.handleIds.length === handleIds.length &&
      value.handleIds.every((handleId, index) => handleId === handleIds[index])
    )
  }

  private async persistGrantBinding(
    projectId: string,
    recordId: string,
    handleIds: readonly string[]
  ): Promise<void> {
    await this.context.storage.workspace.set(grantBindingKey(projectId, recordId), {
      schemaVersion: 1,
      handleIds: [...handleIds]
    })
  }

  private async publish(progress: MediaIntelligenceProgress): Promise<void> {
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.media-intelligence-progress',
      payload: progress as unknown as JsonObject
    })
  }
}

export type AnalysisOutcome<T> =
  | { outcome: 'ready'; operationId: string; record: T; deduplicated: boolean }
  | { outcome: 'cancelled'; operationId: string }
  | { outcome: 'failed'; operationId: string; error: { code: string; message: string; retryable: boolean } }
  | { outcome: 'unavailable'; code: string; remediation: string; networkUsed: false }

type OperationFailure =
  | { outcome: 'cancelled'; operationId: string }
  | { outcome: 'failed'; operationId: string; error: { code: string; message: string; retryable: boolean } }

type AnalysisUnavailable = {
  outcome: 'unavailable'
  code: string
  remediation: string
  networkUsed: false
}

function cachedOutcome<T>(record: T): AnalysisOutcome<T> {
  const recordId = typeof record === 'object' && record !== null && 'id' in record
    ? String(record.id)
    : 'record'
  return {
    outcome: 'ready',
    operationId: `cached-${recordId}`.slice(0, 512),
    record,
    deduplicated: true
  }
}

function unavailableAnalysis(code: string, remediation: string): AnalysisOutcome<never> {
  return { outcome: 'unavailable', code, remediation, networkUsed: false }
}

function requiredAsset(project: VideoProject, assetId: string): VideoProject['assets'][number] {
  const asset = project.assets.find(({ id }) => id === assetId)
  if (!asset) throw new Error(`Media-intelligence asset does not exist: ${assetId}`)
  return asset
}

function requiredHandle(asset: VideoProject['assets'][number]): string {
  if (!asset.mediaHandleId) throw new Error(`Asset ${asset.id} requires reauthorization before local analysis.`)
  return asset.mediaHandleId
}

function sourceFingerprint(asset: VideoProject['assets'][number]): SourceIdentity {
  return asset.sourceIdentity?.algorithm === 'sha256'
    ? structuredClone(asset.sourceIdentity)
    : fingerprintAssetIdentity(asset)
}

function safePart(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(value)) throw new Error('Storage identity is invalid.')
  return value
}

function grantBindingKey(projectId: string, recordId: string): string {
  return `${GRANT_BINDING_PREFIX}${safePart(projectId)}:${safePart(recordId)}`
}

function speakerRegistryKey(projectId: string): string {
  return `${SPEAKER_REGISTRY_PREFIX}${safePart(projectId)}`
}

function isIntelligenceRecord(value: JsonValue | undefined): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.schemaVersion !== 1 || value.immutable !== true || typeof value.id !== 'string') return false
  return value.id.startsWith('visual-index:')
    ? isValidVisualIndexRecord(value)
    : value.kind === 'denoise-metadata'
      ? isValidDenoiseMetadataRecord(value)
      : ['vad', 'speaker-diarization', 'beat-grid', 'audio-sync'].includes(String(value.kind))
}

function isVisualIndexRecord(record: IntelligenceRecord): record is VisualIndexRecord {
  return record.id.startsWith('visual-index:') && isValidVisualIndexRecord(record)
}

function withoutVisualCreatedAt(record: VisualIndexRecord): Omit<VisualIndexRecord, 'createdAt'> {
  const { createdAt: _createdAt, ...evidence } = record
  return evidence
}

function withoutDenoiseCreatedAt(record: DenoiseMetadataRecord): DenoiseMetadataRecord {
  const clone = structuredClone(record)
  clone.provenance.createdAt = ''
  return clone
}

function isVadRecord(record: IntelligenceRecord): record is VadAnalysisRecord {
  return !isVisualIndexRecord(record) && record.kind === 'vad'
}

function isDiarizationRecord(record: IntelligenceRecord): record is DiarizationRecord {
  return !isVisualIndexRecord(record) && record.kind === 'speaker-diarization'
}

function isBeatRecord(record: IntelligenceRecord): record is BeatAnalysisRecord {
  return !isVisualIndexRecord(record) && record.kind === 'beat-grid'
}

function isDenoiseRecord(record: IntelligenceRecord): record is DenoiseMetadataRecord {
  return !isVisualIndexRecord(record) && record.kind === 'denoise-metadata' &&
    isValidDenoiseMetadataRecord(record)
}

function isAudioSyncRecord(record: IntelligenceRecord): record is AudioSyncAnalysis {
  return !isVisualIndexRecord(record) && record.kind === 'audio-sync'
}

function abortError(): Error {
  const error = new Error('Local analysis cancelled')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function yieldToCancellation(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function restoreStorageValue(
  context: ExtensionContext,
  key: string,
  value: JsonValue | undefined
): Promise<void> {
  if (value === undefined) await context.storage.workspace.delete(key)
  else await context.storage.workspace.set(key, value)
}

function isUnavailableError(error: unknown): error is Error & {
  code: string
  remediation: string
  retryable: boolean
  networkUsed: false
} {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & Partial<{
    code: unknown
    remediation: unknown
    retryable: unknown
    networkUsed: unknown
  }>
  return typeof candidate.code === 'string' &&
    typeof candidate.remediation === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    candidate.networkUsed === false
}

function unavailableError(code: string, remediation: string, retryable: boolean): Error & {
  code: string
  remediation: string
  retryable: boolean
  networkUsed: false
} {
  return Object.assign(new Error(remediation), { code, remediation, retryable, networkUsed: false as const })
}

function boundedConfidence(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be from 0 through 1`)
  }
  return value
}

function visualProvisioningProjection(
  value: Omit<VisualProvisioningState, 'schemaVersion' | 'local' | 'networkUsedForInference' | 'rawPathsExposed' | 'urlsAccepted'>
): VisualProvisioningState {
  return {
    schemaVersion: 1,
    ...value,
    local: true,
    networkUsedForInference: false,
    rawPathsExposed: false,
    urlsAccepted: false
  }
}

function visualModelProjection(
  descriptor: VisualModelDescriptor
): NonNullable<VisualProvisioningState['model']> {
  // Negotiation below performs the authoritative descriptor validation. This
  // projection intentionally omits file names, URLs, and any runtime location.
  return {
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    packageId: descriptor.packageId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    embeddingDimensions: descriptor.embeddingDimensions,
    manifestSha256: descriptor.manifestSha256
  }
}

function verifyVisualReceiptProjection(
  descriptor: VisualModelDescriptor,
  receipt: VisualModelInstallReceipt
): VisualProvisioningState['verification'] {
  const result = verifyVisualModelInstallation(descriptor, receipt)
  return {
    brokerAttested: receipt.broker === 'kun-model-broker',
    downloadVerified: receipt.downloadVerified === true,
    sourceVerified: (receipt.packageSource ?? 'downloaded') === 'bundled'
      ? receipt.sourceVerified === true
      : receipt.downloadVerified === true,
    installVerified: receipt.installVerified === true,
    signatureVerified: receipt.signatureVerified === true,
    manifestVerified: result.valid,
    errors: result.errors.map((error) => boundedRemediation(error)).slice(0, 32)
  }
}

function boundedRemediation(value: string): string {
  const printable = replaceAsciiControlCharacters(value.normalize('NFKC'), ' ')
    .replace(/\b(?:file|https?):\/\/\S+/giu, '[redacted-location]')
    .replace(/\/(?:Users|private|tmp|home)\/[^\s,;]+/gu, '[redacted-path]')
    .replace(/\s+/gu, ' ')
    .trim()
  return (printable || 'Check the approved Host model runtime and retry.').slice(0, 1_024)
}

function safeCheckedAt(value: string, fallback: string): string {
  if (!Number.isFinite(Date.parse(value))) return fallback
  const normalized = new Date(value).toISOString()
  return normalized === value ? value : fallback
}
