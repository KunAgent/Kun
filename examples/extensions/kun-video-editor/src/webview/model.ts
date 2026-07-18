import type {
  AgentRun,
  AgentRunEvent,
  GeneratedArtifact,
  JobEvent,
  JobSnapshot,
  Locale,
  MediaCapabilities,
  MediaMetadata,
  MediaResourceLease,
  ResultPreviewOpenPayload,
  Theme
} from '@kun/extension-api'
import type { MessageKey } from './i18n.js'
import type { RenderCapabilityDetail } from './render-capability.js'
import type {
  GenerationCatalog,
  GenerationOutputKind,
  GenerationTask
} from '../engine/generation.js'

export const VIEW_LIMITS = Object.freeze({
  projects: 100,
  sequences: 64,
  mediaFolders: 256,
  assets: 100,
  tracks: 64,
  items: 500,
  captions: 500,
  transcripts: 100,
  transcriptSegments: 500,
  revisions: 50,
  jobs: 40,
  derivedRecords: 120,
  agentEvents: 256,
  notices: 8,
  mediaLeases: 16,
  virtualWindow: 80,
  previewHistory: 40,
  multicamGroups: 64,
  generationRecords: 100
})

export type Rational = { numerator: number; denominator: number }
export type CanvasPreset = '16:9' | '9:16' | '1:1'
export type CanvasFit = 'fit' | 'crop' | 'pad'

export type ProjectSummary = {
  id: string
  name: string
  currentRevision: number
  updatedAt: string
  durationFrames: number
}

export type AssetProjection = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'image' | 'animation'
  mediaHandleId?: string
  durationUs: number
  container: string
  video?: { codec: string; width: number; height: number; frameRate: Rational; rotation?: number }
  audio?: { codec: string; sampleRate: number; channels: number }
  still?: {
    width: number
    height: number
    format: string
    animated: boolean
    frameRate?: Rational
    loop?: boolean
  }
  folderId?: string
  generatedLineage?: {
    providerId: string
    modelId: string
    jobId: string
    promptDigest?: string
    referenceAssetIds: string[]
    variantOfAssetId?: string
  }
  availability?: 'online' | 'offline' | 'revoked' | 'changed'
  transcriptIds: string[]
}

export type MediaFolderProjection = {
  id: string
  name: string
  parentId?: string
}

export type MediaLibraryPageProjection = {
  projectId: string
  revision: number
  folderId?: string
  query: string
  offset: number
  limit: number
  total: number
  hiddenBefore: number
  hiddenAfter: number
  assets: AssetProjection[]
}

export type SequenceProjection = {
  id: string
  name: string
  durationFrames: number
  itemCount: number
  captionCount: number
  nestedByCount?: number
  viewState: { zoom: number; scrollFrame: number; open: boolean }
}

export type LinkGroupProjection = {
  id: string
  kind: 'av' | 'sync' | 'custom'
  itemIds: string[]
  locked: boolean
}

export type TrackProjection = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'caption'
  order: number
  overlap: 'reject' | 'mix'
  muted?: boolean
  locked?: boolean
  visible?: boolean
  syncLocked?: boolean
}

export type ItemProjection = {
  id: string
  assetId: string
  trackId: string
  timelineStartFrame: number
  durationFrames: number
  sourceStartUs: number
  sourceEndUs: number
  speed: Rational
  transform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
  opacity: number
  fadeInFrames: number
  fadeOutFrames: number
  linkGroupId?: string
  nestedSequenceId?: string
  volume?: number
  muted?: boolean
  visible?: boolean
  locked?: boolean
  crop?: { left: number; top: number; right: number; bottom: number }
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay'
  effects?: Array<{
    id: string
    type: string
    enabled: boolean
    parameters: Record<string, number | string | boolean>
  }>
  keyframes?: Array<{
    id: string
    property: string
    interpolation: 'hold' | 'linear' | 'ease'
    points: Array<{ id: string; frame: number; value: number }>
  }>
}

export type CaptionProjection = {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  text: string
  placement: 'top' | 'center' | 'bottom'
  style?: {
    fontSize?: number
    color?: string
    background?: string
    fontFamily?: string
    fontWeight?: number
    maxWidthRatio?: number
  }
  sourceTranscriptId?: string
  sourceSegmentIds?: string[]
  speakerAttribution?: SpeakerAttributionProjection
  words?: Array<{
    id: string
    text: string
    startFrame: number
    endFrame: number
    sourceWordId?: string
  }>
  animation?: { kind: 'none' | 'word-highlight' | 'fade'; durationFrames?: number }
}

export type TranscriptSegmentProjection = {
  id: string
  startUs: number
  endUs: number
  text: string
  speakerAttribution?: SpeakerAttributionProjection
  tags?: Array<'filler' | 'silence'>
  words?: Array<{
    id: string
    startUs: number
    endUs: number
    text: string
    confidence?: number
  }>
}

export type SpeakerAttributionProjection = {
  analysisId: string
  speakerId?: string
  speakerLabel?: string
  confidence: number
  status: 'identified' | 'unknown' | 'overlap' | 'uncertain'
  sourceTurnIds: string[]
}

export type TranscriptProjection = {
  id: string
  assetId: string
  language: string
  provenance: 'srt' | 'vtt' | 'json' | 'local-asr'
  segmentCount: number
  segments: TranscriptSegmentProjection[]
  truncated: boolean
}

export type RevisionProjection = {
  revision: number
  parentRevision: number | null
  author: 'manual' | 'agent' | 'system'
  sourceOperation: string
  timestamp: string
  summary: string
  restoredFromRevision?: number | null
}

export type MulticamSyncEvidenceProjection = {
  id: string
  analysisId: string
  kind: 'audio-correlation' | 'timecode' | 'manual-confirmation'
  referenceMemberId: string
  targetMemberId: string
  confidence: number
  algorithmId: string
  algorithmVersion: string
}

export type MulticamMemberProjection = {
  id: string
  assetId: string
  memberLabel: string
  angleLabel: string
  sourceFps: Rational
  sync: {
    status: 'reference' | 'verified' | 'uncertain' | 'unknown'
    offsetFrames: number
    confidence?: number
    evidence: MulticamSyncEvidenceProjection[]
  }
  coverage: Array<{
    id: string
    startFrame: number
    endFrame: number
    sourceStartFrame: number
    sourceEndFrame: number
  }>
}

export type MulticamLayoutProjection = {
  id: string
  label: string
  slots: Array<{
    memberId: string
    x: number
    y: number
    width: number
    height: number
    zIndex: number
    opacity: number
    audioEnabled: boolean
  }>
}

export type MulticamProgramFragmentProjection = {
  id: string
  startFrame: number
  endFrame: number
  selection:
    | { kind: 'angle'; memberId: string }
    | { kind: 'layout'; layoutId: string }
}

export type MulticamGroupProjection = {
  schemaVersion: 1
  id: string
  sequenceId: string
  name: string
  fps: Rational
  durationFrames: number
  referenceMemberId: string
  members: MulticamMemberProjection[]
  layouts: MulticamLayoutProjection[]
  programFragments: MulticamProgramFragmentProjection[]
}

