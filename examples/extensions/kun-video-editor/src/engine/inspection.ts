import { engineError } from './errors.js'
import {
  activeSequence,
  type Caption,
  type DerivedReference,
  type MediaAsset,
  type ProjectSelection,
  type Rational,
  type Sequence,
  type TimelineItem,
  type Transcript,
  type TranscriptSegment,
  type VideoProject
} from './schema.js'
import {
  compileRenderIr,
  renderCapabilitiesDigest,
  renderIrDigest,
  type CanonicalRenderIr,
  type RenderBackendCapabilities
} from './render-ir.js'

export const INSPECTION_LIMITS = Object.freeze({
  sequences: 32,
  tracks: 32,
  items: 200,
  captions: 100,
  gaps: 128,
  transcriptSegments: 100,
  transcriptWords: 500,
  sampleFrames: 16,
  proofArtifacts: 16,
  effectsPerItem: 16,
  keyframeTracksPerItem: 32,
  keyframesPerTrack: 64
})

export type TimelineWindowRequest = {
  sequenceId?: string
  startFrame: number
  endFrame: number
  itemLimit?: number
  captionLimit?: number
  includeCaptionText?: boolean
  includeEffects?: boolean
  includeKeyframes?: boolean
}

export type CompactTimelineItem = {
  id: string
  assetId: string
  trackId: string
  startFrame: number
  endFrame: number
  sourceStartUs: number
  sourceEndUs: number
  speed?: Rational
  linkGroupId?: string
  nestedSequenceId?: string
  transform?: TimelineItem['transform']
  crop?: NonNullable<TimelineItem['crop']>
  opacity?: number
  volume?: number
  fades?: { inFrames: number; outFrames: number }
  effects?: Array<{ id: string; type: string; enabled: boolean }>
  effectCount?: number
  keyframes?: Array<{
    id: string
    property: string
    interpolation: 'hold' | 'linear' | 'ease'
    points: Array<{ id: string; frame: number; value: number }>
    hiddenPointCount: number
  }>
  keyframeTrackCount?: number
}

export type CompactCaption = {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  text?: string
  wordCount: number
  placement: Caption['placement']
}

export type CompactProjectWindow = {
  schemaVersion: 1
  projectId: string
  revision: number
  generation: number
  sequence: { id: string; name: string; durationFrames: number }
  sequences: Array<{ id: string; name: string; durationFrames: number; open: boolean }>
  requestedRange: { startFrame: number; endFrame: number }
  effectiveRange: { startFrame: number; endFrame: number }
  tracks: Array<{
    id: string
    name: string
    kind: 'video' | 'audio' | 'caption'
    order: number
    muted?: boolean
    locked?: boolean
  }>
  items: CompactTimelineItem[]
  captions: CompactCaption[]
  captionSummary: { visible: number; returned: number; hidden: number; words: number }
  gaps: Array<{ trackId: string; startFrame: number; endFrame: number }>
  hiddenCounts: {
    sequences: number
    tracks: number
    itemsOutsideWindow: number
    itemsInWindow: number
    captionsOutsideWindow: number
    captionsInWindow: number
    gaps: number
  }
  selection: ContextSelectionProjection
}

export type RawMediaInspectionRequest = {
  assetId: string
  transcriptId?: string
  segmentOffset?: number
  segmentLimit?: number
  includeWords?: boolean
  sampleFrames?: number[]
}

