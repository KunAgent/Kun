import { engineError } from './errors.js'
import { validateMulticamGroup, type MulticamGroup } from './multicam.js'

export const PROJECT_SCHEMA_VERSION = 2 as const
export const MAX_PROJECT_HISTORY = 50

export const PROJECT_LIMITS = Object.freeze({
  assets: 512,
  mediaFolders: 256,
  sequences: 32,
  tracksPerSequence: 64,
  itemsPerSequence: 10_000,
  captionsPerSequence: 10_000,
  linkGroups: 2_048,
  linkGroupMembers: 32,
  transcripts: 512,
  transcriptSegments: 50_000,
  transcriptWordsPerSegment: 2_000,
  derivedReferences: 4_096,
  multicamGroups: 64,
  effectsPerItem: 32,
  effectParameters: 64,
  keyframeTracksPerItem: 32,
  keyframePointsPerTrack: 2_048,
  selectedIds: 256,
  receiptIds: 256,
  receiptShifts: 64,
  receiptChanges: 64,
  receiptNotes: 16,
  recoveryEntries: 128
} as const)

export type Rational = {
  numerator: number
  denominator: number
}

export type CanvasPreset = '16:9' | '9:16' | '1:1'
export type CanvasFit = 'fit' | 'crop' | 'pad'
export type CanvasSettings = {
  preset: CanvasPreset
  width: number
  height: number
  fit: CanvasFit
  background: string
}

export type VideoStreamMetadata = {
  codec: string
  width: number
  height: number
  frameRate: Rational
  rotation?: 0 | 90 | 180 | 270
}

export type AudioStreamMetadata = {
  codec: string
  sampleRate: number
  channels: number
}

export type StillImageMetadata = {
  width: number
  height: number
  format: string
  animated: boolean
  frameRate?: Rational
  loop?: boolean
}

export type GeneratedAssetLineage = {
  providerId: string
  modelId: string
  jobId: string
  promptDigest?: string
  /** Legacy project field. New generation integrations persist only promptDigest. */
  prompt?: string
  referenceAssetIds: string[]
  variantOfAssetId?: string
}

export type MediaFolder = {
  id: string
  name: string
  parentId?: string
}

export type MediaAsset = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'image' | 'animation'
  mediaHandleId?: string
  workspaceRelativePath?: string
  durationUs: number
  container: string
  video?: VideoStreamMetadata
  audio?: AudioStreamMetadata
  still?: StillImageMetadata
  folderId?: string
  generatedLineage?: GeneratedAssetLineage
  transcriptIds: string[]
  availability?: 'online' | 'offline' | 'revoked' | 'changed'
  sourceIdentity?: SourceIdentity
  recovery?: {
    reason?: 'missing' | 'revoked' | 'changed' | 'manifest-unreadable'
    lastVerifiedAt?: string
    previousMediaHandleId?: string
  }
}

export type SourceIdentity = {
  algorithm: 'sha256'
  value: string
  sizeBytes?: number
  modifiedAt?: string
}

export type Track = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'caption'
  order: number
  overlap: 'reject' | 'mix'
  muted?: boolean
  locked?: boolean
  syncLocked?: boolean
}

export type Transform = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export type Crop = {
  left: number
  top: number
  right: number
  bottom: number
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay'

export type EffectParameter = number | string | boolean

export type EffectInstance = {
  id: string
  type: string
  enabled: boolean
  parameters: Record<string, EffectParameter>
}

export type KeyframePoint = {
  id: string
  frame: number
  value: number
}

export type KeyframeTrack = {
  id: string
  property: string
  interpolation: 'hold' | 'linear' | 'ease'
  points: KeyframePoint[]
}

export type TimelineItem = {
  id: string
  assetId: string
  trackId: string
  timelineStartFrame: number
  durationFrames: number
  sourceStartUs: number
  sourceEndUs: number
  speed: Rational
  transform: Transform
  opacity: number
  fadeInFrames: number
  fadeOutFrames: number
  linkGroupId?: string
  nestedSequenceId?: string
  crop?: Crop
  blendMode?: BlendMode
  volume?: number
  muted?: boolean
  visible?: boolean
  locked?: boolean
  effects?: EffectInstance[]
  keyframes?: KeyframeTrack[]
}

export type Caption = {
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
  speakerAttribution?: SpeakerAttributionEvidence
  words?: Array<{
    id: string
    text: string
    startFrame: number
    endFrame: number
    sourceWordId?: string
  }>
  animation?: {
    kind: 'none' | 'word-highlight' | 'fade'
    durationFrames?: number
  }
}

export type TranscriptWord = {
  id: string
  startUs: number
  endUs: number
  text: string
  confidence?: number
  provenance?: {
    adapterId: string
    sourceId?: string
  }
}

export type TranscriptSegment = {
  id: string
  startUs: number
  endUs: number
  text: string
  words?: TranscriptWord[]
  tags?: Array<'filler' | 'silence'>
  confidence?: number
  speakerAttribution?: SpeakerAttributionEvidence
  provenance?: {
    adapterId: string
    sourceId?: string
  }
}

/**
 * Revision-bound attribution derived from immutable diarization evidence.
 * Unknown, overlapping, and otherwise uncertain ranges intentionally omit an
 * identity so display code cannot accidentally promote weak evidence to fact.
 */
export type SpeakerAttributionEvidence = {
  analysisId: string
  speakerId?: string
  speakerLabel?: string
  confidence: number
  status: 'identified' | 'unknown' | 'overlap' | 'uncertain'
  sourceTurnIds: string[]
}

export type Transcript = {
  id: string
  assetId: string
  language: string
  provenance: 'srt' | 'vtt' | 'json' | 'local-asr'
  segments: TranscriptSegment[]
  adapter?: {
    id: string
    version: string
    modelId?: string
    execution: 'local' | 'import'
    sourceFormat?: 'srt' | 'vtt' | 'json'
  }
  sourceFingerprint?: SourceIdentity
}

export type SequenceViewState = {
  zoom: number
  scrollFrame: number
  open: boolean
}

export type Sequence = {
  id: string
  name: string
  tracks: Track[]
  items: TimelineItem[]
  captions: Caption[]
  viewState: SequenceViewState
}

export type LinkGroup = {
  id: string
  kind: 'av' | 'sync' | 'custom'
  itemIds: string[]
  locked: boolean
}

export type ProjectSelection = {
  generation: number
  revision: number
  sequenceId: string
  playheadFrame: number
  selectedAssetIds: string[]
  selectedItemIds: string[]
  selectedCaptionIds: string[]
  selectedWordIds: string[]
  range?: { startFrame: number; endFrame: number }
}

export type DerivedReference = {
  id: string
  kind: 'waveform' | 'thumbnail' | 'filmstrip' | 'transcript' | 'analysis' | 'embedding' | 'proxy' | 'proof' | 'preview'
  sourceAssetId?: string
  dependencyIds: string[]
  producerVersion: string
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'interrupted' | 'invalid'
  bytes: number
  pinned: boolean
  sourceFingerprint?: SourceIdentity
  updatedAt: string
  errorCode?: string
}

export type AgentUndoEntry = {
  revision: number
  actorId: string
  transactionId: string
}

export type ProjectRecoveryState = {
  mode: 'healthy' | 'write-blocked'
  recoveredFromRevision?: number
  unreadableManifestKinds: Array<'project' | 'media' | 'derived'>
  interruptedJobIds: string[]
  notes: string[]
}

export type RevisionAuthor = 'manual' | 'agent' | 'system'

export type AddItemOperation = { type: 'add-item'; item: TimelineItem }
export type SplitItemOperation = { type: 'split-item'; itemId: string; atFrame: number }
export type TrimItemOperation = {
  type: 'trim-item'
  itemId: string
  startFrame: number
  endFrame: number
}
export type DeleteItemOperation = { type: 'delete-item'; itemId: string }
export type MoveItemOperation = {
  type: 'move-item'
  itemId: string
  trackId: string
  timelineStartFrame: number
}
export type ReorderItemOperation = {
  type: 'reorder-item'
  itemId: string
  beforeItemId?: string
}
export type UpdateTransformOperation = {
  type: 'update-transform'
  itemId: string
  transform: Partial<Transform>
  opacity?: number
}
export type UpdateTrackStateOperation = {
  type: 'update-track-state'
  trackId: string
  muted?: boolean
  locked?: boolean
  syncLocked?: boolean
}
export type UpdateItemPropertiesOperation = {
  type: 'update-item-properties'
  itemId: string
  volume?: number
  fadeInFrames?: number
  fadeOutFrames?: number
  muted?: boolean
  visible?: boolean
  locked?: boolean
}
export type SetLinkGroupOperation = { type: 'set-link-group'; group: LinkGroup }
export type DeleteLinkGroupOperation = { type: 'delete-link-group'; linkGroupId: string }
export type CreateSequenceOperation = {
  type: 'create-sequence'
  sequenceId: string
  name: string
  activate?: boolean
}
/** Internal inverse/snapshot operation. Host parsers MUST NOT expose this variant. */
export type RestoreSequenceOperation = {
  type: 'restore-sequence'
  sequence: Sequence
  linkGroups: LinkGroup[]
  activate: boolean
}
export type DuplicateSequenceOperation = {
  type: 'duplicate-sequence'
  sourceSequenceId: string
  sequenceId: string
  name: string
  activate?: boolean
}
export type RenameSequenceOperation = { type: 'rename-sequence'; sequenceId: string; name: string }
export type SelectSequenceOperation = { type: 'select-sequence'; sequenceId: string }
export type OpenSequenceOperation = { type: 'open-sequence'; sequenceId: string }
export type CloseSequenceOperation = {
  type: 'close-sequence'
  sequenceId: string
  fallbackSequenceId?: string
}
export type DeleteSequenceOperation = { type: 'delete-sequence'; sequenceId: string }
export type SetSequenceViewOperation = {
  type: 'set-sequence-view'
  sequenceId: string
  zoom: number
  scrollFrame: number
}
export type SetItemKeyframesOperation = {
  type: 'set-item-keyframes'
  itemId: string
  keyframes: KeyframeTrack[]
}
export type SetItemEffectsOperation = {
  type: 'set-item-effects'
  itemId: string
  effects: EffectInstance[]
}
export type UpdateItemCompositionOperation = {
  type: 'update-item-composition'
  itemId: string
  crop?: Crop
  opacity?: number
  blendMode?: BlendMode
}
export type RetimeItemOperation = { type: 'retime-item'; itemId: string; speed: Rational }
export type AddCaptionOperation = { type: 'add-caption'; caption: Caption }
export type UpdateCaptionOperation = {
  type: 'update-caption'
  captionId: string
  patch: Partial<Omit<Caption, 'id'>>
}
export type DeleteCaptionOperation = { type: 'delete-caption'; captionId: string }
export type SetCanvasOperation = {
  type: 'set-canvas'
  preset: CanvasPreset
  fit: CanvasFit
}
export type SetMulticamGroupOperation = {
  type: 'set-multicam-group'
  group: MulticamGroup
}
export type DeleteMulticamGroupOperation = {
  type: 'delete-multicam-group'
  groupId: string
}
export type SwitchMulticamAngleOperation = {
  type: 'switch-multicam-angle'
  groupId: string
  memberId: string
  startFrame: number
  endFrame: number
  coveragePolicy?: 'reject' | 'clamp'
  minimumSyncConfidence?: number
}
export type ApplyMulticamLayoutOperation = {
  type: 'apply-multicam-layout'
  groupId: string
  layoutId: string
  startFrame: number
  endFrame: number
  coveragePolicy?: 'reject' | 'clamp'
  minimumSyncConfidence?: number
}
export type MergeMulticamProgramOperation = {
  type: 'merge-multicam-program'
  groupId: string
}

export type TimelineOperation =
  | AddItemOperation
  | SplitItemOperation
  | TrimItemOperation
  | DeleteItemOperation
  | MoveItemOperation
  | ReorderItemOperation
  | UpdateTransformOperation
  | UpdateTrackStateOperation
  | UpdateItemPropertiesOperation
  | SetLinkGroupOperation
  | DeleteLinkGroupOperation
  | CreateSequenceOperation
  | RestoreSequenceOperation
  | DuplicateSequenceOperation
  | RenameSequenceOperation
  | SelectSequenceOperation
  | OpenSequenceOperation
  | CloseSequenceOperation
  | DeleteSequenceOperation
  | SetSequenceViewOperation
  | SetItemKeyframesOperation
  | SetItemEffectsOperation
  | UpdateItemCompositionOperation
  | RetimeItemOperation
  | AddCaptionOperation
  | UpdateCaptionOperation
  | DeleteCaptionOperation
  | SetCanvasOperation
  | SetMulticamGroupOperation
  | DeleteMulticamGroupOperation
  | SwitchMulticamAngleOperation
  | ApplyMulticamLayoutOperation
  | MergeMulticamProgramOperation

export type Revision = {
  revision: number
  parentRevision: number | null
  author: RevisionAuthor
  actorId?: string
  transactionId?: string
  sourceOperation: string
  timestamp: string
  summary: string
  operations: TimelineOperation[]
  inverseOperations: TimelineOperation[]
  restoredFromRevision?: number
}

export type VideoProject = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fps: Rational
  canvas: CanvasSettings
  assets: MediaAsset[]
  mediaFolders?: MediaFolder[]
  /** Compatibility projection of the active sequence for the 0.3.x Host/Webview. */
  tracks: Track[]
  items: TimelineItem[]
  captions: Caption[]
  sequences: Sequence[]
  activeSequenceId: string
  linkGroups: LinkGroup[]
  selection: ProjectSelection
  transcripts: Transcript[]
  derivedReferences: DerivedReference[]
  /** Optional so schema-v2 projects written before multicam support still open without rewriting. */
  multicamGroups?: MulticamGroup[]
  currentRevision: number
  eventGeneration: number
  revisions: Revision[]
  undoStack: number[]
  redoStack: number[]
  agentUndoStack: AgentUndoEntry[]
  recovery: ProjectRecoveryState
}