export type ProjectProjection = {
  schemaVersion: 1
  id: string
  name: string
  fps: Rational
  canvas: {
    preset: CanvasPreset
    width: number
    height: number
    fit: CanvasFit
    background: string
  }
  currentRevision: number
  eventGeneration: number
  activeSequenceId: string
  selection: {
    sequenceId: string
    revision: number
    generation: number
    playheadFrame: number
    selectedAssetIds: string[]
    selectedItemIds: string[]
    selectedCaptionIds: string[]
    selectedWordIds: string[]
    range?: { startFrame: number; endFrame: number }
  }
  updatedAt: string
  durationFrames: number
  playback: {
    mode: 'source-fast-path' | 'composed-proof'
    projectId: string
    sequenceId: string
    revision: number
    irDigest?: string | null
    sourceAssetId?: string | null
    reasons: string[]
  }
  sequences: SequenceProjection[]
  mediaFolders: MediaFolderProjection[]
  linkGroups: LinkGroupProjection[]
  multicamGroups: MulticamGroupProjection[]
  assets: AssetProjection[]
  tracks: TrackProjection[]
  items: ItemProjection[]
  captions: CaptionProjection[]
  transcripts: TranscriptProjection[]
  revisions: RevisionProjection[]
  canUndo?: boolean
  canRedo?: boolean
  truncated?: boolean
}

export type TimelineOperation =
  | { type: 'add-item'; item: ItemProjection }
  | { type: 'split-item'; itemId: string; atFrame: number }
  | { type: 'trim-item'; itemId: string; startFrame: number; endFrame: number }
  | { type: 'delete-item'; itemId: string }
  | { type: 'move-item'; itemId: string; trackId: string; timelineStartFrame: number }
  | { type: 'reorder-item'; itemId: string; beforeItemId?: string }
  | { type: 'update-transform'; itemId: string; transform: Partial<ItemProjection['transform']>; opacity?: number }
  | { type: 'update-track-state'; trackId: string; muted?: boolean; locked?: boolean; syncLocked?: boolean }
  | {
      type: 'update-item-properties'
      itemId: string
      volume?: number
      fadeInFrames?: number
      fadeOutFrames?: number
      muted?: boolean
      visible?: boolean
      locked?: boolean
    }
  | { type: 'set-link-group'; group: { id: string; kind: 'av' | 'sync' | 'custom'; itemIds: string[]; locked: boolean } }
  | { type: 'delete-link-group'; linkGroupId: string }
  | { type: 'create-sequence'; sequenceId: string; name: string; activate?: boolean }
  | {
      type: 'duplicate-sequence'
      sourceSequenceId: string
      sequenceId: string
      name: string
      activate?: boolean
    }
  | { type: 'rename-sequence'; sequenceId: string; name: string }
  | { type: 'select-sequence'; sequenceId: string }
  | { type: 'open-sequence'; sequenceId: string }
  | { type: 'close-sequence'; sequenceId: string; fallbackSequenceId?: string }
  | { type: 'delete-sequence'; sequenceId: string }
  | { type: 'set-sequence-view'; sequenceId: string; zoom: number; scrollFrame: number }
  | { type: 'set-item-keyframes'; itemId: string; keyframes: NonNullable<ItemProjection['keyframes']> }
  | { type: 'set-item-effects'; itemId: string; effects: NonNullable<ItemProjection['effects']> }
  | {
      type: 'update-item-composition'
      itemId: string
      crop?: NonNullable<ItemProjection['crop']>
      opacity?: number
      blendMode?: NonNullable<ItemProjection['blendMode']>
    }
  | { type: 'retime-item'; itemId: string; speed: Rational }
  | { type: 'add-caption'; caption: CaptionProjection }
  | { type: 'update-caption'; captionId: string; patch: Partial<Omit<CaptionProjection, 'id'>> }
  | { type: 'delete-caption'; captionId: string }
  | { type: 'set-canvas'; preset: CanvasPreset; fit: CanvasFit }
  | { type: 'set-multicam-group'; group: MulticamGroupProjection }
  | { type: 'delete-multicam-group'; groupId: string }
  | {
      type: 'switch-multicam-angle'
      groupId: string
      memberId: string
      startFrame: number
      endFrame: number
      coveragePolicy?: 'reject' | 'clamp'
      minimumSyncConfidence?: number
    }
  | {
      type: 'apply-multicam-layout'
      groupId: string
      layoutId: string
      startFrame: number
      endFrame: number
      coveragePolicy?: 'reject' | 'clamp'
      minimumSyncConfidence?: number
    }
  | { type: 'merge-multicam-program'; groupId: string }

export type ProjectChange = {
  schemaVersion: 1
  projectId: string
  revision: number
  generation?: number
  sequenceId?: string
  selectionGeneration?: number
  reason: string
  changedIds: string[]
  receipt?: Record<string, unknown>
  proofInvalidated?: boolean
}

export type RenderTicket = {
  jobId: string
  projectId: string
  pinnedRevision: number
  renderKind: 'proof-frame' | 'preview' | 'h264-mp4' | 'audio-aac' | 'subtitles'
  createdAt: string
}

export type ProjectPackageMissingMediaPolicy = 'fail' | 'omit'

export type ProjectPackageTicket = {
  schemaVersion: 1
  jobId: string
  projectId: string
  sequenceId: string
  pinnedRevision: number
  packageId: string
  manifestDigest: string
  complete: boolean
  selectedAssetCount: number
  embeddedAssetCount: number
  uniqueMediaCount: number
  deduplicatedAssetCount: number
  missingAssetIds: string[]
  missingMediaPolicy: ProjectPackageMissingMediaPolicy
  mediaScope: 'all' | 'selected'
  receiptsRequested: boolean
  agentProvenanceRequested: boolean
  createdAt: string
}

export type InterchangeLossEntryProjection = {
  code: string
  severity: 'info' | 'warning'
  feature: string
  nodeId: string
  preservation: 'otio-standard' | 'kun-metadata'
  message: string
}

export type InterchangeLossManifestProjection = {
  adapterId: 'kun.otio-json'
  adapterVersion: '1.0.0'
  portableLossless: boolean
  kunRoundTripLossless: boolean
  entries: InterchangeLossEntryProjection[]
  truncated: number
}

export type OtioExportTicket = {
  schemaVersion: 1
  jobId: string
  projectId: string
  sequenceId: string
  pinnedRevision: number
  adapterId: 'kun.otio-json'
  adapterVersion: '1.0.0'
  documentDigest: string
  projectDigest: string
  documentBytes: number
  lossManifest: InterchangeLossManifestProjection
  createdAt: string
}

export type OtioTimecodeMappingProjection = {
  id: string
  sequenceId: string
  startFrame: number
  endFrame: number
  startTimecode: string
  endTimecode: string
  frameRate: Rational
}

export type OtioImportPreview = {
  inputHandleId: string
  displayName: string
  sourceDocumentDigest: string
  sourceProjectId: string
  sourceProjectRevision: number
  suggestedProjectId: string
  fidelity: 'kun-metadata' | 'portable-otio'
  project: {
    id: string
    name: string
    revision: number
    activeSequenceId: string
    counts: {
      assets: number
      sequences: number
      tracks: number
      items: number
      captions: number
      transcripts: number
    }
  }
  mediaRelinkRequired: string[]
  timecodeMappings: OtioTimecodeMappingProjection[]
  timecodeMappingsTruncated: number
  lossManifest: InterchangeLossManifestProjection
}