export type RawMediaInspection = {
  schemaVersion: 1
  projectId: string
  revision: number
  asset: {
    id: string
    name: string
    kind: MediaAsset['kind']
    availability: NonNullable<MediaAsset['availability']>
    durationUs: number
    container: string
    video?: MediaAsset['video']
    audio?: MediaAsset['audio']
    sourceFingerprint?: MediaAsset['sourceIdentity']
  }
  transcript: null | {
    id: string
    language: string
    provenance: Transcript['provenance']
    adapter?: Transcript['adapter']
    sourceFingerprint?: Transcript['sourceFingerprint']
    offset: number
    returned: number
    total: number
    hiddenBefore: number
    hiddenAfter: number
    wordsReturned: number
    wordsHidden: number
    segments: Array<{
      id: string
      startUs: number
      endUs: number
      text: string
      confidence?: number
      words?: NonNullable<TranscriptSegment['words']>
      hiddenWordCount?: number
    }>
  }
  samples: Array<{
    frame: number
    frameLabel: string
    artifactIds: string[]
    status: 'ready' | 'pending' | 'unavailable'
  }>
  indexes: Array<{
    id: string
    kind: DerivedReference['kind']
    status: DerivedReference['status']
    producerVersion: string
    errorCode?: string
  }>
  capability: {
    timedTranscript: 'ready' | 'missing'
    wordTimestamps: 'ready' | 'missing'
    sampledFrames: 'ready' | 'partial' | 'missing'
    visualUnderstanding: 'not-claimed'
  }
}

export type ProofArtifactBinding = {
  id: string
  kind: 'proof' | 'preview'
  projectId: string
  sequenceId: string
  revision: number
  irDigest: string
  capabilitiesDigest: string
  frame?: number
  status: 'pending' | 'ready' | 'failed' | 'interrupted' | 'invalid'
}

export type ComposedTimelineInspection = {
  schemaVersion: 1
  projectId: string
  sequenceId: string
  revision: number
  frame: number
  frameLabel: string
  irDigest: string
  visibleMediaLayers: Array<{
    itemId: string
    trackId: string
    source: CanonicalRenderIr['layers'][number]['source']
    transform: TimelineItem['transform']
    crop: NonNullable<TimelineItem['crop']>
    opacity: number
    effects: string[]
    keyframeTracks: string[]
  }>
  visibleTextLayers: Array<{
    captionId: string
    trackId: string
    text: string
    placement: Caption['placement']
  }>
  proofArtifacts: Array<ProofArtifactBinding & { current: boolean }>
  proofStatus: 'current' | 'stale' | 'missing'
}

export type ContextSelectionProjection = {
  status: 'current' | 'stale' | 'empty'
  projectId: string
  sequenceId: string
  revision: number
  generation: number
  playheadFrame: number
  selectedAssetIds: string[]
  selectedItemIds: string[]
  selectedCaptionIds: string[]
  selectedWordIds: string[]
  range?: { startFrame: number; endFrame: number }
  staleReason?: 'revision' | 'sequence' | 'generation'
}

export type ResolveContextRequest = {
  expectedRevision?: number
  expectedGeneration?: number
  sequenceId?: string
}