export type ReceiptIdKind =
  | 'asset'
  | 'media-folder'
  | 'sequence'
  | 'track'
  | 'item'
  | 'caption'
  | 'link-group'
  | 'transcript'
  | 'derived'
  | 'multicam-group'
  | 'multicam-fragment'

export type ReceiptId = { kind: ReceiptIdKind; id: string }

export type UniformShift = {
  sequenceId: string
  trackId?: string
  fromFrame: number
  deltaFrames: number
  count: number
}

export type MutationReceipt = {
  schemaVersion: 1
  transactionId: string
  projectId: string
  sequenceId: string
  previousRevision: number
  newRevision: number
  generation: number
  attribution: {
    author: RevisionAuthor
    actorId?: string
    sourceOperation: string
  }
  createdIds: ReceiptId[]
  changedIds: ReceiptId[]
  removedIds: ReceiptId[]
  shifts: UniformShift[]
  sequenceChanges: string[]
  trackChanges: string[]
  proofInvalidated: boolean
  notes: Array<{
    code: string
    messageKey: string
    severity: 'info' | 'warning'
    values?: Record<string, string | number>
  }>
  truncated: {
    created: number
    changed: number
    removed: number
    shifts: number
    sequenceChanges: number
    trackChanges: number
    notes: number
  }
}

export type RenderPreset = {
  id: 'proof-frame' | 'preview' | 'h264-mp4' | 'audio-aac' | 'subtitles-srt' | 'subtitles-vtt'
  width?: number
  height?: number
  videoBitrate?: string
  audioBitrate?: string
}

export type RuntimeSchema<T> = {
  parse(value: unknown): T
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: Error }
}

export const RationalSchema = runtimeSchema<Rational>((value) => {
  const rational = object(value, 'rational')
  positiveInteger(rational.numerator, 'rational.numerator')
  positiveInteger(rational.denominator, 'rational.denominator')
})

export const CanvasSettingsSchema = runtimeSchema<CanvasSettings>(validateCanvas)
export const MediaAssetSchema = runtimeSchema<MediaAsset>((value) => validateAsset(value, 0))
export const MediaFolderSchema = runtimeSchema<MediaFolder>((value) => validateMediaFolder(value, 0))
export const TrackSchema = runtimeSchema<Track>((value) => validateTrack(value, 0))
export const TimelineItemSchema = runtimeSchema<TimelineItem>((value) => validateItem(value, 0))
export const CaptionSchema = runtimeSchema<Caption>((value) => validateCaption(value, 0))
export const TranscriptSegmentSchema = runtimeSchema<TranscriptSegment>((value) =>
  validateTranscriptSegment(value, 'segment')
)
export const TranscriptSchema = runtimeSchema<Transcript>((value) => validateTranscript(value, 0))
export const RevisionSchema = runtimeSchema<Revision>((value) => validateRevision(value, 0))
export const SequenceSchema = runtimeSchema<Sequence>((value) => validateSequence(value, 0))
export const LinkGroupSchema = runtimeSchema<LinkGroup>((value) => validateLinkGroup(value, 0))
export const ProjectSelectionSchema = runtimeSchema<ProjectSelection>(validateSelection)
export const DerivedReferenceSchema = runtimeSchema<DerivedReference>((value) =>
  validateDerivedReference(value, 0)
)
export const MutationReceiptSchema = runtimeSchema<MutationReceipt>(validateMutationReceipt)
export const TimelineOperationSchema = runtimeSchema<TimelineOperation>(validateOperation)
export const RenderPresetSchema = runtimeSchema<RenderPreset>(validateRenderPreset)
export const VideoProjectSchema = runtimeSchema<VideoProject>(validateProjectShape)

export type ProjectMigration = (value: Record<string, unknown>) => unknown
export const PROJECT_MIGRATIONS: Readonly<Record<number, ProjectMigration>> = Object.freeze({
  1: migrateV1Project
})

export type ProjectMigrationResult = {
  project: VideoProject
  sourceVersion: number
  migrated: boolean
}

export function migrateProject(
  value: unknown,
  migrations: Readonly<Record<number, ProjectMigration>> = PROJECT_MIGRATIONS
): VideoProject {
  let candidate = object(value, 'project')
  let version = candidate.schemaVersion
  if (!Number.isSafeInteger(version) || Number(version) < 0) {
    throw engineError('invalid_project', 'project.schemaVersion must be a non-negative integer')
  }
  while (version !== PROJECT_SCHEMA_VERSION) {
    if (Number(version) > PROJECT_SCHEMA_VERSION || migrations[Number(version)] === undefined) {
      throw engineError(
        'unsupported_schema_version',
        `Project schema ${String(version)} is not supported`,
        { schemaVersion: version, supportedSchemaVersion: PROJECT_SCHEMA_VERSION }
      )
    }
    candidate = object(migrations[Number(version)]!(candidate), 'migrated project')
    version = candidate.schemaVersion
  }
  return VideoProjectSchema.parse(candidate)
}

export function migrateProjectWithReport(
  value: unknown,
  migrations: Readonly<Record<number, ProjectMigration>> = PROJECT_MIGRATIONS
): ProjectMigrationResult {
  const source = object(value, 'project')
  const sourceVersion = Number(source.schemaVersion)
  const project = migrateProject(value, migrations)
  return {
    project,
    sourceVersion,
    migrated: sourceVersion !== PROJECT_SCHEMA_VERSION
  }
}

/**
 * The active timeline projection is retained while the public 0.3.x Host/Webview
 * moves to sequence-aware reads. This helper is the only supported place to
 * synchronize the compatibility fields.
 */