export type DerivedMediaKind = 'waveform' | 'thumbnail' | 'filmstrip' | 'transcript' | 'analysis' | 'embedding' | 'proxy' | 'proof' | 'preview'
export type DerivedMediaStatus = 'queued' | 'running' | 'partial' | 'ready' | 'failed' | 'cancelled' | 'interrupted' | 'invalid'

export type DerivedMediaRecordProjection = {
  schemaVersion: 1
  id: string
  generation: number
  statusGeneration: number
  kind: DerivedMediaKind
  projectId?: string
  assetId?: string
  status: DerivedMediaStatus
  priority: 'background' | 'user' | 'interactive' | 'export'
  bytes: number
  pinned: boolean
  attempt: number
  jobId?: string
  progress?: { completed: number; total: number; unit: string; message?: string }
  error?: { code: string; message: string; retryable: boolean }
  retryAfter?: string
  artifactHandleId?: string
  createdAt: string
  updatedAt: string
}

export type DerivedStorageUsageProjection = {
  quotaBytes: number
  usedBytes: number
  readyBytes: number
  recordCount: number
  pinnedCount: number
  evictableCount: number
}

export type PreviewSourceProjection =
  | { kind: 'asset'; assetId: string; startUs: number; endUs: number }
  | {
      kind: 'timeline'
      sequenceId: string
      revision: number
      startFrame: number
      endFrame: number
      artifactId?: string
    }
  | { kind: 'generated'; assetId: string; jobId: string; variantIndex: number }

export type PreviewHistoryEntryProjection = {
  id: string
  projectId: string
  createdAt: string
  label: string
  source: PreviewSourceProjection
}

export type PreviewHistoryProjection = {
  schemaVersion: 1
  generation: number
  activeEntryId?: string
  entries: PreviewHistoryEntryProjection[]
}

export type PreviewComparisonProjection = {
  leftEntryId: string
  rightEntryId: string
  mode: 'wipe' | 'side-by-side'
  sameRevision: boolean
}

export type AudioAnalysisCapabilityProjection = {
  analysis: 'silence' | 'beat-grid' | 'sync-features'
  available: boolean
  algorithm?: string
  algorithmVersion?: string
  code?: string
  remediation?: string
  retryable?: boolean
  local: true
  networkUsed: false
}

export type AudioAnalysisCapabilitiesProjection = {
  schemaVersion: 1
  probedAt: string
  analyses: AudioAnalysisCapabilityProjection[]
}

export type DenoiseMetadataCapabilityProjection = {
  outcome: 'ready' | 'unavailable'
  descriptor?: {
    adapterId: string
    adapterVersion: string
    algorithm: string
    algorithmVersion: string
    modelId?: string
    modelVersion?: string
  }
  code?: string
  remediation?: string
  retryable?: boolean
  local: true
  networkUsed: false
}

export type AudioAnalysisRecordProjection = {
  schemaVersion: 1
  id: string
  kind: 'vad' | 'beat-grid' | 'denoise-metadata' | 'audio-sync' | 'speaker-diarization' | 'visual-index'
  assetId?: string
  referenceAssetId?: string
  targetAssetId?: string
  completeness?: 'complete' | 'partial'
  silenceCount?: number
  safeSuggestionCount?: number
  suggestionConfidenceThreshold?: number
  markerCount?: number
  tempoBpm?: number
  snapTargets?: Array<{
    id: string
    frame: number
    kind: 'beat' | 'downbeat'
    confidence: number
  }>
  turnCount?: number
  identifiedTurnCount?: number
  uncertainTurnCount?: number
  indexedSampleCount?: number
  plannedSampleCount?: number
  omittedSampleCount?: number
  adapterId?: string
  adapterVersion?: string
  modelId?: string
  modelVersion?: string
  packageId?: string
  manifestSha256?: string
  intervalUs?: number
  maxFrames?: number
  samplingStrategy?: 'uniform-interval-v1'
  seed?: number
  proposedTargetDeltaUs?: number
  confidence?: number
  confidenceThreshold?: number
  separation?: number
  threshold?: number
  minimumSeparation?: number
  outcome?: 'ready' | 'uncertain'
  status?: 'ready' | 'low-confidence'
  noiseProfile?: {
    analyzedDurationUs: number
    sampleWindowCount: number
    levels: {
      noiseFloorDbfs: number
      averageRmsDbfs: number
      peakDbfs: number
      estimatedSnrDb: number
    }
    spectralBandCount: number
  }
  recommendation?: {
    reductionDb: number
    confidence: number
    disposition: 'preview-suggested' | 'review-required'
    autoApplyAllowed: false
    audioMutation: 'none'
  }
  metadataOnly?: true
  refusalReason?: string
  currentGrant?: boolean
  immutable: true
}

export type SpeakerAdapterProjection = {
  descriptor: {
    id: string
    version: string
    execution: 'local-model' | 'import'
    format?: 'kun-speaker-json-v1'
    modelId?: string
    modelVersion?: string
  }
  outcome: 'ready' | 'unavailable'
  code?: string
  remediation?: string
  local: true
  networkUsed: false
}

export type SpeakerIdentityProjection = {
  id: string
  label: string
  aliases: string[]
  sourceEvidenceIds: string[]
  createdAt: string
  updatedAt: string
}

export type SpeakerAttributionPlanProjection = {
  analysisId: string
  transcriptSegmentCount: number
  captionCount: number
  identifiedCount: number
  uncertainCount: number
  warnings: string[]
}