export function readCompactProjectWindow(
  project: VideoProject,
  request: TimelineWindowRequest
): CompactProjectWindow {
  const sequence = resolveSequence(project, request.sequenceId)
  const durationFrames = sequenceDurationFrames(sequence)
  const startFrame = boundedFrame(request.startFrame, 'startFrame')
  const endFrame = boundedFrame(request.endFrame, 'endFrame')
  if (endFrame <= startFrame) {
    throw engineError('invalid_operation', 'Timeline inspection uses a non-empty half-open frame range')
  }
  const effectiveRange = {
    startFrame: Math.min(startFrame, durationFrames),
    endFrame: Math.min(endFrame, durationFrames)
  }
  const itemLimit = boundedLimit(request.itemLimit, INSPECTION_LIMITS.items)
  const captionLimit = boundedLimit(request.captionLimit, INSPECTION_LIMITS.captions)
  const itemsInWindow = sequence.items
    .filter((item) => overlaps(
      item.timelineStartFrame,
      item.timelineStartFrame + item.durationFrames,
      effectiveRange.startFrame,
      effectiveRange.endFrame
    ))
    .sort(compareTimelineItems)
  const captionsInWindow = sequence.captions
    .filter((caption) => overlaps(
      caption.startFrame,
      caption.endFrame,
      effectiveRange.startFrame,
      effectiveRange.endFrame
    ))
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
  const gaps = timelineGaps(sequence, effectiveRange).slice(0, INSPECTION_LIMITS.gaps)
  const words = captionsInWindow.reduce((total, caption) => total + (caption.words?.length ?? 0), 0)
  return {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.currentRevision,
    generation: project.eventGeneration,
    sequence: { id: sequence.id, name: sequence.name, durationFrames },
    sequences: project.sequences.slice(0, INSPECTION_LIMITS.sequences).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      durationFrames: sequenceDurationFrames(candidate),
      open: candidate.viewState.open
    })),
    requestedRange: { startFrame, endFrame },
    effectiveRange,
    tracks: sequence.tracks.slice(0, INSPECTION_LIMITS.tracks).map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      order: track.order,
      ...(track.muted === true ? { muted: true } : {}),
      ...(track.locked === true ? { locked: true } : {})
    })),
    items: itemsInWindow.slice(0, itemLimit).map((item) => compactItem(item, request)),
    captions: captionsInWindow.slice(0, captionLimit).map((caption) => ({
      id: caption.id,
      trackId: caption.trackId,
      startFrame: caption.startFrame,
      endFrame: caption.endFrame,
      ...(request.includeCaptionText ? { text: caption.text } : {}),
      wordCount: caption.words?.length ?? 0,
      placement: caption.placement
    })),
    captionSummary: {
      visible: captionsInWindow.length,
      returned: Math.min(captionsInWindow.length, captionLimit),
      hidden: Math.max(0, captionsInWindow.length - captionLimit),
      words
    },
    gaps,
    hiddenCounts: {
      sequences: Math.max(0, project.sequences.length - INSPECTION_LIMITS.sequences),
      tracks: Math.max(0, sequence.tracks.length - INSPECTION_LIMITS.tracks),
      itemsOutsideWindow: Math.max(0, sequence.items.length - itemsInWindow.length),
      itemsInWindow: Math.max(0, itemsInWindow.length - itemLimit),
      captionsOutsideWindow: Math.max(0, sequence.captions.length - captionsInWindow.length),
      captionsInWindow: Math.max(0, captionsInWindow.length - captionLimit),
      gaps: Math.max(0, timelineGaps(sequence, effectiveRange).length - gaps.length)
    },
    selection: resolveProjectContext(project, { sequenceId: sequence.id })
  }
}

export function inspectRawMedia(
  project: VideoProject,
  request: RawMediaInspectionRequest
): RawMediaInspection {
  const asset = project.assets.find((candidate) => candidate.id === request.assetId)
  if (!asset) throw engineError('invalid_operation', `Asset does not exist: ${request.assetId}`)
  const transcript = resolveTranscript(project, asset, request.transcriptId)
  const segmentOffset = boundedOffset(request.segmentOffset)
  const segmentLimit = boundedLimit(request.segmentLimit, INSPECTION_LIMITS.transcriptSegments)
  const transcriptPage = transcript
    ? projectTranscriptPage(transcript, segmentOffset, segmentLimit, request.includeWords === true)
    : null
  const indexes = project.derivedReferences
    .filter((record) => record.sourceAssetId === asset.id)
    .slice(0, INSPECTION_LIMITS.proofArtifacts)
  const sampleFrames = [...new Set((request.sampleFrames ?? []).map((frame) => boundedFrame(frame, 'sampleFrame')))]
    .slice(0, INSPECTION_LIMITS.sampleFrames)
  const sampleArtifacts = indexes.filter(({ kind }) =>
    kind === 'thumbnail' || kind === 'filmstrip' || kind === 'proxy'
  )
  const readySamples = sampleArtifacts.filter(({ status }) => status === 'ready')
  const fps = asset.video?.frameRate ?? project.fps
  return {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.currentRevision,
    asset: {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      availability: asset.availability ?? 'online',
      durationUs: asset.durationUs,
      container: asset.container,
      ...(asset.video ? { video: asset.video } : {}),
      ...(asset.audio ? { audio: asset.audio } : {}),
      ...(asset.sourceIdentity ? { sourceFingerprint: asset.sourceIdentity } : {})
    },
    transcript: transcriptPage,
    samples: sampleFrames.map((frame) => ({
      frame,
      frameLabel: formatFrameLabel(frame, fps),
      artifactIds: readySamples.map(({ id }) => id),
      status: readySamples.length > 0
        ? 'ready'
        : sampleArtifacts.some(({ status }) => status === 'pending' || status === 'processing')
          ? 'pending'
          : 'unavailable'
    })),
    indexes: indexes.map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      producerVersion: record.producerVersion,
      ...(record.errorCode ? { errorCode: record.errorCode } : {})
    })),
    capability: {
      timedTranscript: transcript ? 'ready' : 'missing',
      wordTimestamps: transcript?.segments.some((segment) => (segment.words?.length ?? 0) > 0)
        ? 'ready'
        : 'missing',
      sampledFrames: readySamples.length === 0
        ? 'missing'
        : readySamples.length < sampleArtifacts.length
          ? 'partial'
          : 'ready',
      visualUnderstanding: 'not-claimed'
    }
  }
}