export function syncActiveSequenceProjection(
  project: VideoProject,
  direction: 'projection-to-sequence' | 'sequence-to-projection' = 'projection-to-sequence'
): VideoProject {
  const next = structuredClone(project)
  const sequence = next.sequences.find(({ id }) => id === next.activeSequenceId)
  if (!sequence) {
    throw engineError('invalid_project', 'The active sequence does not exist', {
      activeSequenceId: next.activeSequenceId
    })
  }
  if (direction === 'projection-to-sequence') {
    sequence.tracks = structuredClone(next.tracks)
    sequence.items = structuredClone(next.items)
    sequence.captions = structuredClone(next.captions)
  } else {
    next.tracks = structuredClone(sequence.tracks)
    next.items = structuredClone(sequence.items)
    next.captions = structuredClone(sequence.captions)
  }
  return next
}

export function activeSequence(project: VideoProject): Sequence {
  const sequence = project.sequences.find(({ id }) => id === project.activeSequenceId)
  if (!sequence) {
    throw engineError('invalid_project', 'The active sequence does not exist', {
      activeSequenceId: project.activeSequenceId
    })
  }
  // Until every public projection has moved to sequence-aware reads, callers
  // may have edited the 0.3.x active timeline fields in memory. Treat those
  // compatibility fields as the active sequence view; commits synchronize the
  // durable sequence document through syncActiveSequenceProjection().
  return {
    ...sequence,
    tracks: project.tracks,
    items: project.items,
    captions: project.captions
  }
}

export function validateProjectRoundTrip(project: VideoProject): VideoProject {
  const encoded = JSON.stringify(VideoProjectSchema.parse(project))
  const decoded = VideoProjectSchema.parse(JSON.parse(encoded))
  if (JSON.stringify(decoded) !== encoded) {
    throw engineError('invalid_project', 'Project is not stable across a JSON round trip')
  }
  return decoded
}

function migrateV1Project(value: Record<string, unknown>): unknown {
  validateV1ProjectShape(value)
  const project = structuredClone(value)
  const sequenceId = 'sequence-main'
  const tracks = structuredClone(array(project.tracks, 'project.tracks'))
  const items = structuredClone(array(project.items, 'project.items'))
  const captions = structuredClone(array(project.captions, 'project.captions'))
  const currentRevision = Number(project.currentRevision)
  return {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks,
    items,
    captions,
    mediaFolders: [],
    sequences: [{
      id: sequenceId,
      name: String(project.name),
      tracks: structuredClone(tracks),
      items: structuredClone(items),
      captions: structuredClone(captions),
      viewState: { zoom: 1, scrollFrame: 0, open: true }
    }],
    activeSequenceId: sequenceId,
    linkGroups: [],
    selection: {
      generation: 0,
      revision: currentRevision,
      sequenceId,
      playheadFrame: 0,
      selectedAssetIds: [],
      selectedItemIds: [],
      selectedCaptionIds: [],
      selectedWordIds: []
    },
    derivedReferences: [],
    multicamGroups: [],
    eventGeneration: currentRevision,
    agentUndoStack: [],
    recovery: {
      mode: 'healthy',
      unreadableManifestKinds: [],
      interruptedJobIds: [],
      notes: []
    }
  }
}

function runtimeSchema<T>(validate: (value: unknown) => void): RuntimeSchema<T> {
  return {
    parse(value: unknown): T {
      validate(value)
      return structuredClone(value as T)
    },
    safeParse(value: unknown) {
      try {
        return { success: true as const, data: this.parse(value) }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error : new Error(String(error))
        }
      }
    }
  }
}

function validateProjectShape(value: unknown): void {
  const project = object(value, 'project')
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw engineError('unsupported_schema_version', 'Unsupported project schema version', {
      schemaVersion: project.schemaVersion,
      supportedSchemaVersion: PROJECT_SCHEMA_VERSION
    })
  }
  identifier(project.id, 'project.id')
  boundedString(project.name, 'project.name', 1, 160)
  isoTimestamp(project.createdAt, 'project.createdAt')
  isoTimestamp(project.updatedAt, 'project.updatedAt')
  RationalSchema.parse(project.fps)
  validateCanvas(project.canvas)
  boundedArray(project.assets, 'project.assets', PROJECT_LIMITS.assets).forEach(validateAsset)
  if (project.mediaFolders !== undefined) {
    boundedArray(project.mediaFolders, 'project.mediaFolders', PROJECT_LIMITS.mediaFolders).forEach(validateMediaFolder)
  }
  boundedArray(project.tracks, 'project.tracks', PROJECT_LIMITS.tracksPerSequence).forEach(validateTrack)
  boundedArray(project.items, 'project.items', PROJECT_LIMITS.itemsPerSequence).forEach(validateItem)
  boundedArray(project.captions, 'project.captions', PROJECT_LIMITS.captionsPerSequence).forEach(validateCaption)
  boundedArray(project.sequences, 'project.sequences', PROJECT_LIMITS.sequences, 1).forEach(validateSequence)
  identifier(project.activeSequenceId, 'project.activeSequenceId')
  boundedArray(project.linkGroups, 'project.linkGroups', PROJECT_LIMITS.linkGroups).forEach(validateLinkGroup)
  validateSelection(project.selection)
  boundedArray(project.transcripts, 'project.transcripts', PROJECT_LIMITS.transcripts).forEach(validateTranscript)
  boundedArray(
    project.derivedReferences,
    'project.derivedReferences',
    PROJECT_LIMITS.derivedReferences
  ).forEach(validateDerivedReference)
  if (project.multicamGroups !== undefined) {
    boundedArray(
      project.multicamGroups,
      'project.multicamGroups',
      PROJECT_LIMITS.multicamGroups
    ).forEach(validatePersistedMulticamGroup)
  }
  nonNegativeInteger(project.currentRevision, 'project.currentRevision')
  nonNegativeInteger(project.eventGeneration, 'project.eventGeneration')
  array(project.revisions, 'project.revisions').forEach(validateRevision)
  array(project.undoStack, 'project.undoStack').forEach((entry, index) =>
    nonNegativeInteger(entry, `project.undoStack[${index}]`)
  )
  array(project.redoStack, 'project.redoStack').forEach((entry, index) =>
    nonNegativeInteger(entry, `project.redoStack[${index}]`)
  )
  boundedArray(project.agentUndoStack, 'project.agentUndoStack', MAX_PROJECT_HISTORY).forEach(
    (entry, index) => validateAgentUndoEntry(entry, index)
  )
  validateRecovery(project.recovery)
  validateActiveProjection(project)
  validateMediaLibraryReferences(project)
  validateMulticamReferences(project)
}

function validateV1ProjectShape(value: unknown): void {
  const project = object(value, 'project')
  if (project.schemaVersion !== 1) {
    throw engineError('unsupported_schema_version', 'Expected a schema-v1 project')
  }
  identifier(project.id, 'project.id')
  boundedString(project.name, 'project.name', 1, 160)
  isoTimestamp(project.createdAt, 'project.createdAt')
  isoTimestamp(project.updatedAt, 'project.updatedAt')
  RationalSchema.parse(project.fps)
  validateCanvas(project.canvas)
  boundedArray(project.assets, 'project.assets', PROJECT_LIMITS.assets).forEach(validateAsset)
  boundedArray(project.tracks, 'project.tracks', PROJECT_LIMITS.tracksPerSequence).forEach(validateTrack)
  boundedArray(project.items, 'project.items', PROJECT_LIMITS.itemsPerSequence).forEach(validateItem)
  boundedArray(project.captions, 'project.captions', PROJECT_LIMITS.captionsPerSequence).forEach(validateCaption)
  boundedArray(project.transcripts, 'project.transcripts', PROJECT_LIMITS.transcripts).forEach(validateTranscript)
  nonNegativeInteger(project.currentRevision, 'project.currentRevision')
  boundedArray(project.revisions, 'project.revisions', MAX_PROJECT_HISTORY).forEach(validateRevision)
  boundedArray(project.undoStack, 'project.undoStack', MAX_PROJECT_HISTORY).forEach((entry, index) =>
    nonNegativeInteger(entry, `project.undoStack[${index}]`)
  )
  boundedArray(project.redoStack, 'project.redoStack', MAX_PROJECT_HISTORY).forEach((entry, index) =>
    nonNegativeInteger(entry, `project.redoStack[${index}]`)
  )
}

function validateCanvas(value: unknown): void {
  const canvas = object(value, 'canvas')
  oneOf(canvas.preset, ['16:9', '9:16', '1:1'], 'canvas.preset')
  positiveInteger(canvas.width, 'canvas.width')
  positiveInteger(canvas.height, 'canvas.height')
  oneOf(canvas.fit, ['fit', 'crop', 'pad'], 'canvas.fit')
  boundedString(canvas.background, 'canvas.background', 1, 32)
}