export type VisualProvisioningProjection = {
  schemaVersion: 1
  optIn: boolean
  state: 'disabled' | 'broker-unavailable' | 'missing' | 'downloading' | 'unverified' | 'inference-unavailable' | 'ready' | 'failed'
  code: string
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

export type VisualMomentPageProjection = {
  schemaVersion: 1
  indexId: string
  offset: number
  results: Array<{
    id: string
    assetId: string
    sourceRange: { assetId: string; startUs: number; endUs: number }
    score: number
    sampleId: string
    representativeUs: number
    modelConfidence?: number
  }>
  nextOffset?: number
  totalMatches: number
  completeness: 'complete' | 'partial'
  ranking: {
    semantics: 'uncalibrated-cosine'
    calibratedConfidence: false
    local: true
    networkUsed: false
    adapterId: string
    adapterVersion: string
    modelId: string
    modelVersion: string
    packageId: string
    manifestSha256: string
  }
}

export type MediaIntelligenceEvidenceProjection = {
  schemaVersion: 1
  recordId: string
  kind: 'visual-index' | 'vad' | 'speaker-diarization' | 'beat-grid' | 'denoise-metadata' | 'audio-sync'
  offset: number
  returned: number
  total: number
  nextOffset?: number
  completeness: 'complete' | 'partial' | 'not-applicable'
  evidence: Array<Record<string, string | number | boolean | string[]>>
}

export type AudioSyncPreviewProjection = {
  referenceItemId: string
  targetItemId: string
  targetFrameBefore: number
  targetFrameAfter: number
  deltaFrames: number
  confidence: number
  outcome: 'ready' | 'uncertain'
  refusalReason?: string
  analysisId: string
}

export type MediaIntelligenceProgressProjection = {
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

export type GenerationRecordProjection = {
  schemaVersion: 1
  id: string
  generation: number
  projectId: string
  projectRevision: number
  providerId: string
  modelId: string
  task: GenerationTask
  promptDigest: string
  referenceAssetIds: string[]
  variantsRequested: number
  quote: {
    quoteId: string
    currency: string
    minimumMinor: number
    maximumMinor: number
    estimateOnly: boolean
  }
  placeholder: {
    assetId: string
    displayName: string
    kind: GenerationOutputKind
    state: 'pending' | 'resolved' | 'failed' | 'cancelled' | 'interrupted'
  }
  state: 'placeholder' | 'queued' | 'running' | 'cancelling' | 'ready' | 'failed' | 'cancelled' | 'interrupted'
  attempt: number
  progress?: { completed: number; total: number; unit: string; message?: string }
  outputs: Array<{
    id: string
    assetId: string
    displayName: string
    kind: GenerationOutputKind
    mimeType: string
    byteSize?: number
    width?: number
    height?: number
    durationUs?: number
    sampleRate?: number
    channels?: number
    primary: boolean
    createdAt: string
  }>
  error?: { code: string; message: string; retryable: boolean }
  createdAt: string
  updatedAt: string
}

export type GenerationStateProjection = {
  catalog: GenerationCatalog
  outcome: 'available' | 'unavailable'
  unavailableMessage?: string
  records: GenerationRecordProjection[]
  recoveryDiagnostics: string[]
}

export type EditorNotice = {
  id: string
  severity: 'info' | 'warning' | 'error'
  message: string
  messageKey?: MessageKey
  messageValues?: Readonly<Record<string, string | number>>
  interactionRequired?: boolean
  retryable?: boolean
  capabilityDetails?: RenderCapabilityDetail[]
}

export type EditorWorkspace = 'script' | 'clips' | 'timeline' | 'properties' | 'output'

export type PersistedEditorState = {
  schemaVersion: 1
  projectId?: string
  selectedItemId?: string
  playheadFrame: number
  activeRunId?: string
  activeWorkspace: EditorWorkspace
  renderTickets: RenderTicket[]
  projectPackageTickets: ProjectPackageTicket[]
  otioExportTickets: OtioExportTicket[]
  transcriptWindowStart: number
}

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline'

export type EditorState = {
  initialized: boolean
  busy: boolean
  connection: ConnectionState
  reconnectToken: number
  theme?: Theme
  locale?: Locale
  mediaCapabilities?: MediaCapabilities
  resultPreview?: ResultPreviewOpenPayload
  projects: ProjectSummary[]
  project?: ProjectProjection
  mediaLibrary?: MediaLibraryPageProjection
  selectedItemId?: string
  selectedCaptionId?: string
  selectedAssetId?: string
  playheadFrame: number
  playing: boolean
  media: Record<string, MediaMetadata>
  leases: Record<string, MediaResourceLease>
  activeMediaHandleId?: string
  activeMediaUrl?: string
  revokedHandles: string[]
  script?: { revision: number; digest: string; markdown: string; dirty: boolean }
  agentRun?: AgentRun
  agentEvents: AgentRunEvent[]
  jobs: JobSnapshot[]
  jobEvents: Record<string, JobEvent[]>
  activeWorkspace: EditorWorkspace
  renderTickets: RenderTicket[]
  projectPackageTickets: ProjectPackageTicket[]
  otioExportTickets: OtioExportTicket[]
  otioImportPreview?: OtioImportPreview
  derivedRecords: DerivedMediaRecordProjection[]
  derivedUsage?: DerivedStorageUsageProjection
  derivedRecoveryDiagnostics: string[]
  previewHistory: PreviewHistoryProjection
  previewComparison?: PreviewComparisonProjection
  audioAnalysisCapabilities?: AudioAnalysisCapabilitiesProjection
  denoiseMetadataCapability?: DenoiseMetadataCapabilityProjection
  audioAnalysisRecords: AudioAnalysisRecordProjection[]
  visualProvisioning?: VisualProvisioningProjection
  visualMomentPage?: VisualMomentPageProjection
  mediaIntelligenceOperations: MediaIntelligenceProgressProjection[]
  mediaIntelligenceEvidence?: MediaIntelligenceEvidenceProjection
  speakerAdapters: SpeakerAdapterProjection[]
  speakerIdentities: SpeakerIdentityProjection[]
  speakerAttributionPlan?: SpeakerAttributionPlanProjection
  audioSyncPreview?: AudioSyncPreviewProjection
  generation: GenerationStateProjection
  notices: EditorNotice[]
  lastProjectChange?: ProjectChange
  conflict?: { expectedRevision: number; currentRevision?: number }
  transcriptWindowStart: number
  timelineWindowStart: number
}

export const INITIAL_EDITOR_STATE: EditorState = {
  initialized: false,
  busy: false,
  connection: 'connecting',
  reconnectToken: 0,
  projects: [],
  playheadFrame: 0,
  playing: false,
  media: {},
  leases: {},
  revokedHandles: [],
  agentEvents: [],
  jobs: [],
  jobEvents: {},
  activeWorkspace: 'script',
  renderTickets: [],
  projectPackageTickets: [],
  otioExportTickets: [],
  derivedRecords: [],
  derivedRecoveryDiagnostics: [],
  previewHistory: { schemaVersion: 1, generation: 0, entries: [] },
  audioAnalysisRecords: [],
  speakerAdapters: [],
  speakerIdentities: [],
  mediaIntelligenceOperations: [],
  generation: {
    catalog: { schemaVersion: 1, revision: 'generation-unavailable', generatedAt: new Date(0).toISOString(), providers: [] },
    outcome: 'unavailable',
    records: [],
    recoveryDiagnostics: []
  },
  notices: [],
  transcriptWindowStart: 0,
  timelineWindowStart: 0
}

export type EditorAction =
  | { type: 'initialized'; persisted?: PersistedEditorState }
  | { type: 'busy'; value: boolean }
  | { type: 'connection'; value: ConnectionState }
  | { type: 'reconnect' }
  | { type: 'theme'; value: Theme }
  | { type: 'locale'; value: Locale }
  | { type: 'media-capabilities'; value: MediaCapabilities }
  | { type: 'result-preview'; value: ResultPreviewOpenPayload }
  | { type: 'projects'; value: ProjectSummary[] }
  | { type: 'project'; value: ProjectProjection }
  | { type: 'media-library'; value: MediaLibraryPageProjection }
  | { type: 'clear-project' }
  | {
      type: 'selection-synced'
      projectId: string
      revision: number
      generation: number
      eventGeneration: number
      selection: ProjectProjection['selection']
    }
  | { type: 'selection'; itemId?: string; captionId?: string; assetId?: string }
  | { type: 'seek'; frame: number }
  | { type: 'playing'; value: boolean }
  | { type: 'media'; value: MediaMetadata[] }
  | { type: 'lease'; value: MediaResourceLease }
  | { type: 'lease-release'; handleId: string }
  | { type: 'active-media'; handleId?: string; url?: string }
  | { type: 'media-revoked'; handleId: string }
  | { type: 'script'; revision: number; digest: string; markdown: string }
  | { type: 'script-edit'; markdown: string }
  | { type: 'agent-run'; value?: AgentRun }
  | { type: 'agent-event'; value: AgentRunEvent }
  | { type: 'jobs'; value: JobSnapshot[] }
  | { type: 'job-event'; value: JobEvent }
  | { type: 'active-workspace'; value: EditorWorkspace }
  | { type: 'render-ticket'; value: RenderTicket }
  | { type: 'project-package-ticket'; value: ProjectPackageTicket }
  | { type: 'otio-export-ticket'; value: OtioExportTicket }
  | { type: 'otio-import-preview'; value?: OtioImportPreview }
  | {
      type: 'derived'
      projectId: string
      revision: number
      records: DerivedMediaRecordProjection[]
      usage?: DerivedStorageUsageProjection
      recoveryDiagnostics?: string[]
    }
  | { type: 'derived-record'; value: DerivedMediaRecordProjection }
  | { type: 'preview-history'; projectId: string; value: PreviewHistoryProjection }
  | { type: 'preview-comparison'; projectId: string; value?: PreviewComparisonProjection }
  | {
      type: 'audio-analysis-state'
      projectId: string
      revision: number
      capabilities?: AudioAnalysisCapabilitiesProjection
      denoiseMetadataCapability?: DenoiseMetadataCapabilityProjection
      visualProvisioning?: VisualProvisioningProjection
      visualMomentPage?: VisualMomentPageProjection
      clearVisualMomentPage?: boolean
      records?: AudioAnalysisRecordProjection[]
      operations?: MediaIntelligenceProgressProjection[]
      evidence?: MediaIntelligenceEvidenceProjection
      speakerAdapters?: SpeakerAdapterProjection[]
      speakerIdentities?: SpeakerIdentityProjection[]
      speakerAttributionPlan?: SpeakerAttributionPlanProjection
      clearSpeakerAttributionPlan?: boolean
      syncPreview?: AudioSyncPreviewProjection
      clearSyncPreview?: boolean
    }
  | { type: 'media-intelligence-progress'; value: MediaIntelligenceProgressProjection }
  | { type: 'generation-state'; projectId?: string; value: GenerationStateProjection }
  | { type: 'generation-record'; value: GenerationRecordProjection }
  | { type: 'notice'; value: EditorNotice }
  | { type: 'project-change'; value: ProjectChange }
  | { type: 'dismiss-notice'; id: string }
  | { type: 'conflict'; expectedRevision: number; currentRevision?: number }
  | { type: 'clear-conflict' }
  | { type: 'transcript-window'; start: number }
  | { type: 'timeline-window'; start: number }

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'initialized': {
      const restored = action.persisted
      return {
        ...state,
        initialized: true,
        connection: 'online',
        ...(restored?.selectedItemId ? { selectedItemId: restored.selectedItemId } : {}),
        playheadFrame: restored?.playheadFrame ?? state.playheadFrame,
        activeWorkspace: restored?.activeWorkspace ?? state.activeWorkspace,
        renderTickets: restored?.renderTickets.slice(-VIEW_LIMITS.jobs) ?? state.renderTickets,
        projectPackageTickets: restored?.projectPackageTickets.slice(-VIEW_LIMITS.jobs) ?? state.projectPackageTickets,
        otioExportTickets: restored?.otioExportTickets.slice(-VIEW_LIMITS.jobs) ?? state.otioExportTickets,
        transcriptWindowStart: restored?.transcriptWindowStart ?? state.transcriptWindowStart
      }
    }
    case 'busy': return { ...state, busy: action.value }
    case 'connection': return { ...state, connection: action.value }
    case 'reconnect': return { ...state, connection: 'reconnecting', reconnectToken: state.reconnectToken + 1 }
    case 'theme': return { ...state, theme: action.value }
    case 'locale': return { ...state, locale: action.value }
    case 'media-capabilities': return { ...state, mediaCapabilities: action.value }
    case 'result-preview': return { ...state, resultPreview: action.value }
    case 'projects': return { ...state, projects: dedupeById(action.value).slice(0, VIEW_LIMITS.projects) }
    case 'project': {
      const project = boundProject(action.value)
      const switchingProject = state.project !== undefined && state.project.id !== project.id
      const revisionChanged = state.project?.id === project.id &&
        state.project.currentRevision !== project.currentRevision
      const hydrateSelection = switchingProject || state.project === undefined
      const mediaLibrary = state.mediaLibrary?.projectId === project.id &&
        state.mediaLibrary.revision === project.currentRevision
        ? state.mediaLibrary
        : undefined
      const selectedItemId = hydrateSelection
        ? project.selection.selectedItemIds.find((id) => project.items.some((item) => item.id === id))
        : state.selectedItemId && project.items.some(({ id }) => id === state.selectedItemId)
          ? state.selectedItemId
          : undefined
      const projectTicketIds = new Set(
        [
          ...state.renderTickets.filter(({ projectId }) => projectId === project.id),
          ...state.projectPackageTickets.filter(({ projectId }) => projectId === project.id),
          ...state.otioExportTickets.filter(({ projectId }) => projectId === project.id)
        ].map(({ jobId }) => jobId)
      )
      return {
        ...state,
        project,
        selectedItemId,
        selectedCaptionId: hydrateSelection
          ? project.selection.selectedCaptionIds.find((id) => project.captions.some((caption) => caption.id === id))
          : state.selectedCaptionId && project.captions.some(({ id }) => id === state.selectedCaptionId)
            ? state.selectedCaptionId
            : undefined,
        selectedAssetId: hydrateSelection
          ? project.selection.selectedAssetIds[0] ?? project.assets[0]?.id
          : state.selectedAssetId ?? project.assets[0]?.id,
        mediaLibrary,
        playheadFrame: hydrateSelection
          ? Math.min(project.selection.playheadFrame, Math.max(0, project.durationFrames))
          : Math.min(state.playheadFrame, Math.max(0, project.durationFrames)),
        ...(switchingProject ? {
          playing: false,
          media: {},
          leases: {},
          activeMediaHandleId: undefined,
          activeMediaUrl: undefined,
          revokedHandles: [],
          script: undefined,
          agentRun: undefined,
          agentEvents: [],
          jobs: state.jobs.filter(({ id }) => projectTicketIds.has(id)),
          derivedRecords: [],
          derivedUsage: undefined,
          derivedRecoveryDiagnostics: [],
          previewHistory: { schemaVersion: 1, generation: 0, entries: [] },
          previewComparison: undefined,
          audioAnalysisCapabilities: undefined,
          denoiseMetadataCapability: undefined,
          audioAnalysisRecords: [],
          visualProvisioning: undefined,
          visualMomentPage: undefined,
          speakerAdapters: [],
          speakerIdentities: [],
          speakerAttributionPlan: undefined,
          mediaIntelligenceOperations: [],
          mediaIntelligenceEvidence: undefined,
          audioSyncPreview: undefined,
          generation: { ...state.generation, records: [], recoveryDiagnostics: [] },
          jobEvents: Object.fromEntries(
            Object.entries(state.jobEvents).filter(([jobId]) => projectTicketIds.has(jobId))
          ),
          timelineWindowStart: 0,
          transcriptWindowStart: 0
        } : {}),
        ...(revisionChanged ? {
          audioSyncPreview: undefined,
          speakerAttributionPlan: undefined,
          visualMomentPage: undefined
        } : {}),
        conflict: undefined
      }
    }
    case 'media-library': {
      if (
        state.project?.id !== action.value.projectId ||
        state.project.currentRevision !== action.value.revision
      ) return state
      return {
        ...state,
        mediaLibrary: {
          ...action.value,
          assets: dedupeById(action.value.assets).slice(0, VIEW_LIMITS.assets)
        }
      }
    }
    case 'selection-synced': {
      if (
        state.project?.id !== action.projectId ||
        state.project.currentRevision !== action.revision ||
        action.generation < state.project.selection.generation ||
        action.eventGeneration < state.project.eventGeneration
      ) return state
      return {
        ...state,
        project: {
          ...state.project,
          eventGeneration: action.eventGeneration,
          selection: action.selection
        }
      }
    }
    case 'clear-project': return {
      ...state,
      project: undefined,
      mediaLibrary: undefined,
      selectedItemId: undefined,
      selectedCaptionId: undefined,
      selectedAssetId: undefined,
      playing: false,
      media: {},
      leases: {},
      activeMediaHandleId: undefined,
      activeMediaUrl: undefined,
      revokedHandles: [],
      script: undefined,
      playheadFrame: 0,
      agentRun: undefined,
      agentEvents: [],
      jobs: [],
      derivedRecords: [],
      derivedUsage: undefined,
      derivedRecoveryDiagnostics: [],
      previewHistory: { schemaVersion: 1, generation: 0, entries: [] },
      previewComparison: undefined,
      audioAnalysisCapabilities: undefined,
      denoiseMetadataCapability: undefined,
      audioAnalysisRecords: [],
      visualProvisioning: undefined,
      visualMomentPage: undefined,
      speakerAdapters: [],
      speakerIdentities: [],
      speakerAttributionPlan: undefined,
      mediaIntelligenceOperations: [],
      mediaIntelligenceEvidence: undefined,
      audioSyncPreview: undefined,
      generation: { ...state.generation, records: [], recoveryDiagnostics: [] },
      jobEvents: {},
      timelineWindowStart: 0,
      transcriptWindowStart: 0,
      conflict: undefined
    }
    case 'selection': return {
      ...state,
      ...(Object.prototype.hasOwnProperty.call(action, 'itemId') ? { selectedItemId: action.itemId } : {}),
      ...(Object.prototype.hasOwnProperty.call(action, 'captionId') ? { selectedCaptionId: action.captionId } : {}),
      ...(Object.prototype.hasOwnProperty.call(action, 'assetId') ? { selectedAssetId: action.assetId } : {})
    }
    case 'seek': return {
      ...state,
      playheadFrame: Math.max(0, Math.min(Math.round(action.frame), state.project?.durationFrames ?? Number.MAX_SAFE_INTEGER))
    }
    case 'playing': return { ...state, playing: action.value }
    case 'media': {
      const media = { ...state.media }
      for (const item of action.value.slice(0, VIEW_LIMITS.assets)) media[item.handleId] = item
      return { ...state, media: boundRecord(media, VIEW_LIMITS.assets) }
    }
    case 'lease': return {
      ...state,
      leases: boundRecord({ ...state.leases, [action.value.handleId]: action.value }, VIEW_LIMITS.mediaLeases),
      revokedHandles: state.revokedHandles.filter((id) => id !== action.value.handleId)
    }
    case 'lease-release': return {
      ...state,
      leases: omitKey(state.leases, action.handleId),
      ...(state.activeMediaHandleId === action.handleId
        ? { activeMediaHandleId: undefined, activeMediaUrl: undefined, playing: false }
        : {})
    }
    case 'active-media': return { ...state, activeMediaHandleId: action.handleId, activeMediaUrl: action.url }
    case 'media-revoked': return {
      ...state,
      revokedHandles: [...new Set([...state.revokedHandles, action.handleId])].slice(-VIEW_LIMITS.assets),
      leases: omitKey(state.leases, action.handleId),
      ...(state.activeMediaHandleId === action.handleId
        ? { activeMediaHandleId: undefined, activeMediaUrl: undefined, playing: false }
        : {})
    }
    case 'script': return {
      ...state,
      script: { revision: action.revision, digest: action.digest, markdown: action.markdown, dirty: false }
    }
    case 'script-edit': return state.script
      ? { ...state, script: { ...state.script, markdown: action.markdown.slice(0, 262_144), dirty: true } }
      : state
    case 'agent-run': return { ...state, agentRun: action.value }
    case 'agent-event': return {
      ...state,
      agentEvents: mergeSequenced(state.agentEvents, action.value, VIEW_LIMITS.agentEvents)
    }
    case 'jobs': return { ...state, jobs: mergeJobSnapshots(state.jobs, action.value) }
    case 'job-event': {
      const jobEvents = {
        ...state.jobEvents,
        [action.value.jobId]: mergeSequenced(
          state.jobEvents[action.value.jobId] ?? [],
          action.value,
          VIEW_LIMITS.agentEvents
        )
      }
      const current = state.jobs.find(({ id }) => id === action.value.jobId)
      const jobs = current
        ? state.jobs.map((job) => job.id === action.value.jobId ? snapshotFromEvent(job, action.value) : job)
        : state.jobs
      return { ...state, jobs: boundJobs(jobs), jobEvents: boundRecord(jobEvents, VIEW_LIMITS.jobs) }
    }
    case 'active-workspace': return { ...state, activeWorkspace: action.value }
    case 'render-ticket': return {
      ...state,
      renderTickets: dedupeByKey([...state.renderTickets, action.value], 'jobId').slice(-VIEW_LIMITS.jobs)
    }
    case 'project-package-ticket': return {
      ...state,
      projectPackageTickets: dedupeByKey(
        [...state.projectPackageTickets, action.value],
        'jobId'
      ).slice(-VIEW_LIMITS.jobs)
    }
    case 'otio-export-ticket': return {
      ...state,
      otioExportTickets: dedupeByKey(
        [...state.otioExportTickets, action.value],
        'jobId'
      ).slice(-VIEW_LIMITS.jobs)
    }
    case 'otio-import-preview': return { ...state, otioImportPreview: action.value }
    case 'derived': {
      if (
        state.project?.id !== action.projectId ||
        state.project.currentRevision !== action.revision
      ) return state
      const incomingIds = new Set(action.records.map(({ id }) => id))
      return {
        ...state,
        derivedRecords: mergeDerivedRecords(state.derivedRecords, action.records)
          .filter(({ id }) => incomingIds.has(id))
          .filter(({ projectId }) => projectId === undefined || projectId === action.projectId)
          .slice(0, VIEW_LIMITS.derivedRecords),
        ...(action.usage ? { derivedUsage: action.usage } : {}),
        derivedRecoveryDiagnostics: action.recoveryDiagnostics?.slice(0, 32) ?? state.derivedRecoveryDiagnostics
      }
    }
    case 'derived-record': {
      if (state.project?.id !== action.value.projectId) return state
      return {
        ...state,
        derivedRecords: mergeDerivedRecords(state.derivedRecords, [action.value])
          .slice(0, VIEW_LIMITS.derivedRecords)
      }
    }
    case 'preview-history': {
      if (state.project?.id !== action.projectId) return state
      return {
        ...state,
        previewHistory: boundPreviewHistory(action.value),
        ...(state.previewComparison && (
          !action.value.entries.some(({ id }) => id === state.previewComparison?.leftEntryId) ||
          !action.value.entries.some(({ id }) => id === state.previewComparison?.rightEntryId)
        ) ? { previewComparison: undefined } : {})
      }
    }
    case 'preview-comparison': return state.project?.id === action.projectId
      ? { ...state, previewComparison: action.value }
      : state
    case 'audio-analysis-state': {
      if (
        state.project?.id !== action.projectId ||
        state.project.currentRevision !== action.revision
      ) return state
      return {
        ...state,
        ...(action.capabilities ? { audioAnalysisCapabilities: action.capabilities } : {}),
        ...(action.denoiseMetadataCapability ? { denoiseMetadataCapability: action.denoiseMetadataCapability } : {}),
        ...(action.visualProvisioning ? { visualProvisioning: action.visualProvisioning } : {}),
        ...(action.visualMomentPage ? { visualMomentPage: action.visualMomentPage } : {}),
        ...(action.clearVisualMomentPage ? { visualMomentPage: undefined } : {}),
        ...(action.records ? { audioAnalysisRecords: action.records.slice(0, 512) } : {}),
        ...(action.operations ? {
          mediaIntelligenceOperations: mergeAnalysisProgress(
            state.mediaIntelligenceOperations,
            action.operations
          )
        } : {}),
        ...(action.evidence ? { mediaIntelligenceEvidence: action.evidence } : {}),
        ...(action.speakerAdapters ? { speakerAdapters: action.speakerAdapters.slice(0, 16) } : {}),
        ...(action.speakerIdentities ? { speakerIdentities: action.speakerIdentities.slice(0, 256) } : {}),
        ...(action.speakerAttributionPlan ? { speakerAttributionPlan: action.speakerAttributionPlan } : {}),
        ...(action.clearSpeakerAttributionPlan ? { speakerAttributionPlan: undefined } : {}),
        ...(action.syncPreview ? { audioSyncPreview: action.syncPreview } : {}),
        ...(action.clearSyncPreview ? { audioSyncPreview: undefined } : {})
      }
    }
    case 'media-intelligence-progress': {
      if (
        state.project?.id !== action.value.projectId ||
        state.project.currentRevision !== action.value.projectRevision
      ) return state
      return {
        ...state,
        mediaIntelligenceOperations: mergeAnalysisProgress(
          state.mediaIntelligenceOperations,
          [action.value]
        )
      }
    }
    case 'generation-state': {
      if (action.projectId && action.projectId !== state.project?.id) return state
      return {
        ...state,
        generation: {
          ...action.value,
          records: mergeGenerationRecords([], action.value.records)
            .slice(0, VIEW_LIMITS.generationRecords),
          recoveryDiagnostics: action.value.recoveryDiagnostics.slice(0, 32)
        }
      }
    }
    case 'generation-record': {
      if (action.value.projectId !== state.project?.id) return state
      return {
        ...state,
        generation: {
          ...state.generation,
          records: mergeGenerationRecords(state.generation.records, [action.value])
            .slice(0, VIEW_LIMITS.generationRecords)
        }
      }
    }
    case 'notice': return {
      ...state,
      notices: dedupeByKey([...state.notices, action.value], 'id').slice(-VIEW_LIMITS.notices)
    }
    case 'project-change': {
      const previous = state.lastProjectChange
      if (
        previous?.projectId === action.value.projectId &&
        previous.generation !== undefined &&
        action.value.generation !== undefined &&
        action.value.generation < previous.generation
      ) return state
      return { ...state, lastProjectChange: action.value }
    }
    case 'dismiss-notice': return { ...state, notices: state.notices.filter(({ id }) => id !== action.id) }
    case 'conflict': return {
      ...state,
      conflict: { expectedRevision: action.expectedRevision, currentRevision: action.currentRevision }
    }
    case 'clear-conflict': return { ...state, conflict: undefined }
    case 'transcript-window': return { ...state, transcriptWindowStart: Math.max(0, action.start) }
    case 'timeline-window': return { ...state, timelineWindowStart: Math.max(0, action.start) }
  }
}