export function inspectComposedTimeline(
  project: VideoProject,
  frame: number,
  capabilities: RenderBackendCapabilities,
  proofArtifacts: readonly ProofArtifactBinding[] = [],
  sequenceId = project.activeSequenceId
): ComposedTimelineInspection {
  const targetFrame = boundedFrame(frame, 'frame')
  const sequence = resolveSequence(project, sequenceId)
  const duration = sequenceDurationFrames(sequence)
  if (targetFrame >= Math.max(1, duration)) {
    throw engineError('invalid_operation', `Composed inspection frame ${targetFrame} is outside sequence ${sequence.id}`)
  }
  const renderProject = sequence.id === project.activeSequenceId
    ? project
    : {
        ...project,
        activeSequenceId: sequence.id,
        tracks: sequence.tracks,
        items: sequence.items,
        captions: sequence.captions
      }
  const ir = compileRenderIr(renderProject, {
    range: { startFrame: targetFrame, endFrame: targetFrame + 1 }
  })
  const digest = renderIrDigest(ir)
  const capabilitiesDigest = renderCapabilitiesDigest(capabilities)
  const bindings = proofArtifacts.slice(0, INSPECTION_LIMITS.proofArtifacts).map((artifact) => ({
    ...artifact,
    current: artifact.projectId === project.id &&
      artifact.sequenceId === sequence.id &&
      artifact.revision === project.currentRevision &&
      artifact.irDigest === digest &&
      artifact.capabilitiesDigest === capabilitiesDigest
  }))
  return {
    schemaVersion: 1,
    projectId: project.id,
    sequenceId: sequence.id,
    revision: project.currentRevision,
    frame: targetFrame,
    frameLabel: formatFrameLabel(targetFrame, project.fps),
    irDigest: digest,
    visibleMediaLayers: ir.layers.filter((layer) =>
      overlaps(layer.timeline.startFrame, layer.timeline.endFrame, targetFrame, targetFrame + 1)
    ).map((layer) => ({
      itemId: layer.id,
      trackId: layer.trackId,
      source: layer.source,
      transform: layer.visual.transform,
      crop: layer.visual.crop,
      opacity: layer.visual.opacity,
      effects: layer.effects.map(({ id }) => id),
      keyframeTracks: layer.keyframes.map(({ id }) => id)
    })),
    visibleTextLayers: ir.textLayers.filter((layer) =>
      overlaps(layer.timeline.startFrame, layer.timeline.endFrame, targetFrame, targetFrame + 1)
    ).map((layer) => ({
      captionId: layer.id,
      trackId: layer.trackId,
      text: layer.text,
      placement: layer.placement
    })),
    proofArtifacts: bindings,
    proofStatus: bindings.some(({ current, status }) => current && status === 'ready')
      ? 'current'
      : bindings.length > 0
        ? 'stale'
        : 'missing'
  }
}