function validateAsset(value: unknown, index: number): void {
  const asset = object(value, `assets[${index}]`)
  identifier(asset.id, `assets[${index}].id`)
  boundedString(asset.name, `assets[${index}].name`, 1, 255)
  oneOf(asset.kind, ['video', 'audio', 'image', 'animation'], `assets[${index}].kind`)
  optionalIdentifier(asset.mediaHandleId, `assets[${index}].mediaHandleId`)
  optionalRelativePath(asset.workspaceRelativePath, `assets[${index}].workspaceRelativePath`)
  if (asset.mediaHandleId === undefined && asset.workspaceRelativePath === undefined) {
    fail(`assets[${index}] must contain a media handle or workspace-relative path`)
  }
  positiveInteger(asset.durationUs, `assets[${index}].durationUs`)
  boundedString(asset.container, `assets[${index}].container`, 1, 64)
  if (asset.video !== undefined) validateVideoStream(asset.video, index)
  if (asset.audio !== undefined) validateAudioStream(asset.audio, index)
  if (asset.still !== undefined) validateStillImage(asset.still, index)
  if ((asset.kind === 'image' || asset.kind === 'animation') && asset.still === undefined) {
    fail(`assets[${index}] image and animation assets require still metadata`)
  }
  if (asset.kind === 'image' && object(asset.still, `assets[${index}].still`).animated === true) {
    fail(`assets[${index}] image assets cannot be marked animated`)
  }
  if (asset.kind === 'animation' && object(asset.still, `assets[${index}].still`).animated !== true) {
    fail(`assets[${index}] animation assets must be marked animated`)
  }
  optionalIdentifier(asset.folderId, `assets[${index}].folderId`)
  if (asset.generatedLineage !== undefined) {
    validateGeneratedLineage(asset.generatedLineage, `assets[${index}].generatedLineage`)
  }
  array(asset.transcriptIds, `assets[${index}].transcriptIds`).forEach((entry, child) =>
    identifier(entry, `assets[${index}].transcriptIds[${child}]`)
  )
  if (asset.availability !== undefined) {
    oneOf(asset.availability, ['online', 'offline', 'revoked', 'changed'], `assets[${index}].availability`)
  }
  if (asset.sourceIdentity !== undefined) validateSourceIdentity(asset.sourceIdentity, `assets[${index}].sourceIdentity`)
  if (asset.recovery !== undefined) {
    const recovery = object(asset.recovery, `assets[${index}].recovery`)
    if (recovery.reason !== undefined) {
      oneOf(
        recovery.reason,
        ['missing', 'revoked', 'changed', 'manifest-unreadable'],
        `assets[${index}].recovery.reason`
      )
    }
    if (recovery.lastVerifiedAt !== undefined) isoTimestamp(recovery.lastVerifiedAt, `assets[${index}].recovery.lastVerifiedAt`)
    optionalIdentifier(recovery.previousMediaHandleId, `assets[${index}].recovery.previousMediaHandleId`)
  }
}

function validateStillImage(value: unknown, index: number): void {
  const still = object(value, `assets[${index}].still`)
  positiveInteger(still.width, `assets[${index}].still.width`)
  positiveInteger(still.height, `assets[${index}].still.height`)
  boundedString(still.format, `assets[${index}].still.format`, 1, 64)
  if (typeof still.animated !== 'boolean') fail(`assets[${index}].still.animated must be a boolean`)
  if (still.frameRate !== undefined) RationalSchema.parse(still.frameRate)
  optionalBoolean(still.loop, `assets[${index}].still.loop`)
}

function validateGeneratedLineage(value: unknown, path: string): void {
  const lineage = object(value, path)
  identifier(lineage.providerId, `${path}.providerId`)
  identifier(lineage.modelId, `${path}.modelId`)
  identifier(lineage.jobId, `${path}.jobId`)
  if (lineage.promptDigest !== undefined) {
    boundedString(lineage.promptDigest, `${path}.promptDigest`, 64, 64)
    if (typeof lineage.promptDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(lineage.promptDigest)) {
      fail(`${path}.promptDigest must be a lowercase SHA-256 digest`)
    }
  }
  if (lineage.prompt !== undefined) boundedString(lineage.prompt, `${path}.prompt`, 0, 8_192)
  boundedArray(lineage.referenceAssetIds, `${path}.referenceAssetIds`, 32).forEach((entry, index) =>
    identifier(entry, `${path}.referenceAssetIds[${index}]`)
  )
  optionalIdentifier(lineage.variantOfAssetId, `${path}.variantOfAssetId`)
}

function validateMediaFolder(value: unknown, index: number): void {
  const folder = object(value, `mediaFolders[${index}]`)
  identifier(folder.id, `mediaFolders[${index}].id`)
  boundedString(folder.name, `mediaFolders[${index}].name`, 1, 160)
  optionalIdentifier(folder.parentId, `mediaFolders[${index}].parentId`)
}

function validateSourceIdentity(value: unknown, path: string): void {
  const identity = object(value, path)
  oneOf(identity.algorithm, ['sha256'], `${path}.algorithm`)
  if (typeof identity.value !== 'string' || !/^[a-f0-9]{64}$/u.test(identity.value)) {
    fail(`${path}.value must be a lowercase SHA-256 digest`)
  }
  if (identity.sizeBytes !== undefined) nonNegativeInteger(identity.sizeBytes, `${path}.sizeBytes`)
  if (identity.modifiedAt !== undefined) isoTimestamp(identity.modifiedAt, `${path}.modifiedAt`)
}

function validateVideoStream(value: unknown, index: number): void {
  const stream = object(value, `assets[${index}].video`)
  boundedString(stream.codec, `assets[${index}].video.codec`, 1, 64)
  positiveInteger(stream.width, `assets[${index}].video.width`)
  positiveInteger(stream.height, `assets[${index}].video.height`)
  RationalSchema.parse(stream.frameRate)
  if (stream.rotation !== undefined) oneOf(stream.rotation, [0, 90, 180, 270], 'video.rotation')
}

function validateAudioStream(value: unknown, index: number): void {
  const stream = object(value, `assets[${index}].audio`)
  boundedString(stream.codec, `assets[${index}].audio.codec`, 1, 64)
  positiveInteger(stream.sampleRate, `assets[${index}].audio.sampleRate`)
  positiveInteger(stream.channels, `assets[${index}].audio.channels`)
}

function validateTrack(value: unknown, index: number): void {
  const track = object(value, `tracks[${index}]`)
  identifier(track.id, `tracks[${index}].id`)
  boundedString(track.name, `tracks[${index}].name`, 1, 128)
  oneOf(track.kind, ['video', 'audio', 'caption'], `tracks[${index}].kind`)
  nonNegativeInteger(track.order, `tracks[${index}].order`)
  oneOf(track.overlap, ['reject', 'mix'], `tracks[${index}].overlap`)
  optionalBoolean(track.muted, `tracks[${index}].muted`)
  optionalBoolean(track.locked, `tracks[${index}].locked`)
  optionalBoolean(track.syncLocked, `tracks[${index}].syncLocked`)
}

function validateItem(value: unknown, index: number): void {
  const item = object(value, `items[${index}]`)
  identifier(item.id, `items[${index}].id`)
  identifier(item.assetId, `items[${index}].assetId`)
  identifier(item.trackId, `items[${index}].trackId`)
  nonNegativeInteger(item.timelineStartFrame, `items[${index}].timelineStartFrame`)
  positiveInteger(item.durationFrames, `items[${index}].durationFrames`)
  nonNegativeInteger(item.sourceStartUs, `items[${index}].sourceStartUs`)
  positiveInteger(item.sourceEndUs, `items[${index}].sourceEndUs`)
  if (Number(item.sourceEndUs) <= Number(item.sourceStartUs)) fail(`items[${index}] source range is empty`)
  RationalSchema.parse(item.speed)
  validateTransform(item.transform, `items[${index}].transform`)
  finiteRange(item.opacity, `items[${index}].opacity`, 0, 1)
  nonNegativeInteger(item.fadeInFrames, `items[${index}].fadeInFrames`)
  nonNegativeInteger(item.fadeOutFrames, `items[${index}].fadeOutFrames`)
  optionalIdentifier(item.linkGroupId, `items[${index}].linkGroupId`)
  optionalIdentifier(item.nestedSequenceId, `items[${index}].nestedSequenceId`)
  if (item.crop !== undefined) {
    validateCrop(item.crop, `items[${index}].crop`)
  }
  if (item.blendMode !== undefined) {
    oneOf(item.blendMode, ['normal', 'multiply', 'screen', 'overlay'], `items[${index}].blendMode`)
  }
  if (item.volume !== undefined) finiteRange(item.volume, `items[${index}].volume`, 0, 4)
  optionalBoolean(item.muted, `items[${index}].muted`)
  optionalBoolean(item.visible, `items[${index}].visible`)
  optionalBoolean(item.locked, `items[${index}].locked`)
  if (item.effects !== undefined) {
    const effects = boundedArray(item.effects, `items[${index}].effects`, PROJECT_LIMITS.effectsPerItem)
    effects.forEach((effect, child) => validateEffect(effect, `items[${index}].effects[${child}]`))
    uniqueObjectIds(effects, `items[${index}].effects`)
  }
  if (item.keyframes !== undefined) {
    const keyframes = boundedArray(
      item.keyframes,
      `items[${index}].keyframes`,
      PROJECT_LIMITS.keyframeTracksPerItem
    )
    keyframes.forEach((track, child) => validateKeyframeTrack(track, `items[${index}].keyframes[${child}]`))
    uniqueObjectIds(keyframes, `items[${index}].keyframes`)
  }
}

function validateEffect(value: unknown, path: string): void {
  const effect = object(value, path)
  identifier(effect.id, `${path}.id`)
  boundedString(effect.type, `${path}.type`, 1, 128)
  if (typeof effect.enabled !== 'boolean') fail(`${path}.enabled must be a boolean`)
  const parameters = object(effect.parameters, `${path}.parameters`)
  const entries = Object.entries(parameters)
  if (entries.length > PROJECT_LIMITS.effectParameters) fail(`${path}.parameters exceeds its limit`)
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(key)) fail(`${path}.parameters contains an invalid key`)
    if (typeof entry === 'number') finite(entry, `${path}.parameters.${key}`)
    else if (typeof entry === 'string') boundedString(entry, `${path}.parameters.${key}`, 0, 1024)
    else if (typeof entry !== 'boolean') fail(`${path}.parameters.${key} has an unsupported value`)
  }
}

function validateKeyframeTrack(value: unknown, path: string): void {
  const track = object(value, path)
  identifier(track.id, `${path}.id`)
  boundedString(track.property, `${path}.property`, 1, 128)
  oneOf(track.interpolation, ['hold', 'linear', 'ease'], `${path}.interpolation`)
  const points = boundedArray(track.points, `${path}.points`, PROJECT_LIMITS.keyframePointsPerTrack, 1)
  uniqueObjectIds(points, `${path}.points`)
  let previousFrame = -1
  points.forEach((value, index) => {
    const point = object(value, `${path}.points[${index}]`)
    identifier(point.id, `${path}.points[${index}].id`)
    nonNegativeInteger(point.frame, `${path}.points[${index}].frame`)
    finite(point.value, `${path}.points[${index}].value`)
    if (Number(point.frame) <= previousFrame) fail(`${path}.points must have unique ascending frames`)
    previousFrame = Number(point.frame)
  })
}