export function toPersistedState(state: EditorState): PersistedEditorState {
  return {
    schemaVersion: 1,
    ...(state.selectedItemId ? { selectedItemId: state.selectedItemId } : {}),
    playheadFrame: state.playheadFrame,
    ...(state.agentRun ? { activeRunId: state.agentRun.id } : {}),
    activeWorkspace: state.activeWorkspace,
    renderTickets: state.renderTickets.slice(-VIEW_LIMITS.jobs),
    projectPackageTickets: state.projectPackageTickets.slice(-VIEW_LIMITS.jobs),
    otioExportTickets: state.otioExportTickets.slice(-VIEW_LIMITS.jobs),
    transcriptWindowStart: state.transcriptWindowStart
  }
}

export function proofIsStale(ticket: RenderTicket, project?: ProjectProjection): boolean {
  return Boolean(project && ticket.projectId === project.id && ticket.pinnedRevision !== project.currentRevision)
}

export function transcriptFrame(
  project: Pick<ProjectProjection, 'fps'>,
  segment: Pick<TranscriptSegmentProjection, 'startUs'>
): number {
  return Math.max(0, Math.round(
    segment.startUs * project.fps.numerator / project.fps.denominator / 1_000_000
  ))
}

export function frameToSeconds(project: Pick<ProjectProjection, 'fps'>, frame: number): number {
  return frame * project.fps.denominator / project.fps.numerator
}