export function resolveProjectContext(
  project: VideoProject,
  request: ResolveContextRequest = {}
): ContextSelectionProjection {
  const selection = project.selection
  const sequenceId = request.sequenceId ?? selection.sequenceId
  let staleReason: ContextSelectionProjection['staleReason']
  if (request.expectedRevision !== undefined && request.expectedRevision !== project.currentRevision) {
    staleReason = 'revision'
  } else if (request.expectedGeneration !== undefined && request.expectedGeneration !== selection.generation) {
    staleReason = 'generation'
  } else if (selection.sequenceId !== sequenceId || !project.sequences.some(({ id }) => id === sequenceId)) {
    staleReason = 'sequence'
  } else if (selection.revision !== project.currentRevision) {
    staleReason = 'revision'
  }
  const empty = selection.selectedAssetIds.length === 0 &&
    selection.selectedItemIds.length === 0 &&
    selection.selectedCaptionIds.length === 0 &&
    selection.selectedWordIds.length === 0 &&
    selection.range === undefined
  return {
    status: staleReason ? 'stale' : empty ? 'empty' : 'current',
    projectId: project.id,
    sequenceId,
    revision: project.currentRevision,
    generation: selection.generation,
    playheadFrame: selection.playheadFrame,
    selectedAssetIds: [...selection.selectedAssetIds],
    selectedItemIds: [...selection.selectedItemIds],
    selectedCaptionIds: [...selection.selectedCaptionIds],
    selectedWordIds: [...selection.selectedWordIds],
    ...(selection.range ? { range: { ...selection.range } } : {}),
    ...(staleReason ? { staleReason } : {})
  }
}

function compactItem(item: TimelineItem, request: TimelineWindowRequest): CompactTimelineItem {
  const effects = item.effects ?? []
  const keyframes = item.keyframes ?? []
  const defaultTransform = item.transform.x === 0 && item.transform.y === 0 &&
    item.transform.scaleX === 1 && item.transform.scaleY === 1 && item.transform.rotation === 0
  return {
    id: item.id,
    assetId: item.assetId,
    trackId: item.trackId,
    startFrame: item.timelineStartFrame,
    endFrame: item.timelineStartFrame + item.durationFrames,
    sourceStartUs: item.sourceStartUs,
    sourceEndUs: item.sourceEndUs,
    ...(item.speed.numerator !== item.speed.denominator ? { speed: item.speed } : {}),
    ...(item.linkGroupId ? { linkGroupId: item.linkGroupId } : {}),
    ...(item.nestedSequenceId ? { nestedSequenceId: item.nestedSequenceId } : {}),
    ...(!defaultTransform ? { transform: item.transform } : {}),
    ...(item.crop ? { crop: item.crop } : {}),
    ...(item.opacity !== 1 ? { opacity: item.opacity } : {}),
    ...(item.volume !== undefined && item.volume !== 1 ? { volume: item.volume } : {}),
    ...(item.fadeInFrames > 0 || item.fadeOutFrames > 0
      ? { fades: { inFrames: item.fadeInFrames, outFrames: item.fadeOutFrames } }
      : {}),
    ...(request.includeEffects
      ? {
          effects: effects.slice(0, INSPECTION_LIMITS.effectsPerItem).map(({ id, type, enabled }) => ({
            id, type, enabled
          }))
        }
      : effects.length > 0 ? { effectCount: effects.length } : {}),
    ...(request.includeKeyframes
      ? {
          keyframes: keyframes.slice(0, INSPECTION_LIMITS.keyframeTracksPerItem).map((track) => ({
            id: track.id,
            property: track.property,
            interpolation: track.interpolation,
            points: track.points.slice(0, INSPECTION_LIMITS.keyframesPerTrack),
            hiddenPointCount: Math.max(0, track.points.length - INSPECTION_LIMITS.keyframesPerTrack)
          }))
        }
      : keyframes.length > 0 ? { keyframeTrackCount: keyframes.length } : {})
  }
}

function projectTranscriptPage(
  transcript: Transcript,
  offset: number,
  limit: number,
  includeWords: boolean
): NonNullable<RawMediaInspection['transcript']> {
  let remainingWords = includeWords ? INSPECTION_LIMITS.transcriptWords : 0
  let wordsReturned = 0
  let wordsHidden = 0
  const segments = transcript.segments.slice(offset, offset + limit).map((segment) => {
    const words = segment.words ?? []
    const returnedWords = includeWords ? words.slice(0, remainingWords) : []
    remainingWords -= returnedWords.length
    wordsReturned += returnedWords.length
    wordsHidden += words.length - returnedWords.length
    return {
      id: segment.id,
      startUs: segment.startUs,
      endUs: segment.endUs,
      text: segment.text,
      ...(segment.confidence !== undefined ? { confidence: segment.confidence } : {}),
      ...(includeWords ? { words: returnedWords, hiddenWordCount: words.length - returnedWords.length } : {})
    }
  })
  return {
    id: transcript.id,
    language: transcript.language,
    provenance: transcript.provenance,
    ...(transcript.adapter ? { adapter: transcript.adapter } : {}),
    ...(transcript.sourceFingerprint ? { sourceFingerprint: transcript.sourceFingerprint } : {}),
    offset,
    returned: segments.length,
    total: transcript.segments.length,
    hiddenBefore: Math.min(offset, transcript.segments.length),
    hiddenAfter: Math.max(0, transcript.segments.length - offset - segments.length),
    wordsReturned,
    wordsHidden,
    segments
  }
}