function validateTransform(value: unknown, path: string): void {
  const transform = object(value, path)
  finite(transform.x, `${path}.x`)
  finite(transform.y, `${path}.y`)
  finiteRange(transform.scaleX, `${path}.scaleX`, 0.01, 100)
  finiteRange(transform.scaleY, `${path}.scaleY`, 0.01, 100)
  finite(transform.rotation, `${path}.rotation`)
}

function validateCrop(value: unknown, path: string): void {
  const crop = object(value, path)
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    finiteRange(crop[side], `${path}.${side}`, 0, 1)
  }
  if (Number(crop.left) + Number(crop.right) >= 1 || Number(crop.top) + Number(crop.bottom) >= 1) {
    fail(`${path} removes the complete frame`)
  }
}

function validateCaption(value: unknown, index: number): void {
  const caption = object(value, `captions[${index}]`)
  identifier(caption.id, `captions[${index}].id`)
  identifier(caption.trackId, `captions[${index}].trackId`)
  nonNegativeInteger(caption.startFrame, `captions[${index}].startFrame`)
  positiveInteger(caption.endFrame, `captions[${index}].endFrame`)
  if (Number(caption.endFrame) <= Number(caption.startFrame)) fail(`captions[${index}] range is empty`)
  boundedString(caption.text, `captions[${index}].text`, 1, 4096)
  oneOf(caption.placement, ['top', 'center', 'bottom'], `captions[${index}].placement`)
  if (caption.style !== undefined) {
    const style = object(caption.style, `captions[${index}].style`)
    if (style.fontSize !== undefined) {
      finiteRange(style.fontSize, `captions[${index}].style.fontSize`, 8, 256)
    }
    for (const key of ['color', 'background'] as const) {
      if (style[key] === undefined) continue
      boundedString(style[key], `captions[${index}].style.${key}`, 7, 7)
      if (!/^#[0-9A-Fa-f]{6}$/u.test(String(style[key]))) {
        fail(`captions[${index}].style.${key} must be a six-digit hexadecimal color`)
      }
    }
    if (style.fontFamily !== undefined) boundedString(style.fontFamily, `captions[${index}].style.fontFamily`, 1, 128)
    if (style.fontWeight !== undefined) finiteRange(style.fontWeight, `captions[${index}].style.fontWeight`, 100, 900)
    if (style.maxWidthRatio !== undefined) finiteRange(style.maxWidthRatio, `captions[${index}].style.maxWidthRatio`, 0.1, 1)
  }
  optionalIdentifier(caption.sourceTranscriptId, `captions[${index}].sourceTranscriptId`)
  if (caption.sourceSegmentIds !== undefined) {
    boundedArray(caption.sourceSegmentIds, `captions[${index}].sourceSegmentIds`, 256).forEach(
      (entry, child) => identifier(entry, `captions[${index}].sourceSegmentIds[${child}]`)
    )
  }
  if (caption.speakerAttribution !== undefined) {
    validateSpeakerAttribution(caption.speakerAttribution, `captions[${index}].speakerAttribution`)
  }
  if (caption.words !== undefined) {
    const words = boundedArray(caption.words, `captions[${index}].words`, 512)
    uniqueObjectIds(words, `captions[${index}].words`)
    words.forEach((value, child) => {
      const word = object(value, `captions[${index}].words[${child}]`)
      identifier(word.id, `captions[${index}].words[${child}].id`)
      boundedString(word.text, `captions[${index}].words[${child}].text`, 1, 1024)
      nonNegativeInteger(word.startFrame, `captions[${index}].words[${child}].startFrame`)
      positiveInteger(word.endFrame, `captions[${index}].words[${child}].endFrame`)
      if (Number(word.endFrame) <= Number(word.startFrame)) fail(`captions[${index}].words[${child}] range is empty`)
      optionalIdentifier(word.sourceWordId, `captions[${index}].words[${child}].sourceWordId`)
    })
  }
  if (caption.animation !== undefined) {
    const animation = object(caption.animation, `captions[${index}].animation`)
    oneOf(animation.kind, ['none', 'word-highlight', 'fade'], `captions[${index}].animation.kind`)
    if (animation.durationFrames !== undefined) {
      nonNegativeInteger(animation.durationFrames, `captions[${index}].animation.durationFrames`)
    }
  }
}

function validateTranscript(value: unknown, index: number): void {
  const transcript = object(value, `transcripts[${index}]`)
  identifier(transcript.id, `transcripts[${index}].id`)
  identifier(transcript.assetId, `transcripts[${index}].assetId`)
  boundedString(transcript.language, `transcripts[${index}].language`, 1, 32)
  oneOf(transcript.provenance, ['srt', 'vtt', 'json', 'local-asr'], `transcripts[${index}].provenance`)
  boundedArray(
    transcript.segments,
    `transcripts[${index}].segments`,
    PROJECT_LIMITS.transcriptSegments
  ).forEach((segment, child) =>
    validateTranscriptSegment(segment, `transcripts[${index}].segments[${child}]`)
  )
  if (transcript.adapter !== undefined) {
    const adapter = object(transcript.adapter, `transcripts[${index}].adapter`)
    identifier(adapter.id, `transcripts[${index}].adapter.id`)
    boundedString(adapter.version, `transcripts[${index}].adapter.version`, 1, 64)
    if (adapter.modelId !== undefined) boundedString(adapter.modelId, `transcripts[${index}].adapter.modelId`, 1, 128)
    oneOf(adapter.execution, ['local', 'import'], `transcripts[${index}].adapter.execution`)
    if (adapter.sourceFormat !== undefined) {
      oneOf(adapter.sourceFormat, ['srt', 'vtt', 'json'], `transcripts[${index}].adapter.sourceFormat`)
    }
  }
  if (transcript.sourceFingerprint !== undefined) {
    validateSourceIdentity(transcript.sourceFingerprint, `transcripts[${index}].sourceFingerprint`)
  }
}

function validateTranscriptSegment(value: unknown, path: string): void {
  const segment = object(value, path)
  identifier(segment.id, `${path}.id`)
  nonNegativeInteger(segment.startUs, `${path}.startUs`)
  positiveInteger(segment.endUs, `${path}.endUs`)
  if (Number(segment.endUs) <= Number(segment.startUs)) fail(`${path} range is empty`)
  boundedString(segment.text, `${path}.text`, 1, 16_384)
  if (segment.words !== undefined) {
    const words = boundedArray(segment.words, `${path}.words`, PROJECT_LIMITS.transcriptWordsPerSegment)
    uniqueObjectIds(words, `${path}.words`)
    words.forEach((word, index) => {
      const parsed = object(word, `${path}.words[${index}]`)
      identifier(parsed.id, `${path}.words[${index}].id`)
      nonNegativeInteger(parsed.startUs, `${path}.words[${index}].startUs`)
      positiveInteger(parsed.endUs, `${path}.words[${index}].endUs`)
      boundedString(parsed.text, `${path}.words[${index}].text`, 1, 1024)
      if (parsed.confidence !== undefined) finiteRange(parsed.confidence, 'word.confidence', 0, 1)
      if (parsed.provenance !== undefined) validateEvidenceProvenance(parsed.provenance, `${path}.words[${index}].provenance`)
    })
  }
  if (segment.tags !== undefined) {
    array(segment.tags, `${path}.tags`).forEach((tag) => oneOf(tag, ['filler', 'silence'], `${path}.tags`))
  }
  if (segment.confidence !== undefined) finiteRange(segment.confidence, `${path}.confidence`, 0, 1)
  if (segment.speakerAttribution !== undefined) {
    validateSpeakerAttribution(segment.speakerAttribution, `${path}.speakerAttribution`)
  }
  if (segment.provenance !== undefined) validateEvidenceProvenance(segment.provenance, `${path}.provenance`)
}

function validateSpeakerAttribution(value: unknown, path: string): void {
  const attribution = object(value, path)
  analysisIdentifier(attribution.analysisId, `${path}.analysisId`)
  optionalIdentifier(attribution.speakerId, `${path}.speakerId`)
  if (attribution.speakerLabel !== undefined) {
    boundedString(attribution.speakerLabel, `${path}.speakerLabel`, 1, 128)
  }
  finiteRange(attribution.confidence, `${path}.confidence`, 0, 1)
  oneOf(attribution.status, ['identified', 'unknown', 'overlap', 'uncertain'], `${path}.status`)
  const sourceTurnIds = boundedArray(attribution.sourceTurnIds, `${path}.sourceTurnIds`, 32, 1)
  sourceTurnIds.forEach((entry, index) => identifier(entry, `${path}.sourceTurnIds[${index}]`))
  if (attribution.status === 'identified') {
    if (attribution.speakerId === undefined || attribution.speakerLabel === undefined) {
      fail(`${path} identified attribution requires a speaker identity and label`)
    }
  } else if (attribution.speakerId !== undefined || attribution.speakerLabel !== undefined) {
    fail(`${path} uncertain attribution must not assert a speaker identity`)
  }
}

function analysisIdentifier(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,511}$/u.test(value)) {
    fail(`${path} must be a bounded local analysis identifier`)
  }
}

function validateEvidenceProvenance(value: unknown, path: string): void {
  const provenance = object(value, path)
  identifier(provenance.adapterId, `${path}.adapterId`)
  optionalIdentifier(provenance.sourceId, `${path}.sourceId`)
}