export function activeTranscriptSegment(
  project: ProjectProjection,
  assetId: string | undefined,
  frame: number
): TranscriptSegmentProjection | undefined {
  if (!assetId) return undefined
  const item = project.items.find((candidate) =>
    candidate.assetId === assetId &&
    candidate.timelineStartFrame <= frame &&
    frame < candidate.timelineStartFrame + candidate.durationFrames
  )
  if (!item) return undefined
  const timelineDeltaFrames = frame - item.timelineStartFrame
  const sourceUs = item.sourceStartUs + Math.round(
    timelineDeltaFrames * 1_000_000 * project.fps.denominator * item.speed.numerator /
    (project.fps.numerator * item.speed.denominator)
  )
  return project.transcripts
    .find((transcript) => transcript.assetId === assetId)
    ?.segments.find((segment) => segment.startUs <= sourceUs && sourceUs < segment.endUs)
}

export type TimelineSource = {
  item: ItemProjection
  asset: AssetProjection
  sourceTimeUs: number
  playbackRate: number
}

export function timelineSourceAtFrame(
  project: ProjectProjection,
  frame: number
): TimelineSource | undefined {
  const trackOrder = new Map(project.tracks.map((track) => [track.id, track.order]))
  const item = project.items
    .filter((candidate) =>
      candidate.timelineStartFrame <= frame &&
      frame < candidate.timelineStartFrame + candidate.durationFrames
    )
    .sort((left, right) =>
      (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER) -
        (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id)
    )
    .find((candidate) => project.assets.some(({ id, kind }) => id === candidate.assetId && kind === 'video')) ??
    project.items
      .filter((candidate) =>
        candidate.timelineStartFrame <= frame &&
        frame < candidate.timelineStartFrame + candidate.durationFrames
      )
      .sort((left, right) =>
        (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER) -
          (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id)
      )[0]
  if (!item) return undefined
  const asset = project.assets.find(({ id }) => id === item.assetId)
  if (!asset) return undefined
  const timelineDeltaFrames = frame - item.timelineStartFrame
  const sourceTimeUs = Math.min(item.sourceEndUs, Math.max(item.sourceStartUs,
    item.sourceStartUs + Math.round(
      timelineDeltaFrames * 1_000_000 * project.fps.denominator * item.speed.numerator /
      (project.fps.numerator * item.speed.denominator)
    )
  ))
  return {
    item,
    asset,
    sourceTimeUs,
    playbackRate: item.speed.numerator / item.speed.denominator
  }
}