function timelineGaps(
  sequence: Sequence,
  range: { startFrame: number; endFrame: number }
): Array<{ trackId: string; startFrame: number; endFrame: number }> {
  const gaps: Array<{ trackId: string; startFrame: number; endFrame: number }> = []
  for (const track of [...sequence.tracks].sort((left, right) => left.order - right.order)) {
    const intervals = track.kind === 'caption'
      ? sequence.captions.filter(({ trackId }) => trackId === track.id).map((caption) => ({
          start: caption.startFrame,
          end: caption.endFrame
        }))
      : sequence.items.filter(({ trackId }) => trackId === track.id).map((item) => ({
          start: item.timelineStartFrame,
          end: item.timelineStartFrame + item.durationFrames
        }))
    const clipped = intervals
      .map(({ start, end }) => ({
        start: Math.max(range.startFrame, start),
        end: Math.min(range.endFrame, end)
      }))
      .filter(({ start, end }) => end > start)
      .sort((left, right) => left.start - right.start || left.end - right.end)
    let cursor = range.startFrame
    for (const interval of clipped) {
      if (interval.start > cursor) gaps.push({ trackId: track.id, startFrame: cursor, endFrame: interval.start })
      cursor = Math.max(cursor, interval.end)
    }
    if (cursor < range.endFrame) gaps.push({ trackId: track.id, startFrame: cursor, endFrame: range.endFrame })
  }
  return gaps
}

function resolveSequence(project: VideoProject, sequenceId = project.activeSequenceId): Sequence {
  if (sequenceId === project.activeSequenceId) return activeSequence(project)
  const sequence = project.sequences.find(({ id }) => id === sequenceId)
  if (!sequence) throw engineError('invalid_operation', `Sequence does not exist: ${sequenceId}`)
  return sequence
}

function resolveTranscript(
  project: VideoProject,
  asset: MediaAsset,
  transcriptId?: string
): Transcript | undefined {
  if (transcriptId !== undefined && !asset.transcriptIds.includes(transcriptId)) {
    throw engineError('invalid_operation', `Transcript ${transcriptId} is not attached to asset ${asset.id}`)
  }
  const id = transcriptId ?? asset.transcriptIds[0]
  return id ? project.transcripts.find((candidate) => candidate.id === id) : undefined
}

function sequenceDurationFrames(sequence: Sequence): number {
  return Math.max(
    0,
    ...sequence.items.map((item) => item.timelineStartFrame + item.durationFrames),
    ...sequence.captions.map((caption) => caption.endFrame)
  )
}

function formatFrameLabel(frame: number, fps: Rational): string {
  const nominalFps = Math.max(1, Math.round(fps.numerator / fps.denominator))
  const frames = frame % nominalFps
  const totalSeconds = Math.floor(frame / nominalFps)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3_600)
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':')
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return left.timelineStartFrame - right.timelineStartFrame || left.trackId.localeCompare(right.trackId) ||
    left.id.localeCompare(right.id)
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start < rangeEnd && end > rangeStart
}

function boundedFrame(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw engineError('invalid_operation', `${field} must be a non-negative safe integer frame`)
  }
  return value
}

function boundedOffset(value: number | undefined): number {
  if (value === undefined) return 0
  return boundedFrame(value, 'segmentOffset')
}

function boundedLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw engineError('invalid_operation', 'Inspection limit must be a positive safe integer')
  }
  return Math.min(value, maximum)
}