function validateSequence(value: unknown, index: number): void {
  const sequence = object(value, `sequences[${index}]`)
  identifier(sequence.id, `sequences[${index}].id`)
  boundedString(sequence.name, `sequences[${index}].name`, 1, 160)
  boundedArray(sequence.tracks, `sequences[${index}].tracks`, PROJECT_LIMITS.tracksPerSequence).forEach(validateTrack)
  boundedArray(sequence.items, `sequences[${index}].items`, PROJECT_LIMITS.itemsPerSequence).forEach(validateItem)
  boundedArray(sequence.captions, `sequences[${index}].captions`, PROJECT_LIMITS.captionsPerSequence).forEach(validateCaption)
  const viewState = object(sequence.viewState, `sequences[${index}].viewState`)
  finiteRange(viewState.zoom, `sequences[${index}].viewState.zoom`, 0.01, 1_000)
  nonNegativeInteger(viewState.scrollFrame, `sequences[${index}].viewState.scrollFrame`)
  if (typeof viewState.open !== 'boolean') fail(`sequences[${index}].viewState.open must be a boolean`)
}

function validateLinkGroup(value: unknown, index: number): void {
  const group = object(value, `linkGroups[${index}]`)
  identifier(group.id, `linkGroups[${index}].id`)
  oneOf(group.kind, ['av', 'sync', 'custom'], `linkGroups[${index}].kind`)
  boundedArray(group.itemIds, `linkGroups[${index}].itemIds`, PROJECT_LIMITS.linkGroupMembers, 2).forEach(
    (entry, child) => identifier(entry, `linkGroups[${index}].itemIds[${child}]`)
  )
  if (typeof group.locked !== 'boolean') fail(`linkGroups[${index}].locked must be a boolean`)
}

function validateSelection(value: unknown): void {
  const selection = object(value, 'project.selection')
  nonNegativeInteger(selection.generation, 'project.selection.generation')
  nonNegativeInteger(selection.revision, 'project.selection.revision')
  identifier(selection.sequenceId, 'project.selection.sequenceId')
  nonNegativeInteger(selection.playheadFrame, 'project.selection.playheadFrame')
  for (const key of ['selectedAssetIds', 'selectedItemIds', 'selectedCaptionIds', 'selectedWordIds'] as const) {
    boundedArray(selection[key], `project.selection.${key}`, PROJECT_LIMITS.selectedIds).forEach((entry, index) =>
      identifier(entry, `project.selection.${key}[${index}]`)
    )
  }
  if (selection.range !== undefined) {
    const range = object(selection.range, 'project.selection.range')
    nonNegativeInteger(range.startFrame, 'project.selection.range.startFrame')
    positiveInteger(range.endFrame, 'project.selection.range.endFrame')
    if (Number(range.endFrame) <= Number(range.startFrame)) fail('project.selection.range is empty')
  }
}

function validateDerivedReference(value: unknown, index: number): void {
  const reference = object(value, `derivedReferences[${index}]`)
  identifier(reference.id, `derivedReferences[${index}].id`)
  oneOf(
    reference.kind,
    ['waveform', 'thumbnail', 'filmstrip', 'transcript', 'analysis', 'embedding', 'proxy', 'proof', 'preview'],
    `derivedReferences[${index}].kind`
  )
  optionalIdentifier(reference.sourceAssetId, `derivedReferences[${index}].sourceAssetId`)
  boundedArray(reference.dependencyIds, `derivedReferences[${index}].dependencyIds`, 128).forEach((entry, child) =>
    identifier(entry, `derivedReferences[${index}].dependencyIds[${child}]`)
  )
  boundedString(reference.producerVersion, `derivedReferences[${index}].producerVersion`, 1, 128)
  oneOf(
    reference.status,
    ['pending', 'processing', 'ready', 'failed', 'interrupted', 'invalid'],
    `derivedReferences[${index}].status`
  )
  nonNegativeInteger(reference.bytes, `derivedReferences[${index}].bytes`)
  if (typeof reference.pinned !== 'boolean') fail(`derivedReferences[${index}].pinned must be a boolean`)
  if (reference.sourceFingerprint !== undefined) {
    validateSourceIdentity(reference.sourceFingerprint, `derivedReferences[${index}].sourceFingerprint`)
  }
  isoTimestamp(reference.updatedAt, `derivedReferences[${index}].updatedAt`)
  if (reference.errorCode !== undefined) boundedString(reference.errorCode, `derivedReferences[${index}].errorCode`, 1, 128)
}

function validateAgentUndoEntry(value: unknown, index: number): void {
  const entry = object(value, `project.agentUndoStack[${index}]`)
  nonNegativeInteger(entry.revision, `project.agentUndoStack[${index}].revision`)
  identifier(entry.actorId, `project.agentUndoStack[${index}].actorId`)
  identifier(entry.transactionId, `project.agentUndoStack[${index}].transactionId`)
}

function validateRecovery(value: unknown): void {
  const recovery = object(value, 'project.recovery')
  oneOf(recovery.mode, ['healthy', 'write-blocked'], 'project.recovery.mode')
  if (recovery.recoveredFromRevision !== undefined) {
    nonNegativeInteger(recovery.recoveredFromRevision, 'project.recovery.recoveredFromRevision')
  }
  boundedArray(
    recovery.unreadableManifestKinds,
    'project.recovery.unreadableManifestKinds',
    3
  ).forEach((entry) => oneOf(entry, ['project', 'media', 'derived'], 'project.recovery.unreadableManifestKinds'))
  boundedArray(
    recovery.interruptedJobIds,
    'project.recovery.interruptedJobIds',
    PROJECT_LIMITS.recoveryEntries
  ).forEach((entry, index) => identifier(entry, `project.recovery.interruptedJobIds[${index}]`))
  boundedArray(recovery.notes, 'project.recovery.notes', PROJECT_LIMITS.recoveryEntries).forEach((entry, index) =>
    boundedString(entry, `project.recovery.notes[${index}]`, 1, 512)
  )
}

function validateActiveProjection(project: Record<string, unknown>): void {
  const sequences = project.sequences as Sequence[]
  const active = sequences.find(({ id }) => id === project.activeSequenceId)
  if (!active) fail('project.activeSequenceId does not identify a sequence')
  if (
    JSON.stringify(active.tracks) !== JSON.stringify(project.tracks) ||
    JSON.stringify(active.items) !== JSON.stringify(project.items) ||
    JSON.stringify(active.captions) !== JSON.stringify(project.captions)
  ) {
    fail('project active-sequence compatibility projection is stale')
  }
  const sequenceIds = new Set(sequences.map(({ id }) => id))
  if (sequenceIds.size !== sequences.length) fail('project.sequences contains duplicate IDs')
  if ((project.selection as ProjectSelection).sequenceId !== project.activeSequenceId) {
    fail('project.selection must target the active sequence')
  }
  if (!active.viewState.open) fail('project.activeSequenceId must identify an open sequence')
}