export function projectFrameFromSourceTime(
  project: Pick<ProjectProjection, 'fps'>,
  source: Pick<TimelineSource, 'item'>,
  sourceSeconds: number
): number {
  const sourceDeltaUs = Math.max(0, sourceSeconds * 1_000_000 - source.item.sourceStartUs)
  const timelineFrames = sourceDeltaUs * project.fps.numerator * source.item.speed.denominator /
    (1_000_000 * project.fps.denominator * source.item.speed.numerator)
  return source.item.timelineStartFrame + Math.round(timelineFrames)
}

export function activeCaptionAtFrame(
  project: ProjectProjection,
  frame: number
): CaptionProjection | undefined {
  return project.captions.find(({ startFrame, endFrame }) => startFrame <= frame && frame < endFrame)
}

function boundProject(project: ProjectProjection): ProjectProjection {
  let segments = VIEW_LIMITS.transcriptSegments
  return {
    ...project,
    assets: dedupeById(project.assets).slice(0, VIEW_LIMITS.assets),
    sequences: dedupeById(project.sequences).slice(0, VIEW_LIMITS.sequences),
    mediaFolders: dedupeById(project.mediaFolders).slice(0, VIEW_LIMITS.mediaFolders),
    linkGroups: dedupeById(project.linkGroups).slice(0, VIEW_LIMITS.items),
    tracks: dedupeById(project.tracks).slice(0, VIEW_LIMITS.tracks),
    items: dedupeById(project.items).slice(0, VIEW_LIMITS.items),
    captions: dedupeById(project.captions).slice(0, VIEW_LIMITS.captions),
    transcripts: dedupeById(project.transcripts).slice(0, VIEW_LIMITS.transcripts).map((transcript) => {
      const allowed = Math.max(0, segments)
      const items = transcript.segments.slice(0, allowed)
      segments -= items.length
      return { ...transcript, segments: items, truncated: transcript.truncated || transcript.segments.length > items.length }
    }),
    revisions: project.revisions.slice(-VIEW_LIMITS.revisions)
  }
}