function validateMediaLibraryReferences(project: Record<string, unknown>): void {
  const folders = (project.mediaFolders ?? []) as MediaFolder[]
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  if (byId.size !== folders.length) fail('project.mediaFolders contains duplicate IDs')
  for (const folder of folders) {
    if (folder.parentId !== undefined && !byId.has(folder.parentId)) {
      fail(`Media folder ${folder.id} refers to missing parent ${folder.parentId}`)
    }
    const seen = new Set<string>()
    let cursor: MediaFolder | undefined = folder
    while (cursor) {
      if (seen.has(cursor.id)) fail(`Media folder graph contains a cycle at ${cursor.id}`)
      seen.add(cursor.id)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
  }
  const assets = project.assets as MediaAsset[]
  const assetIds = new Set(assets.map(({ id }) => id))
  for (const asset of assets) {
    if (asset.folderId !== undefined && !byId.has(asset.folderId)) {
      fail(`Media asset ${asset.id} refers to missing folder ${asset.folderId}`)
    }
    for (const referenceId of asset.generatedLineage?.referenceAssetIds ?? []) {
      if (!assetIds.has(referenceId)) fail(`Generated asset ${asset.id} refers to missing asset ${referenceId}`)
    }
    const variantId = asset.generatedLineage?.variantOfAssetId
    if (variantId !== undefined && !assetIds.has(variantId)) {
      fail(`Generated asset ${asset.id} refers to missing variant source ${variantId}`)
    }
  }
}

function validatePersistedMulticamGroup(value: unknown, index: number): void {
  const path = `multicamGroups[${index}]`
  const group = object(value, path)
  exactObjectKeys(group, [
    'schemaVersion', 'id', 'sequenceId', 'name', 'fps', 'durationFrames',
    'referenceMemberId', 'members', 'layouts', 'programFragments'
  ], path)
  identifier(group.id, `${path}.id`)
  identifier(group.sequenceId, `${path}.sequenceId`)
  exactObjectKeys(object(group.fps, `${path}.fps`), ['numerator', 'denominator'], `${path}.fps`)
  const members = boundedArray(group.members, `${path}.members`, 32, 2)
  members.forEach((value, memberIndex) => {
    const memberPath = `${path}.members[${memberIndex}]`
    const member = object(value, memberPath)
    exactObjectKeys(
      member,
      ['id', 'assetId', 'memberLabel', 'angleLabel', 'sourceFps', 'sync', 'coverage'],
      memberPath
    )
    identifier(member.id, `${memberPath}.id`)
    identifier(member.assetId, `${memberPath}.assetId`)
    exactObjectKeys(
      object(member.sourceFps, `${memberPath}.sourceFps`),
      ['numerator', 'denominator'],
      `${memberPath}.sourceFps`
    )
    const sync = object(member.sync, `${memberPath}.sync`)
    exactObjectKeys(sync, ['status', 'offsetFrames', 'confidence', 'evidence'], `${memberPath}.sync`)
    boundedArray(sync.evidence, `${memberPath}.sync.evidence`, 16).forEach((entry, evidenceIndex) => {
      const evidencePath = `${memberPath}.sync.evidence[${evidenceIndex}]`
      const evidence = object(entry, evidencePath)
      exactObjectKeys(evidence, [
        'id', 'analysisId', 'kind', 'referenceMemberId', 'targetMemberId',
        'confidence', 'algorithmId', 'algorithmVersion'
      ], evidencePath)
      for (const key of ['id', 'analysisId', 'referenceMemberId', 'targetMemberId', 'algorithmId'] as const) {
        identifier(evidence[key], `${evidencePath}.${key}`)
      }
    })
    boundedArray(member.coverage, `${memberPath}.coverage`, 256).forEach((entry, coverageIndex) => {
      const coveragePath = `${memberPath}.coverage[${coverageIndex}]`
      const coverage = object(entry, coveragePath)
      exactObjectKeys(
        coverage,
        ['id', 'startFrame', 'endFrame', 'sourceStartFrame', 'sourceEndFrame'],
        coveragePath
      )
      identifier(coverage.id, `${coveragePath}.id`)
    })
  })
  boundedArray(group.layouts, `${path}.layouts`, 32).forEach((entry, layoutIndex) => {
    const layoutPath = `${path}.layouts[${layoutIndex}]`
    const layout = object(entry, layoutPath)
    exactObjectKeys(layout, ['id', 'label', 'slots'], layoutPath)
    identifier(layout.id, `${layoutPath}.id`)
    boundedArray(layout.slots, `${layoutPath}.slots`, 16, 2).forEach((entry, slotIndex) => {
      const slotPath = `${layoutPath}.slots[${slotIndex}]`
      const slot = object(entry, slotPath)
      exactObjectKeys(
        slot,
        ['memberId', 'x', 'y', 'width', 'height', 'zIndex', 'opacity', 'audioEnabled'],
        slotPath
      )
      identifier(slot.memberId, `${slotPath}.memberId`)
    })
  })
  boundedArray(group.programFragments, `${path}.programFragments`, 4_096).forEach((entry, fragmentIndex) => {
    const fragmentPath = `${path}.programFragments[${fragmentIndex}]`
    const fragment = object(entry, fragmentPath)
    exactObjectKeys(fragment, ['id', 'startFrame', 'endFrame', 'selection'], fragmentPath)
    identifier(fragment.id, `${fragmentPath}.id`)
    const selection = object(fragment.selection, `${fragmentPath}.selection`)
    if (selection.kind === 'angle') {
      exactObjectKeys(selection, ['kind', 'memberId'], `${fragmentPath}.selection`)
      identifier(selection.memberId, `${fragmentPath}.selection.memberId`)
    } else {
      exactObjectKeys(selection, ['kind', 'layoutId'], `${fragmentPath}.selection`)
      identifier(selection.layoutId, `${fragmentPath}.selection.layoutId`)
    }
  })
  validateMulticamGroup(value as MulticamGroup)
}

function validateMulticamReferences(project: Record<string, unknown>): void {
  const groups = (project.multicamGroups ?? []) as MulticamGroup[]
  const groupIds = new Set(groups.map(({ id }) => id))
  if (groupIds.size !== groups.length) fail('project.multicamGroups contains duplicate IDs')
  const sequences = new Set((project.sequences as Sequence[]).map(({ id }) => id))
  const assets = new Map((project.assets as MediaAsset[]).map((asset) => [asset.id, asset]))
  for (const group of groups) {
    if (!sequences.has(group.sequenceId)) {
      fail(`Multicam group ${group.id} refers to missing sequence ${group.sequenceId}`)
    }
    if (!sameRationalValue(group.fps, project.fps as Rational)) {
      fail(`Multicam group ${group.id} must use the project frame rate`)
    }
    for (const member of group.members) {
      const asset = assets.get(member.assetId)
      if (!asset?.video) fail(`Multicam member ${member.id} requires an existing video asset`)
      if (!sameRationalValue(member.sourceFps, asset.video.frameRate)) {
        fail(`Multicam member ${member.id} frame rate differs from asset ${asset.id}`)
      }
      const sourceFrameCount = durationFrameCount(asset.durationUs, asset.video.frameRate)
      if (member.coverage.some(({ sourceEndFrame }) => sourceEndFrame > sourceFrameCount)) {
        fail(`Multicam member ${member.id} coverage exceeds asset ${asset.id}`)
      }
    }
  }
}

function durationFrameCount(durationUs: number, fps: Rational): number {
  return Number(
    BigInt(durationUs) * BigInt(fps.numerator) /
    (1_000_000n * BigInt(fps.denominator))
  )
}

function sameRationalValue(left: Rational, right: Rational): boolean {
  return BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
}

function validateRevision(value: unknown, index: number): void {
  const revision = object(value, `revisions[${index}]`)
  nonNegativeInteger(revision.revision, `revisions[${index}].revision`)
  if (revision.parentRevision !== null) nonNegativeInteger(revision.parentRevision, 'revision.parentRevision')
  oneOf(revision.author, ['manual', 'agent', 'system'], 'revision.author')
  optionalIdentifier(revision.actorId, 'revision.actorId')
  optionalIdentifier(revision.transactionId, 'revision.transactionId')
  boundedString(revision.sourceOperation, 'revision.sourceOperation', 1, 128)
  isoTimestamp(revision.timestamp, 'revision.timestamp')
  boundedString(revision.summary, 'revision.summary', 1, 1024)
  array(revision.operations, 'revision.operations').forEach(validateOperation)
  array(revision.inverseOperations, 'revision.inverseOperations').forEach(validateOperation)
  if (revision.restoredFromRevision !== undefined) {
    nonNegativeInteger(revision.restoredFromRevision, 'revision.restoredFromRevision')
  }
}

function validateMutationReceipt(value: unknown): void {
  const receipt = object(value, 'receipt')
  if (receipt.schemaVersion !== 1) fail('receipt.schemaVersion is unsupported')
  identifier(receipt.transactionId, 'receipt.transactionId')
  identifier(receipt.projectId, 'receipt.projectId')
  identifier(receipt.sequenceId, 'receipt.sequenceId')
  nonNegativeInteger(receipt.previousRevision, 'receipt.previousRevision')
  positiveInteger(receipt.newRevision, 'receipt.newRevision')
  if (Number(receipt.newRevision) !== Number(receipt.previousRevision) + 1) {
    fail('receipt revision transition must advance exactly once')
  }
  positiveInteger(receipt.generation, 'receipt.generation')
  const attribution = object(receipt.attribution, 'receipt.attribution')
  oneOf(attribution.author, ['manual', 'agent', 'system'], 'receipt.attribution.author')
  optionalIdentifier(attribution.actorId, 'receipt.attribution.actorId')
  boundedString(attribution.sourceOperation, 'receipt.attribution.sourceOperation', 1, 128)
  for (const key of ['createdIds', 'changedIds', 'removedIds'] as const) {
    boundedArray(receipt[key], `receipt.${key}`, PROJECT_LIMITS.receiptIds).forEach((value, index) => {
      const id = object(value, `receipt.${key}[${index}]`)
      oneOf(
        id.kind,
        [
          'asset', 'media-folder', 'sequence', 'track', 'item', 'caption', 'link-group',
          'transcript', 'derived', 'multicam-group', 'multicam-fragment'
        ],
        `receipt.${key}[${index}].kind`
      )
      identifier(id.id, `receipt.${key}[${index}].id`)
    })
  }
  boundedArray(receipt.shifts, 'receipt.shifts', PROJECT_LIMITS.receiptShifts).forEach((value, index) => {
    const shift = object(value, `receipt.shifts[${index}]`)
    identifier(shift.sequenceId, `receipt.shifts[${index}].sequenceId`)
    optionalIdentifier(shift.trackId, `receipt.shifts[${index}].trackId`)
    nonNegativeInteger(shift.fromFrame, `receipt.shifts[${index}].fromFrame`)
    if (!Number.isSafeInteger(shift.deltaFrames) || Number(shift.deltaFrames) === 0) {
      fail(`receipt.shifts[${index}].deltaFrames must be a non-zero safe integer`)
    }
    positiveInteger(shift.count, `receipt.shifts[${index}].count`)
  })
  for (const key of ['sequenceChanges', 'trackChanges'] as const) {
    boundedArray(receipt[key], `receipt.${key}`, PROJECT_LIMITS.receiptChanges).forEach((entry, index) =>
      boundedString(entry, `receipt.${key}[${index}]`, 1, 256)
    )
  }
  if (typeof receipt.proofInvalidated !== 'boolean') fail('receipt.proofInvalidated must be a boolean')
  boundedArray(receipt.notes, 'receipt.notes', PROJECT_LIMITS.receiptNotes).forEach((value, index) => {
    const note = object(value, `receipt.notes[${index}]`)
    boundedString(note.code, `receipt.notes[${index}].code`, 1, 128)
    boundedString(note.messageKey, `receipt.notes[${index}].messageKey`, 1, 128)
    oneOf(note.severity, ['info', 'warning'], `receipt.notes[${index}].severity`)
    if (note.values !== undefined) {
      const values = object(note.values, `receipt.notes[${index}].values`)
      if (Object.keys(values).length > 32) fail(`receipt.notes[${index}].values exceeds its limit`)
      Object.values(values).forEach((entry) => {
        if (typeof entry !== 'string' && typeof entry !== 'number') fail('receipt note values must be scalar')
      })
    }
  })
  const truncated = object(receipt.truncated, 'receipt.truncated')
  for (const key of ['created', 'changed', 'removed', 'shifts', 'sequenceChanges', 'trackChanges', 'notes']) {
    nonNegativeInteger(truncated[key], `receipt.truncated.${key}`)
  }
}

function validateRenderPreset(value: unknown): void {
  const preset = object(value, 'renderPreset')
  oneOf(
    preset.id,
    ['proof-frame', 'preview', 'h264-mp4', 'audio-aac', 'subtitles-srt', 'subtitles-vtt'],
    'renderPreset.id'
  )
  if (preset.width !== undefined) positiveInteger(preset.width, 'renderPreset.width')
  if (preset.height !== undefined) positiveInteger(preset.height, 'renderPreset.height')
  if (preset.videoBitrate !== undefined) boundedString(preset.videoBitrate, 'renderPreset.videoBitrate', 1, 32)
  if (preset.audioBitrate !== undefined) boundedString(preset.audioBitrate, 'renderPreset.audioBitrate', 1, 32)
}

function validateOperation(value: unknown): void {
  const operation = object(value, 'operation')
  boundedString(operation.type, 'operation.type', 1, 64)
  switch (operation.type) {
    case 'add-item':
      validateItem(operation.item, 0)
      break
    case 'split-item':
      identifier(operation.itemId, 'operation.itemId')
      nonNegativeInteger(operation.atFrame, 'operation.atFrame')
      break
    case 'trim-item':
      identifier(operation.itemId, 'operation.itemId')
      nonNegativeInteger(operation.startFrame, 'operation.startFrame')
      positiveInteger(operation.endFrame, 'operation.endFrame')
      break
    case 'delete-item':
      identifier(operation.itemId, 'operation.itemId')
      break
    case 'move-item':
      identifier(operation.itemId, 'operation.itemId')
      identifier(operation.trackId, 'operation.trackId')
      nonNegativeInteger(operation.timelineStartFrame, 'operation.timelineStartFrame')
      break
    case 'reorder-item':
      identifier(operation.itemId, 'operation.itemId')
      optionalIdentifier(operation.beforeItemId, 'operation.beforeItemId')
      break
    case 'update-transform':
      identifier(operation.itemId, 'operation.itemId')
      object(operation.transform, 'operation.transform')
      if (operation.opacity !== undefined) finiteRange(operation.opacity, 'operation.opacity', 0, 1)
      break
    case 'update-track-state':
      identifier(operation.trackId, 'operation.trackId')
      optionalBoolean(operation.muted, 'operation.muted')
      optionalBoolean(operation.locked, 'operation.locked')
      optionalBoolean(operation.syncLocked, 'operation.syncLocked')
      if (operation.muted === undefined && operation.locked === undefined && operation.syncLocked === undefined) {
        fail('update-track-state requires at least one state field')
      }
      break
    case 'update-item-properties':
      identifier(operation.itemId, 'operation.itemId')
      if (operation.volume !== undefined) finiteRange(operation.volume, 'operation.volume', 0, 4)
      if (operation.fadeInFrames !== undefined) nonNegativeInteger(operation.fadeInFrames, 'operation.fadeInFrames')
      if (operation.fadeOutFrames !== undefined) nonNegativeInteger(operation.fadeOutFrames, 'operation.fadeOutFrames')
      optionalBoolean(operation.muted, 'operation.muted')
      optionalBoolean(operation.visible, 'operation.visible')
      optionalBoolean(operation.locked, 'operation.locked')
      if (
        operation.volume === undefined && operation.fadeInFrames === undefined &&
        operation.fadeOutFrames === undefined && operation.muted === undefined &&
        operation.visible === undefined && operation.locked === undefined
      ) {
        fail('update-item-properties requires at least one property field')
      }
      break
    case 'set-link-group':
      validateLinkGroup(operation.group, 0)
      break
    case 'delete-link-group':
      identifier(operation.linkGroupId, 'operation.linkGroupId')
      break
    case 'create-sequence':
      identifier(operation.sequenceId, 'operation.sequenceId')
      boundedString(operation.name, 'operation.name', 1, 160)
      optionalBoolean(operation.activate, 'operation.activate')
      break
    case 'restore-sequence':
      validateSequence(operation.sequence, 0)
      boundedArray(operation.linkGroups, 'operation.linkGroups', PROJECT_LIMITS.linkGroups).forEach(validateLinkGroup)
      if (typeof operation.activate !== 'boolean') fail('operation.activate must be a boolean')
      break
    case 'duplicate-sequence':
      identifier(operation.sourceSequenceId, 'operation.sourceSequenceId')
      identifier(operation.sequenceId, 'operation.sequenceId')
      boundedString(operation.name, 'operation.name', 1, 160)
      optionalBoolean(operation.activate, 'operation.activate')
      break
    case 'rename-sequence':
      identifier(operation.sequenceId, 'operation.sequenceId')
      boundedString(operation.name, 'operation.name', 1, 160)
      break
    case 'select-sequence':
    case 'open-sequence':
    case 'delete-sequence':
      identifier(operation.sequenceId, 'operation.sequenceId')
      break
    case 'close-sequence':
      identifier(operation.sequenceId, 'operation.sequenceId')
      optionalIdentifier(operation.fallbackSequenceId, 'operation.fallbackSequenceId')
      break
    case 'set-sequence-view':
      identifier(operation.sequenceId, 'operation.sequenceId')
      finiteRange(operation.zoom, 'operation.zoom', 0.01, 1_000)
      nonNegativeInteger(operation.scrollFrame, 'operation.scrollFrame')
      break
    case 'set-item-keyframes':
      identifier(operation.itemId, 'operation.itemId')
      boundedArray(
        operation.keyframes,
        'operation.keyframes',
        PROJECT_LIMITS.keyframeTracksPerItem
      ).forEach((track, index) => validateKeyframeTrack(track, `operation.keyframes[${index}]`))
      break
    case 'set-item-effects':
      identifier(operation.itemId, 'operation.itemId')
      boundedArray(operation.effects, 'operation.effects', PROJECT_LIMITS.effectsPerItem)
        .forEach((effect, index) => validateEffect(effect, `operation.effects[${index}]`))
      break
    case 'update-item-composition':
      identifier(operation.itemId, 'operation.itemId')
      if (operation.crop !== undefined) validateCrop(operation.crop, 'operation.crop')
      if (operation.opacity !== undefined) finiteRange(operation.opacity, 'operation.opacity', 0, 1)
      if (operation.blendMode !== undefined) {
        oneOf(operation.blendMode, ['normal', 'multiply', 'screen', 'overlay'], 'operation.blendMode')
      }
      if (operation.crop === undefined && operation.opacity === undefined && operation.blendMode === undefined) {
        fail('update-item-composition requires at least one property field')
      }
      break
    case 'retime-item':
      identifier(operation.itemId, 'operation.itemId')
      RationalSchema.parse(operation.speed)
      break
    case 'add-caption':
      validateCaption(operation.caption, 0)
      break
    case 'update-caption':
      identifier(operation.captionId, 'operation.captionId')
      object(operation.patch, 'operation.patch')
      break
    case 'delete-caption':
      identifier(operation.captionId, 'operation.captionId')
      break
    case 'set-canvas':
      oneOf(operation.preset, ['16:9', '9:16', '1:1'], 'operation.preset')
      oneOf(operation.fit, ['fit', 'crop', 'pad'], 'operation.fit')
      break
    case 'set-multicam-group':
      validatePersistedMulticamGroup(operation.group, 0)
      break
    case 'delete-multicam-group':
    case 'merge-multicam-program':
      identifier(operation.groupId, 'operation.groupId')
      break
    case 'switch-multicam-angle':
      identifier(operation.groupId, 'operation.groupId')
      identifier(operation.memberId, 'operation.memberId')
      validateMulticamRangeOperation(operation)
      break
    case 'apply-multicam-layout':
      identifier(operation.groupId, 'operation.groupId')
      identifier(operation.layoutId, 'operation.layoutId')
      validateMulticamRangeOperation(operation)
      break
    default:
      throw engineError('invalid_operation', `Unsupported timeline operation: ${String(operation.type)}`)
  }
}

function validateMulticamRangeOperation(operation: Record<string, unknown>): void {
  nonNegativeInteger(operation.startFrame, 'operation.startFrame')
  positiveInteger(operation.endFrame, 'operation.endFrame')
  if (Number(operation.endFrame) <= Number(operation.startFrame)) {
    fail('multicam operation range must be non-empty')
  }
  if (operation.coveragePolicy !== undefined) {
    oneOf(operation.coveragePolicy, ['reject', 'clamp'], 'operation.coveragePolicy')
  }
  if (operation.minimumSyncConfidence !== undefined) {
    finiteRange(operation.minimumSyncConfidence, 'operation.minimumSyncConfidence', 0, 1)
  }
}

function exactObjectKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key))
  if (unknown.length > 0) fail(`${path} contains unsupported field ${unknown[0]}`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`)
  return value
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0
): unknown[] {
  const parsed = array(value, path)
  if (parsed.length < minimum || parsed.length > maximum) {
    fail(`${path} must contain between ${minimum} and ${maximum} entries`)
  }
  return parsed
}

function uniqueObjectIds(values: readonly unknown[], path: string): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    const entry = object(value, `${path}[${index}]`)
    const id = String(entry.id)
    if (seen.has(id)) fail(`${path} contains duplicate identity ${id}`)
    seen.add(id)
  })
}

function identifier(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)) {
    fail(`${path} must be a bounded stable identifier`)
  }
}

function optionalIdentifier(value: unknown, path: string): void {
  if (value !== undefined) identifier(value, path)
}

function optionalRelativePath(value: unknown, path: string): void {
  if (value === undefined) return
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).some((part) => part === '..' || part === '')
  ) {
    fail(`${path} must be a confined workspace-relative path`)
  }
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): void {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    fail(`${path} must contain between ${minimum} and ${maximum} characters`)
  }
}

function isoTimestamp(value: unknown, path: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO timestamp`)
}

function finite(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be finite`)
}

function finiteRange(value: unknown, path: string, minimum: number, maximum: number): void {
  finite(value, path)
  if (Number(value) < minimum || Number(value) > maximum) fail(`${path} is outside the supported range`)
}

function nonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${path} must be a non-negative safe integer`)
}

function positiveInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${path} must be a positive safe integer`)
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') fail(`${path} must be a boolean`)
}

function oneOf(value: unknown, options: readonly unknown[], path: string): void {
  if (!options.includes(value)) fail(`${path} contains an unsupported value`)
}

function fail(message: string): never {
  throw engineError('invalid_project', message)
}