function boundPreviewHistory(history: PreviewHistoryProjection): PreviewHistoryProjection {
  const entries = dedupeById(history.entries).slice(-VIEW_LIMITS.previewHistory)
  const ids = new Set(entries.map(({ id }) => id))
  return {
    schemaVersion: 1,
    generation: Math.max(0, Math.floor(history.generation)),
    ...(history.activeEntryId && ids.has(history.activeEntryId)
      ? { activeEntryId: history.activeEntryId }
      : {}),
    entries
  }
}

function boundJobs(jobs: JobSnapshot[]): JobSnapshot[] {
  return dedupeById(jobs)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, VIEW_LIMITS.jobs)
}

function mergeJobSnapshots(current: readonly JobSnapshot[], incoming: JobSnapshot[]): JobSnapshot[] {
  const currentById = new Map(current.map((snapshot) => [snapshot.id, snapshot]))
  return boundJobs(incoming.map((snapshot) => {
    const previous = currentById.get(snapshot.id)
    if (!previous) return snapshot
    const previousTerminal = isTerminalJobState(previous.state)
    const incomingTerminal = isTerminalJobState(snapshot.state)
    if (previousTerminal !== incomingTerminal) return previousTerminal ? previous : snapshot
    return snapshot.updatedAt >= previous.updatedAt ? snapshot : previous
  }))
}

function mergeDerivedRecords(
  current: readonly DerivedMediaRecordProjection[],
  incoming: readonly DerivedMediaRecordProjection[]
): DerivedMediaRecordProjection[] {
  const records = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) {
    const previous = records.get(record.id)
    if (
      !previous ||
      record.generation > previous.generation ||
      (record.generation === previous.generation && record.statusGeneration >= previous.statusGeneration)
    ) records.set(record.id, record)
  }
  return [...records.values()].sort((left, right) =>
    right.generation - left.generation || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  )
}

function mergeAnalysisProgress(
  current: readonly MediaIntelligenceProgressProjection[],
  incoming: readonly MediaIntelligenceProgressProjection[]
): MediaIntelligenceProgressProjection[] {
  const values = new Map(current.map((progress) => [progress.operationId, progress]))
  for (const progress of incoming) {
    const previous = values.get(progress.operationId)
    if (!previous || progress.generation >= previous.generation) values.set(progress.operationId, progress)
  }
  return [...values.values()]
    .sort((left, right) => right.generation - left.generation || left.operationId.localeCompare(right.operationId))
    .slice(0, 100)
}

function mergeGenerationRecords(
  current: readonly GenerationRecordProjection[],
  incoming: readonly GenerationRecordProjection[]
): GenerationRecordProjection[] {
  const values = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) {
    const previous = values.get(record.id)
    if (!previous || record.generation >= previous.generation) values.set(record.id, record)
  }
  return [...values.values()].sort((left, right) =>
    right.generation - left.generation || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
  )
}

function isTerminalJobState(state: JobSnapshot['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function snapshotFromEvent(snapshot: JobSnapshot, event: JobEvent): JobSnapshot {
  return {
    ...snapshot,
    state: event.state,
    updatedAt: event.timestamp,
    executionAttempt: event.executionAttempt,
    latestCursor: event.cursor,
    ...(event.progress ? { progress: event.progress } : {}),
    ...(event.result ? { result: event.result } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(['completed', 'failed', 'cancelled', 'interrupted'].includes(event.state)
      ? { terminalAt: event.timestamp }
      : {})
  }
}

function mergeSequenced<T extends { sequence: number }>(current: T[], next: T, limit: number): T[] {
  const bySequence = new Map(current.map((value) => [value.sequence, value]))
  bySequence.set(next.sequence, next)
  return [...bySequence.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit)
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  return dedupeByKey(items, 'id')
}

function dedupeByKey<T, K extends keyof T>(items: readonly T[], key: K): T[] {
  const values = new Map<T[K], T>()
  for (const item of items) values.set(item[key], item)
  return [...values.values()]
}

function boundRecord<T>(record: Record<string, T>, limit: number): Record<string, T> {
  return Object.fromEntries(Object.entries(record).slice(-limit))
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key))
}

export function generatedArtifacts(snapshot: JobSnapshot): GeneratedArtifact[] {
  return snapshot.result?.generatedArtifacts.slice(0, 64) ?? []
}
