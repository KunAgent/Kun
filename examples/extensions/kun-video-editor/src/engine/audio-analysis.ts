import { engineError } from './errors.js'
import type {
  Caption,
  SpeakerAttributionEvidence,
  SourceIdentity,
  TimelineOperation,
  TranscriptSegment,
  VideoProject
} from './schema.js'
import { applyTimelineOperations } from './timeline.js'
import { microsecondsToFrames } from './time.js'
import { containsAsciiControlCharacters } from '../text-safety.js'

export type LocalAnalysisProvenance = {
  adapterId: string
  adapterVersion: string
  modelId?: string
  modelVersion?: string
  algorithm: string
  algorithmVersion: string
  sourceFingerprint: SourceIdentity
  local: true
  networkUsed: false
  createdAt: string
  cacheKey: string
  execution: 'local' | 'import'
}

export type VadFrameEvidence = {
  id: string
  startUs: number
  endUs: number
  speechProbability: number
}

export type SilenceSuggestion = {
  id: string
  assetId: string
  sourceRange: { assetId: string; startUs: number; endUs: number }
  confidence: number
  disposition: 'safe-to-suggest' | 'review-required'
  reason: 'vad-silence'
}

export type VadAnalysisRecord = {
  schemaVersion: 1
  id: string
  kind: 'vad'
  assetId: string
  provenance: LocalAnalysisProvenance
  speechThreshold: number
  suggestionConfidenceThreshold: number
  frames: VadFrameEvidence[]
  silence: SilenceSuggestion[]
  completeness: 'complete' | 'partial'
  immutable: true
}

export type SpeakerModelDescriptor = {
  adapterId: string
  adapterVersion: string
  modelId: string
  modelVersion: string
  embeddingDimensions: number
}

export type SpeakerAdapterCapability =
  | {
      outcome: 'ready'
      adapter: SpeakerModelDescriptor & { execution: 'local' }
      networkUsedForInference: false
    }
  | {
      outcome: 'unavailable'
      code: 'speaker_model_disabled' | 'speaker_model_unverified' | 'speaker_inference_broker_unavailable'
      retryable: boolean
      remediation: string
      networkUsedForInference: false
    }

export type SpeakerRegistryEntry = {
  id: string
  label: string
  embedding: number[]
  adapterId: string
  modelId: string
  sourceEvidenceIds: string[]
  createdAt: string
}

export type SpeakerIdentity = {
  id: string
  label: string
  aliases: string[]
  sourceEvidenceIds: string[]
  createdAt: string
  updatedAt: string
}

export type SpeakerDiarizationAdapterDescriptor = {
  id: string
  version: string
  execution: 'local-model' | 'import'
  format?: 'kun-speaker-json-v1'
  modelId?: string
  modelVersion?: string
}

export type SpeakerDiarizationAdapterStatus =
  | {
      descriptor: SpeakerDiarizationAdapterDescriptor
      outcome: 'ready'
      local: true
      networkUsed: false
    }
  | {
      descriptor: SpeakerDiarizationAdapterDescriptor
      outcome: 'unavailable'
      code: 'speaker_inference_broker_unavailable' | 'speaker_model_unverified'
      remediation: string
      local: true
      networkUsed: false
    }

export type ImportedDiarizationTurn = {
  id: string
  startUs: number
  endUs: number
  status: 'identified' | 'unknown' | 'overlap'
  speakerId?: string
  overlapSpeakerIds?: string[]
  confidence: number
  sourceEvidenceIds?: string[]
}

export class SpeakerIdentityRegistry {
  private readonly entries = new Map<string, SpeakerIdentity>()

  constructor(entries: readonly SpeakerIdentity[] = []) {
    for (const entry of entries) this.upsert(entry)
  }

  upsert(entry: SpeakerIdentity): SpeakerIdentity {
    identifier(entry.id, 'speaker identity ID')
    const label = boundedSpeakerLabel(entry.label, 'speaker identity label')
    const aliases = [...new Set(entry.aliases.map((alias) => boundedSpeakerLabel(alias, 'speaker alias')))]
      .filter((alias) => alias !== label)
      .slice(0, 32)
    const sourceEvidenceIds = [...new Set(entry.sourceEvidenceIds.map((id) => {
      identifier(id, 'speaker source evidence ID')
      return id
    }))].slice(0, 256)
    const existing = this.entries.get(entry.id)
    const normalized: SpeakerIdentity = deepFreeze({
      id: entry.id,
      label,
      aliases,
      sourceEvidenceIds,
      createdAt: existing?.createdAt ?? validIsoTimestamp(entry.createdAt, 'speaker createdAt'),
      updatedAt: validIsoTimestamp(entry.updatedAt, 'speaker updatedAt')
    })
    this.entries.set(entry.id, normalized)
    return structuredClone(normalized)
  }

  get(id: string): SpeakerIdentity | undefined {
    const entry = this.entries.get(id)
    return entry ? structuredClone(entry) : undefined
  }

  list(): SpeakerIdentity[] {
    return [...this.entries.values()]
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
      .map((entry) => structuredClone(entry))
  }
}

export class SpeakerDiarizationAdapterRegistry {
  private readonly entries = new Map<string, SpeakerDiarizationAdapterStatus>()

  constructor(entries: readonly SpeakerDiarizationAdapterStatus[] = []) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: SpeakerDiarizationAdapterStatus): void {
    validateSpeakerDiarizationAdapterStatus(entry)
    if (this.entries.has(entry.descriptor.id)) {
      throw engineError('invalid_operation', `Speaker adapter already exists: ${entry.descriptor.id}`)
    }
    this.entries.set(entry.descriptor.id, deepFreeze(structuredClone(entry)))
  }

  list(): SpeakerDiarizationAdapterStatus[] {
    return [...this.entries.values()]
      .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id))
      .map((entry) => structuredClone(entry))
  }

  requireReady(id: string): Extract<SpeakerDiarizationAdapterStatus, { outcome: 'ready' }> {
    const entry = this.entries.get(id)
    if (!entry) throw engineError('invalid_operation', `Speaker adapter is not registered: ${id}`)
    if (entry.outcome !== 'ready') {
      throw engineError('invalid_operation', entry.remediation ?? `Speaker adapter is unavailable: ${id}`)
    }
    return structuredClone(entry) as Extract<SpeakerDiarizationAdapterStatus, { outcome: 'ready' }>
  }
}

export function defaultSpeakerDiarizationAdapterRegistry(input: {
  localDescriptor?: SpeakerModelDescriptor
  localInstallationVerified?: boolean
  localInferenceBrokerAvailable?: boolean
} = {}): SpeakerDiarizationAdapterRegistry {
  const entries: SpeakerDiarizationAdapterStatus[] = [{
    descriptor: {
      id: 'kun.imported-speaker-labels',
      version: '1.0.0',
      execution: 'import',
      format: 'kun-speaker-json-v1'
    },
    outcome: 'ready',
    local: true,
    networkUsed: false
  }]
  if (input.localDescriptor) {
    const capability = negotiateSpeakerAdapter({
      optIn: true,
      descriptor: input.localDescriptor,
      installationVerified: input.localInstallationVerified === true,
      inferenceBrokerAvailable: input.localInferenceBrokerAvailable === true
    })
    entries.push(capability.outcome === 'ready'
      ? {
          descriptor: {
            id: capability.adapter.adapterId,
            version: capability.adapter.adapterVersion,
            execution: 'local-model',
            modelId: capability.adapter.modelId,
            modelVersion: capability.adapter.modelVersion
          },
          outcome: 'ready', local: true, networkUsed: false
        }
      : {
          descriptor: {
            id: input.localDescriptor.adapterId,
            version: input.localDescriptor.adapterVersion,
            execution: 'local-model',
            modelId: input.localDescriptor.modelId,
            modelVersion: input.localDescriptor.modelVersion
          },
          outcome: 'unavailable',
          code: capability.code === 'speaker_model_disabled'
            ? 'speaker_model_unverified'
            : capability.code,
          remediation: capability.remediation,
          local: true,
          networkUsed: false
        })
  }
  return new SpeakerDiarizationAdapterRegistry(entries)
}

export type SpeakerMatch = {
  speakerId?: string
  label?: string
  confidence: number
  runnerUpConfidence?: number
  uncertain: boolean
  reason?: 'below-threshold' | 'ambiguous' | 'empty-registry' | 'unknown-speaker' | 'overlap' | 'import-low-confidence'
}

export type DiarizationTurnEvidence = {
  id: string
  startUs: number
  endUs: number
  embedding: number[]
  adapterConfidence: number
}

export type DiarizationTurn = {
  id: string
  startUs: number
  endUs: number
  speakerId?: string
  speakerLabel?: string
  confidence: number
  uncertain: boolean
  status?: SpeakerAttributionEvidence['status']
  overlapSpeakerIds?: string[]
  sourceEvidenceIds?: string[]
  reason?: SpeakerMatch['reason']
}

export type DiarizationRecord = {
  schemaVersion: 1
  id: string
  kind: 'speaker-diarization'
  assetId: string
  provenance: LocalAnalysisProvenance
  turns: DiarizationTurn[]
  uncertainTurnCount: number
  completeness: 'complete' | 'partial'
  immutable: true
}

export type SpeakerAttribution = {
  analysisId: string
  speakerId?: string
  speakerLabel?: string
  confidence: number
  uncertain: boolean
  status: SpeakerAttributionEvidence['status']
  sourceTurnIds: string[]
}

export type SpeakerAttributionPlan = {
  schemaVersion: 1
  projectId: string
  expectedRevision: number
  analysisId: string
  transcriptSegments: Array<SpeakerAttribution & { transcriptId: string; segmentId: string }>
  captions: Array<SpeakerAttribution & { captionId: string }>
  warnings: string[]
}

export type BeatObservation = {
  id: string
  timeUs: number
  strength: number
  beatProbability: number
  downbeatProbability?: number
}

export type BeatMarker = {
  id: string
  assetId: string
  sourceUs: number
  kind: 'beat' | 'downbeat'
  confidence: number
  strength: number
}

export type BeatAnalysisRecord = {
  schemaVersion: 1
  id: string
  kind: 'beat-grid'
  assetId: string
  provenance: LocalAnalysisProvenance
  tempoBpm?: number
  markers: BeatMarker[]
  completeness: 'complete' | 'partial'
  immutable: true
}

export type BeatSnapTarget = {
  id: string
  itemId: string
  assetId: string
  frame: number
  kind: 'beat' | 'downbeat'
  confidence: number
  sourceUs: number
}

export type AudioSyncAnalysis = {
  schemaVersion: 1
  id: string
  kind: 'audio-sync'
  referenceAssetId: string
  targetAssetId: string
  seed: number
  samplePeriodUs: number
  candidateCount: number
  proposedTargetDeltaUs: number
  bestCorrelation: number
  runnerUpCorrelation: number
  confidence: number
  separation: number
  threshold: number
  minimumSeparation: number
  outcome: 'ready' | 'uncertain'
  refusalReason?: 'confidence-below-threshold' | 'ambiguous-correlation'
  provenance: LocalAnalysisProvenance
  immutable: true
}

export type AudioSyncPreview = {
  referenceItemId: string
  targetItemId: string
  targetFrameBefore: number
  targetFrameAfter: number
  deltaFrames: number
  confidence: number
  outcome: AudioSyncAnalysis['outcome']
  refusalReason?: AudioSyncAnalysis['refusalReason']
}

export type AudioSyncPlan = AudioSyncPreview & {
  schemaVersion: 1
  projectId: string
  expectedRevision: number
  analysisId: string
  operation?: TimelineOperation
}

export function analyzeVadEvidence(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  frames: readonly VadFrameEvidence[]
  speechThreshold?: number
  minimumSilenceUs?: number
  suggestionConfidenceThreshold?: number
  completeness?: 'complete' | 'partial'
  adapterId?: string
  adapterVersion?: string
  now?: () => Date
}): VadAnalysisRecord {
  identifier(input.assetId, 'assetId')
  assertFingerprint(input.sourceFingerprint)
  const speechThreshold = confidence(input.speechThreshold ?? 0.5, 'speechThreshold')
  const suggestionThreshold = confidence(
    input.suggestionConfidenceThreshold ?? 0.82,
    'suggestionConfidenceThreshold'
  )
  const minimumSilenceUs = boundedInteger(input.minimumSilenceUs ?? 300_000, 1, 60_000_000, 'minimumSilenceUs')
  const frames = input.frames.map((frame) => ({ ...frame }))
  validateTimedEvidence(frames, 'VAD frame')
  frames.forEach((frame) => confidence(frame.speechProbability, `speech probability for ${frame.id}`))
  const silence: SilenceSuggestion[] = []
  let run: VadFrameEvidence[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const startUs = run[0]!.startUs
    const endUs = run.at(-1)!.endUs
    if (endUs - startUs >= minimumSilenceUs) {
      const average = run.reduce((total, frame) => total + (1 - frame.speechProbability), 0) / run.length
      const rounded = Number(average.toFixed(6))
      silence.push({
        id: `silence:${input.assetId}:${startUs}:${endUs}`,
        assetId: input.assetId,
        sourceRange: { assetId: input.assetId, startUs, endUs },
        confidence: rounded,
        disposition: rounded >= suggestionThreshold ? 'safe-to-suggest' : 'review-required',
        reason: 'vad-silence'
      })
    }
    run = []
  }
  for (const frame of frames) {
    if (frame.speechProbability < speechThreshold) run.push(frame)
    else flush()
  }
  flush()
  const vadProvenance = provenance({
    assetId: input.assetId,
    sourceFingerprint: input.sourceFingerprint,
    adapterId: input.adapterId ?? 'kun.local.vad-evidence',
    adapterVersion: input.adapterVersion ?? '1.0.0',
    algorithm: 'threshold-merge-vad',
    algorithmVersion: '1.0.0',
    parameters: [speechThreshold, minimumSilenceUs, suggestionThreshold],
    now: input.now
  })
  return deepFreeze({
    schemaVersion: 1,
    id: `analysis:vad:${vadProvenance.cacheKey}`,
    kind: 'vad',
    assetId: input.assetId,
    provenance: vadProvenance,
    speechThreshold,
    suggestionConfidenceThreshold: suggestionThreshold,
    frames,
    silence,
    completeness: input.completeness ?? 'complete',
    immutable: true
  })
}

export function negotiateSpeakerAdapter(input: {
  optIn: boolean
  descriptor: SpeakerModelDescriptor
  installationVerified: boolean
  inferenceBrokerAvailable: boolean
}): SpeakerAdapterCapability {
  validateSpeakerDescriptor(input.descriptor)
  if (!input.optIn) {
    return speakerUnavailable('speaker_model_disabled', true, 'Enable local speaker analysis for this workspace first.')
  }
  if (!input.installationVerified) {
    return speakerUnavailable(
      'speaker_model_unverified',
      true,
      'Install and verify the speaker model through an approved Host model broker.'
    )
  }
  if (!input.inferenceBrokerAvailable) {
    return speakerUnavailable(
      'speaker_inference_broker_unavailable',
      false,
      'The speaker model is verified, but this Extension API has no approved local inference broker.'
    )
  }
  return {
    outcome: 'ready',
    adapter: { ...input.descriptor, execution: 'local' },
    networkUsedForInference: false
  }
}

export class SpeakerRegistry {
  private readonly entries = new Map<string, SpeakerRegistryEntry>()

  constructor(entries: readonly SpeakerRegistryEntry[] = []) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: SpeakerRegistryEntry): SpeakerRegistryEntry {
    identifier(entry.id, 'speaker ID')
    if (!entry.label.trim() || entry.label.length > 128) throw engineError('invalid_operation', 'Speaker label is invalid')
    if (this.entries.has(entry.id)) throw engineError('invalid_operation', `Speaker already exists: ${entry.id}`)
    const normalized: SpeakerRegistryEntry = {
      ...entry,
      label: entry.label.trim(),
      embedding: normalizedVector(entry.embedding, 'speaker embedding'),
      sourceEvidenceIds: [...new Set(entry.sourceEvidenceIds)].slice(0, 256)
    }
    this.entries.set(entry.id, deepFreeze(normalized))
    return structuredClone(normalized)
  }

  list(): SpeakerRegistryEntry[] {
    return [...this.entries.values()]
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
      .map((entry) => structuredClone(entry))
  }

  match(embedding: readonly number[], options: { threshold?: number; minimumMargin?: number } = {}): SpeakerMatch {
    const query = normalizedVector(embedding, 'speaker query')
    const threshold = confidence(options.threshold ?? 0.78, 'speaker threshold')
    const minimumMargin = confidence(options.minimumMargin ?? 0.05, 'speaker minimum margin')
    const ranked = [...this.entries.values()].map((entry) => {
      if (entry.embedding.length !== query.length) {
        throw engineError('invalid_operation', 'Speaker registry and query dimensions differ')
      }
      return { entry, score: dot(query, entry.embedding) }
    }).sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    const best = ranked[0]
    if (!best) return { confidence: 0, uncertain: true, reason: 'empty-registry' }
    const runnerUp = ranked[1]?.score
    const rounded = Number(best.score.toFixed(6))
    if (best.score < threshold) {
      return { confidence: rounded, ...(runnerUp === undefined ? {} : { runnerUpConfidence: runnerUp }), uncertain: true, reason: 'below-threshold' }
    }
    if (runnerUp !== undefined && best.score - runnerUp < minimumMargin) {
      return { confidence: rounded, runnerUpConfidence: Number(runnerUp.toFixed(6)), uncertain: true, reason: 'ambiguous' }
    }
    return {
      speakerId: best.entry.id,
      label: best.entry.label,
      confidence: rounded,
      ...(runnerUp === undefined ? {} : { runnerUpConfidence: Number(runnerUp.toFixed(6)) }),
      uncertain: false
    }
  }
}

export function diarizeSpeakerEvidence(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  capability: Extract<SpeakerAdapterCapability, { outcome: 'ready' }>
  registry: SpeakerRegistry
  turns: readonly DiarizationTurnEvidence[]
  threshold?: number
  minimumMargin?: number
  completeness?: 'complete' | 'partial'
  now?: () => Date
}): DiarizationRecord {
  identifier(input.assetId, 'assetId')
  assertFingerprint(input.sourceFingerprint)
  validateTimedEvidence(input.turns, 'diarization turn')
  const turns = input.turns.map((turn): DiarizationTurn => {
    confidence(turn.adapterConfidence, `adapter confidence for ${turn.id}`)
    const match = input.registry.match(turn.embedding, {
      threshold: input.threshold,
      minimumMargin: input.minimumMargin
    })
    const combined = Number(Math.min(turn.adapterConfidence, match.confidence).toFixed(6))
    const uncertain = match.uncertain || combined < (input.threshold ?? 0.78)
    return {
      id: turn.id,
      startUs: turn.startUs,
      endUs: turn.endUs,
      ...(!uncertain && match.speakerId ? { speakerId: match.speakerId, speakerLabel: match.label } : {}),
      confidence: combined,
      uncertain,
      status: uncertain ? 'uncertain' : 'identified',
      ...(uncertain ? { reason: match.reason ?? 'below-threshold' } : {})
    }
  })
  const recordProvenance = provenance({
    assetId: input.assetId,
    sourceFingerprint: input.sourceFingerprint,
    adapterId: input.capability.adapter.adapterId,
    adapterVersion: input.capability.adapter.adapterVersion,
    modelId: `${input.capability.adapter.modelId}@${input.capability.adapter.modelVersion}`,
    algorithm: 'speaker-registry-cosine-match',
    algorithmVersion: '1.0.0',
    parameters: [input.threshold ?? 0.78, input.minimumMargin ?? 0.05],
    now: input.now
  })
  return deepFreeze({
    schemaVersion: 1,
    id: `analysis:speaker:${recordProvenance.cacheKey}`,
    kind: 'speaker-diarization',
    assetId: input.assetId,
    provenance: recordProvenance,
    turns,
    uncertainTurnCount: turns.filter(({ uncertain }) => uncertain).length,
    completeness: input.completeness ?? 'complete',
    immutable: true
  })
}

/**
 * Normalizes explicitly imported, time-bounded speaker evidence. This adapter
 * performs no inference and accepts no path or media bytes. Speaker labels are
 * resolved only through the supplied identity registry, preventing a turn from
 * smuggling an unregistered identity into project attribution.
 */
export function importSpeakerDiarizationEvidence(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  adapter: Extract<SpeakerDiarizationAdapterStatus, { outcome: 'ready' }>
  identities: SpeakerIdentityRegistry
  turns: readonly ImportedDiarizationTurn[]
  confidenceThreshold?: number
  completeness?: 'complete' | 'partial'
  now?: () => Date
}): DiarizationRecord {
  identifier(input.assetId, 'assetId')
  assertFingerprint(input.sourceFingerprint)
  if (input.adapter.descriptor.execution !== 'import') {
    throw engineError('invalid_operation', 'Imported speaker evidence requires an import adapter')
  }
  const threshold = confidence(input.confidenceThreshold ?? 0.7, 'speaker import confidence threshold')
  validateTimedEvidence(input.turns, 'imported diarization turn')
  const turns = input.turns.map((turn): DiarizationTurn => {
    const score = confidence(turn.confidence, `speaker confidence for ${turn.id}`)
    const sourceEvidenceIds = [...new Set(turn.sourceEvidenceIds ?? [])].map((id) => {
      identifier(id, `speaker source evidence ID for ${turn.id}`)
      return id
    }).slice(0, 32)
    if (turn.status === 'identified') {
      if (!turn.speakerId || turn.overlapSpeakerIds !== undefined) {
        throw engineError('invalid_operation', `Identified speaker turn ${turn.id} requires exactly one speaker identity`)
      }
      const identity = input.identities.get(turn.speakerId)
      if (!identity) throw engineError('invalid_operation', `Speaker identity is not registered: ${turn.speakerId}`)
      const uncertain = score < threshold
      return {
        id: turn.id,
        startUs: turn.startUs,
        endUs: turn.endUs,
        ...(!uncertain ? { speakerId: identity.id, speakerLabel: identity.label } : {}),
        confidence: score,
        uncertain,
        status: uncertain ? 'uncertain' : 'identified',
        ...(sourceEvidenceIds.length > 0 ? { sourceEvidenceIds } : {}),
        ...(uncertain ? { reason: 'import-low-confidence' } : {})
      }
    }
    if (turn.speakerId !== undefined) {
      throw engineError('invalid_operation', `${turn.status} speaker turn ${turn.id} cannot assert one speaker identity`)
    }
    if (turn.status === 'overlap') {
      const overlapSpeakerIds = [...new Set(turn.overlapSpeakerIds ?? [])]
      if (overlapSpeakerIds.length < 2 || overlapSpeakerIds.length > 8) {
        throw engineError('invalid_operation', `Overlapping speaker turn ${turn.id} requires 2 through 8 registered identities`)
      }
      for (const id of overlapSpeakerIds) {
        identifier(id, `overlap speaker ID for ${turn.id}`)
        if (!input.identities.get(id)) throw engineError('invalid_operation', `Speaker identity is not registered: ${id}`)
      }
      return {
        id: turn.id,
        startUs: turn.startUs,
        endUs: turn.endUs,
        confidence: score,
        uncertain: true,
        status: 'overlap',
        overlapSpeakerIds,
        ...(sourceEvidenceIds.length > 0 ? { sourceEvidenceIds } : {}),
        reason: 'overlap'
      }
    }
    if ((turn.overlapSpeakerIds?.length ?? 0) > 0) {
      throw engineError('invalid_operation', `Unknown speaker turn ${turn.id} cannot assert overlapping identities`)
    }
    return {
      id: turn.id,
      startUs: turn.startUs,
      endUs: turn.endUs,
      confidence: score,
      uncertain: true,
      status: 'unknown',
      ...(sourceEvidenceIds.length > 0 ? { sourceEvidenceIds } : {}),
      reason: 'unknown-speaker'
    }
  })
  const evidenceDigest = stableDigest64([
    JSON.stringify(input.identities.list()),
    JSON.stringify(input.turns)
  ])
  const adapter = input.adapter.descriptor
  const cacheKey = stableKey([
    input.assetId,
    input.sourceFingerprint.value,
    adapter.id,
    adapter.version,
    evidenceDigest,
    threshold
  ])
  return deepFreeze({
    schemaVersion: 1,
    id: `analysis:speaker:${cacheKey}`,
    kind: 'speaker-diarization',
    assetId: input.assetId,
    provenance: {
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      algorithm: 'imported-speaker-turn-normalization',
      algorithmVersion: '1.0.0',
      sourceFingerprint: structuredClone(input.sourceFingerprint),
      local: true,
      networkUsed: false,
      execution: 'import',
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      cacheKey
    },
    turns,
    uncertainTurnCount: turns.filter(({ uncertain }) => uncertain).length,
    completeness: input.completeness ?? 'complete',
    immutable: true
  })
}

export function buildSpeakerAttributionPlan(
  project: VideoProject,
  record: DiarizationRecord
): SpeakerAttributionPlan {
  const transcripts = project.transcripts.filter(({ assetId }) => assetId === record.assetId)
  const transcriptSegments: SpeakerAttributionPlan['transcriptSegments'] = []
  type IndexedSegment = { attribution?: SpeakerAttribution }
  const byTranscriptSegment = new Map<string, IndexedSegment[]>()
  const byUnqualifiedSegment = new Map<string, IndexedSegment[]>()
  const warnings: string[] = []
  for (const transcript of transcripts) {
    for (const segment of transcript.segments) {
      const attribution = attributionForRange(segment, record)
      const indexed = attribution ? { attribution } : {}
      const scopedKey = `${transcript.id}\u0000${segment.id}`
      byTranscriptSegment.set(scopedKey, [...(byTranscriptSegment.get(scopedKey) ?? []), indexed])
      byUnqualifiedSegment.set(segment.id, [...(byUnqualifiedSegment.get(segment.id) ?? []), indexed])
      if (!attribution) continue
      const value = { transcriptId: transcript.id, segmentId: segment.id, ...attribution }
      transcriptSegments.push(value)
      if (attribution.uncertain) warnings.push(`Speaker attribution for segment ${segment.id} requires review.`)
    }
  }
  const captions = project.captions.flatMap((caption) => {
    const candidates = [...new Set(caption.sourceSegmentIds ?? [])].flatMap((id) => {
      if (caption.sourceTranscriptId) {
        const matches = byTranscriptSegment.get(`${caption.sourceTranscriptId}\u0000${id}`) ?? []
        if (matches.length > 1) {
          warnings.push(`Caption ${caption.id} references duplicate segment ${id} in transcript ${caption.sourceTranscriptId}.`)
          return []
        }
        const match = matches[0]?.attribution
        return match ? [match] : []
      }
      const matches = byUnqualifiedSegment.get(id) ?? []
      if (matches.length > 1) {
        warnings.push(`Caption ${caption.id} references ambiguous segment ${id}; sourceTranscriptId is required.`)
        return []
      }
      const match = matches[0]?.attribution
      return match ? [match] : []
    })
    const resolved = mergeAttributions(candidates, record.id)
    return resolved ? [{ captionId: caption.id, ...resolved }] : []
  })
  return {
    schemaVersion: 1,
    projectId: project.id,
    expectedRevision: project.currentRevision,
    analysisId: record.id,
    transcriptSegments,
    captions,
    warnings: warnings.slice(0, 100)
  }
}

export function applySpeakerAttributionPlan(
  project: VideoProject,
  plan: SpeakerAttributionPlan
): {
  project: VideoProject
  attributedTranscriptSegmentCount: number
  attributedCaptionCount: number
  identifiedCount: number
  uncertainCount: number
} {
  if (plan.projectId !== project.id || plan.expectedRevision !== project.currentRevision) {
    throw engineError('revision_conflict', 'Speaker attribution plan is stale; refresh diarization evidence before applying')
  }
  if ([...plan.transcriptSegments, ...plan.captions].some(({ analysisId }) => analysisId !== plan.analysisId)) {
    throw engineError('invalid_operation', 'Speaker attribution plan mixes unrelated evidence records')
  }
  const next = structuredClone(project)
  const segmentTargets = new Map(plan.transcriptSegments.map((entry) => [`${entry.transcriptId}\u0000${entry.segmentId}`, entry]))
  const captionTargets = new Map(plan.captions.map((entry) => [entry.captionId, entry]))
  let attributedTranscriptSegmentCount = 0
  let attributedCaptionCount = 0
  let identifiedCount = 0
  let uncertainCount = 0
  for (const transcript of next.transcripts) {
    for (const segment of transcript.segments) {
      const entry = segmentTargets.get(`${transcript.id}\u0000${segment.id}`)
      if (!entry) continue
      segment.speakerAttribution = persistedSpeakerAttribution(entry)
      attributedTranscriptSegmentCount += 1
      if (entry.status === 'identified') identifiedCount += 1
      else uncertainCount += 1
      segmentTargets.delete(`${transcript.id}\u0000${segment.id}`)
    }
  }
  const applyCaption = (caption: Caption): void => {
    const entry = captionTargets.get(caption.id)
    if (!entry) return
    caption.speakerAttribution = persistedSpeakerAttribution(entry)
    captionTargets.delete(caption.id)
    attributedCaptionCount += 1
    if (entry.status === 'identified') identifiedCount += 1
    else uncertainCount += 1
  }
  next.captions.forEach(applyCaption)
  for (const sequence of next.sequences) {
    for (const caption of sequence.captions) {
      const source = next.captions.find(({ id }) => id === caption.id)
      if (source?.speakerAttribution) caption.speakerAttribution = structuredClone(source.speakerAttribution)
    }
  }
  if (segmentTargets.size > 0 || captionTargets.size > 0) {
    throw engineError('revision_conflict', 'Speaker attribution targets changed; refresh the project before applying')
  }
  return { project: next, attributedTranscriptSegmentCount, attributedCaptionCount, identifiedCount, uncertainCount }
}

export function analyzeBeatEvidence(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  observations: readonly BeatObservation[]
  beatThreshold?: number
  downbeatThreshold?: number
  tempoBpm?: number
  completeness?: 'complete' | 'partial'
  adapterId?: string
  adapterVersion?: string
  modelId?: string
  now?: () => Date
}): BeatAnalysisRecord {
  identifier(input.assetId, 'assetId')
  assertFingerprint(input.sourceFingerprint)
  const beatThreshold = confidence(input.beatThreshold ?? 0.65, 'beatThreshold')
  const downbeatThreshold = confidence(input.downbeatThreshold ?? 0.75, 'downbeatThreshold')
  const seen = new Set<string>()
  let previousUs = -1
  const markers: BeatMarker[] = []
  for (const observation of input.observations) {
    identifier(observation.id, 'beat observation ID')
    if (seen.has(observation.id)) throw engineError('invalid_operation', 'Beat observation IDs must be unique')
    seen.add(observation.id)
    boundedInteger(observation.timeUs, 0, Number.MAX_SAFE_INTEGER, `time for ${observation.id}`)
    if (observation.timeUs < previousUs) throw engineError('invalid_operation', 'Beat observations must be ordered')
    previousUs = observation.timeUs
    confidence(observation.strength, `strength for ${observation.id}`)
    confidence(observation.beatProbability, `beat probability for ${observation.id}`)
    if (observation.downbeatProbability !== undefined) confidence(observation.downbeatProbability, `downbeat probability for ${observation.id}`)
    const isDownbeat = (observation.downbeatProbability ?? 0) >= downbeatThreshold
    if (!isDownbeat && observation.beatProbability < beatThreshold) continue
    markers.push({
      id: `marker:${observation.id}`,
      assetId: input.assetId,
      sourceUs: observation.timeUs,
      kind: isDownbeat ? 'downbeat' : 'beat',
      confidence: Number((isDownbeat ? observation.downbeatProbability! : observation.beatProbability).toFixed(6)),
      strength: observation.strength
    })
  }
  if (input.tempoBpm !== undefined && (!Number.isFinite(input.tempoBpm) || input.tempoBpm < 20 || input.tempoBpm > 400)) {
    throw engineError('invalid_operation', 'Tempo must be from 20 through 400 BPM')
  }
  const recordProvenance = provenance({
    assetId: input.assetId,
    sourceFingerprint: input.sourceFingerprint,
    adapterId: input.adapterId ?? 'kun.local.beat-evidence',
    adapterVersion: input.adapterVersion ?? '1.0.0',
    modelId: input.modelId,
    algorithm: 'thresholded-beat-marker',
    algorithmVersion: '1.0.0',
    parameters: [beatThreshold, downbeatThreshold, input.tempoBpm ?? 'unknown'],
    now: input.now
  })
  return deepFreeze({
    schemaVersion: 1,
    id: `analysis:beats:${recordProvenance.cacheKey}`,
    kind: 'beat-grid',
    assetId: input.assetId,
    provenance: recordProvenance,
    ...(input.tempoBpm === undefined ? {} : { tempoBpm: input.tempoBpm }),
    markers,
    completeness: input.completeness ?? 'complete',
    immutable: true
  })
}

export function beatSnapTargets(project: VideoProject, record: BeatAnalysisRecord): BeatSnapTarget[] {
  const targets: BeatSnapTarget[] = []
  for (const item of project.items.filter(({ assetId }) => assetId === record.assetId)) {
    for (const marker of record.markers) {
      if (marker.sourceUs < item.sourceStartUs || marker.sourceUs >= item.sourceEndUs) continue
      const sourceDelta = marker.sourceUs - item.sourceStartUs
      const timelineUs = Math.round(sourceDelta * item.speed.denominator / item.speed.numerator)
      targets.push({
        id: `snap:${item.id}:${marker.id}`,
        itemId: item.id,
        assetId: record.assetId,
        frame: item.timelineStartFrame + microsecondsToFrames(timelineUs, project.fps),
        kind: marker.kind,
        confidence: marker.confidence,
        sourceUs: marker.sourceUs
      })
    }
  }
  return targets.sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id)).slice(0, 10_000)
}

export function beatEvidenceWindow(
  record: BeatAnalysisRecord,
  offset = 0,
  limit = 100
): {
  analysisId: string
  assetId: string
  markers: BeatMarker[]
  nextOffset?: number
  total: number
  completeness: BeatAnalysisRecord['completeness']
  provenance: LocalAnalysisProvenance
} {
  offset = boundedInteger(offset, 0, 1_000_000, 'offset')
  limit = boundedInteger(limit, 1, 500, 'limit')
  const markers = record.markers.slice(offset, offset + limit)
  const nextOffset = offset + markers.length
  return {
    analysisId: record.id,
    assetId: record.assetId,
    markers,
    ...(nextOffset < record.markers.length ? { nextOffset } : {}),
    total: record.markers.length,
    completeness: record.completeness,
    provenance: structuredClone(record.provenance)
  }
}

export function analyzeAudioSynchronization(input: {
  referenceAssetId: string
  targetAssetId: string
  referenceFeatures: readonly number[]
  targetFeatures: readonly number[]
  samplePeriodUs: number
  maximumOffsetUs: number
  seed: number
  threshold?: number
  minimumSeparation?: number
  referenceFingerprint: SourceIdentity
  targetFingerprint: SourceIdentity
  adapterId?: string
  adapterVersion?: string
  now?: () => Date
}): AudioSyncAnalysis {
  identifier(input.referenceAssetId, 'referenceAssetId')
  identifier(input.targetAssetId, 'targetAssetId')
  if (input.referenceAssetId === input.targetAssetId) throw engineError('invalid_operation', 'Audio sync requires two different assets')
  assertFingerprint(input.referenceFingerprint)
  assertFingerprint(input.targetFingerprint)
  const samplePeriodUs = boundedInteger(input.samplePeriodUs, 1, 10_000_000, 'samplePeriodUs')
  const maximumOffsetUs = boundedInteger(input.maximumOffsetUs, 0, 3_600_000_000, 'maximumOffsetUs')
  const seed = boundedInteger(input.seed, 0, 0x7fffffff, 'seed')
  const threshold = confidence(input.threshold ?? 0.82, 'sync threshold')
  const minimumSeparation = confidence(input.minimumSeparation ?? 0.03, 'sync minimum separation')
  validateFeatureSeries(input.referenceFeatures, 'referenceFeatures')
  validateFeatureSeries(input.targetFeatures, 'targetFeatures')
  const maxLag = Math.floor(maximumOffsetUs / samplePeriodUs)
  const candidates = seededCandidates(maxLag, seed)
  const ranked = candidates.flatMap((lag, rank) => {
    const correlation = correlationAtLag(input.referenceFeatures, input.targetFeatures, lag)
    return correlation === undefined ? [] : [{ lag, correlation, rank }]
  }).sort((left, right) =>
    right.correlation - left.correlation || left.rank - right.rank || Math.abs(left.lag) - Math.abs(right.lag)
  )
  const best = ranked[0]
  if (!best) throw engineError('invalid_operation', 'Audio feature evidence has insufficient overlap for synchronization')
  const runnerUp = ranked.find(({ lag }) => Math.abs(lag - best.lag) > 1) ?? ranked[1]
  const bestCorrelation = Number(best.correlation.toFixed(8))
  const runnerUpCorrelation = Number((runnerUp?.correlation ?? -1).toFixed(8))
  const syncConfidence = Number(Math.max(0, Math.min(1, (best.correlation + 1) / 2)).toFixed(8))
  const separation = Number(Math.max(0, best.correlation - (runnerUp?.correlation ?? -1)).toFixed(8))
  const refusalReason = syncConfidence < threshold
    ? 'confidence-below-threshold' as const
    : separation < minimumSeparation
      ? 'ambiguous-correlation' as const
      : undefined
  const combinedFingerprint = combineAudioSourceFingerprints(
    input.referenceFingerprint,
    input.targetFingerprint
  )
  const analysisProvenance = provenance({
    assetId: `${input.referenceAssetId}:${input.targetAssetId}`,
    sourceFingerprint: combinedFingerprint,
    adapterId: input.adapterId ?? 'kun.local.audio-feature-correlation',
    adapterVersion: input.adapterVersion ?? '1.0.0',
    algorithm: 'seeded-normalized-cross-correlation',
    algorithmVersion: '1.0.0',
    parameters: [samplePeriodUs, maximumOffsetUs, seed, threshold, minimumSeparation],
    now: input.now
  })
  return deepFreeze({
    schemaVersion: 1,
    id: audioSyncAnalysisId({
      referenceAssetId: input.referenceAssetId,
      targetAssetId: input.targetAssetId,
      referenceFingerprint: input.referenceFingerprint,
      targetFingerprint: input.targetFingerprint,
      samplePeriodUs,
      maximumOffsetUs,
      seed,
      threshold,
      minimumSeparation,
      adapterId: input.adapterId,
      adapterVersion: input.adapterVersion
    }),
    kind: 'audio-sync',
    referenceAssetId: input.referenceAssetId,
    targetAssetId: input.targetAssetId,
    seed,
    samplePeriodUs,
    candidateCount: ranked.length,
    proposedTargetDeltaUs: -best.lag * samplePeriodUs,
    bestCorrelation,
    runnerUpCorrelation,
    confidence: syncConfidence,
    separation,
    threshold,
    minimumSeparation,
    outcome: refusalReason ? 'uncertain' : 'ready',
    ...(refusalReason ? { refusalReason } : {}),
    provenance: analysisProvenance,
    immutable: true
  })
}

export function audioSyncAnalysisId(input: {
  referenceAssetId: string
  targetAssetId: string
  referenceFingerprint: SourceIdentity
  targetFingerprint: SourceIdentity
  samplePeriodUs: number
  maximumOffsetUs: number
  seed: number
  threshold?: number
  minimumSeparation?: number
  adapterId?: string
  adapterVersion?: string
}): string {
  identifier(input.referenceAssetId, 'referenceAssetId')
  identifier(input.targetAssetId, 'targetAssetId')
  const combinedFingerprint = combineAudioSourceFingerprints(
    input.referenceFingerprint,
    input.targetFingerprint
  )
  const adapterId = input.adapterId ?? 'kun.local.audio-feature-correlation'
  const adapterVersion = input.adapterVersion ?? '1.0.0'
  identifier(adapterId, 'adapterId')
  boundedString(adapterVersion, 'adapterVersion', 1, 64)
  const samplePeriodUs = boundedInteger(input.samplePeriodUs, 1, 10_000_000, 'samplePeriodUs')
  const maximumOffsetUs = boundedInteger(input.maximumOffsetUs, 0, 3_600_000_000, 'maximumOffsetUs')
  const seed = boundedInteger(input.seed, 0, 0x7fffffff, 'seed')
  const threshold = confidence(input.threshold ?? 0.82, 'sync threshold')
  const minimumSeparation = confidence(input.minimumSeparation ?? 0.03, 'sync minimum separation')
  return `analysis:sync:${stableKey([
    `${input.referenceAssetId}:${input.targetAssetId}`,
    combinedFingerprint.value,
    adapterId,
    adapterVersion,
    '',
    'seeded-normalized-cross-correlation',
    '1.0.0',
    samplePeriodUs,
    maximumOffsetUs,
    seed,
    threshold,
    minimumSeparation
  ])}`
}

export function combineAudioSourceFingerprints(
  reference: SourceIdentity,
  target: SourceIdentity
): SourceIdentity {
  assertFingerprint(reference)
  assertFingerprint(target)
  return {
    algorithm: 'sha256',
    value: stableDigest64([reference.value, target.value])
  }
}

export function previewAudioSynchronization(
  project: VideoProject,
  referenceItemId: string,
  targetItemId: string,
  analysis: AudioSyncAnalysis
): AudioSyncPreview {
  const reference = project.items.find(({ id }) => id === referenceItemId)
  const target = project.items.find(({ id }) => id === targetItemId)
  if (!reference || !target) throw engineError('invalid_operation', 'Audio synchronization items are unavailable')
  if (reference.assetId !== analysis.referenceAssetId || target.assetId !== analysis.targetAssetId) {
    throw engineError('invalid_operation', 'Audio synchronization evidence does not match the selected items')
  }
  const deltaFrames = Math.sign(analysis.proposedTargetDeltaUs) * microsecondsToFrames(
    Math.abs(analysis.proposedTargetDeltaUs),
    project.fps
  )
  const targetFrameAfter = target.timelineStartFrame + deltaFrames
  return {
    referenceItemId,
    targetItemId,
    targetFrameBefore: target.timelineStartFrame,
    targetFrameAfter,
    deltaFrames,
    confidence: analysis.confidence,
    outcome: targetFrameAfter < 0 ? 'uncertain' : analysis.outcome,
    ...(targetFrameAfter < 0
      ? { refusalReason: 'confidence-below-threshold' }
      : analysis.refusalReason ? { refusalReason: analysis.refusalReason } : {})
  }
}

export function planAudioSynchronization(
  project: VideoProject,
  referenceItemId: string,
  targetItemId: string,
  analysis: AudioSyncAnalysis
): AudioSyncPlan {
  const preview = previewAudioSynchronization(project, referenceItemId, targetItemId, analysis)
  return {
    schemaVersion: 1,
    projectId: project.id,
    expectedRevision: project.currentRevision,
    analysisId: analysis.id,
    ...preview,
    ...(preview.outcome === 'ready'
      ? {
          operation: {
            type: 'move-item',
            itemId: targetItemId,
            trackId: project.items.find(({ id }) => id === targetItemId)!.trackId,
            timelineStartFrame: preview.targetFrameAfter
          }
        }
      : {})
  }
}

export function applyAudioSynchronizationPlan(
  project: VideoProject,
  plan: AudioSyncPlan
): ReturnType<typeof applyTimelineOperations> {
  if (plan.projectId !== project.id || plan.expectedRevision !== project.currentRevision) {
    throw engineError('revision_conflict', 'Audio synchronization plan is stale; refresh evidence before applying')
  }
  if (plan.outcome !== 'ready' || !plan.operation) {
    throw engineError('invalid_operation', 'Audio synchronization is uncertain and cannot move clips automatically')
  }
  return applyTimelineOperations(project, [plan.operation])
}

function attributionForRange(
  value: Pick<TranscriptSegment, 'id' | 'startUs' | 'endUs'>,
  record: DiarizationRecord
): SpeakerAttribution | undefined {
  const overlaps = record.turns.flatMap((turn) => {
    const overlap = Math.max(0, Math.min(value.endUs, turn.endUs) - Math.max(value.startUs, turn.startUs))
    return overlap > 0 ? [{ turn, overlap }] : []
  }).sort((left, right) => right.overlap - left.overlap || right.turn.confidence - left.turn.confidence)
  const best = overlaps[0]
  if (!best) return undefined
  const duration = value.endUs - value.startUs
  const confidenceValue = Number((best.turn.confidence * best.overlap / duration).toFixed(6))
  const materiallyOverlapping = overlaps.filter(({ overlap }) => overlap / duration >= 0.05)
  const identifiedSpeakerIds = new Set(materiallyOverlapping.flatMap(({ turn }) =>
    !turn.uncertain && turn.speakerId ? [turn.speakerId] : []
  ))
  const explicitOverlap = materiallyOverlapping.some(({ turn }) =>
    turn.status === 'overlap' || turn.reason === 'overlap' || (turn.overlapSpeakerIds?.length ?? 0) > 1
  )
  const containsUnknown = materiallyOverlapping.some(({ turn }) =>
    turn.status === 'unknown' || turn.reason === 'unknown-speaker'
  )
  const containsUncertain = materiallyOverlapping.some(({ turn }) => turn.uncertain)
  const bestHasIdentity = best.turn.speakerId !== undefined && best.turn.speakerLabel !== undefined
  const status: SpeakerAttributionEvidence['status'] = explicitOverlap || identifiedSpeakerIds.size > 1
    ? 'overlap'
    : containsUnknown
      ? 'unknown'
      : containsUncertain || confidenceValue < 0.5 || !bestHasIdentity
        ? 'uncertain'
        : 'identified'
  return {
    analysisId: record.id,
    ...(status === 'identified' && best.turn.speakerId
      ? { speakerId: best.turn.speakerId, speakerLabel: best.turn.speakerLabel }
      : {}),
    confidence: confidenceValue,
    uncertain: status !== 'identified',
    status,
    sourceTurnIds: overlaps.map(({ turn }) => turn.id).slice(0, 32)
  }
}

function mergeAttributions(
  values: readonly SpeakerAttribution[],
  analysisId: string
): SpeakerAttribution | undefined {
  if (values.length === 0) return undefined
  const confident = values.filter(({ uncertain, speakerId }) => !uncertain && speakerId)
  const speakerIds = new Set(confident.map(({ speakerId }) => speakerId))
  const best = [...values].sort((left, right) => right.confidence - left.confidence)[0]!
  const explicitOverlap = values.some(({ status }) => status === 'overlap')
  const containsUnknown = values.some(({ status }) => status === 'unknown')
  const uncertain = speakerIds.size !== 1 || values.some((value) => value.uncertain)
  const status: SpeakerAttributionEvidence['status'] = explicitOverlap || speakerIds.size > 1
    ? 'overlap'
    : containsUnknown
      ? 'unknown'
      : uncertain
        ? 'uncertain'
        : 'identified'
  return {
    analysisId,
    ...(status === 'identified' && best.speakerId ? { speakerId: best.speakerId, speakerLabel: best.speakerLabel } : {}),
    confidence: best.confidence,
    uncertain: status !== 'identified',
    status,
    sourceTurnIds: [...new Set(values.flatMap(({ sourceTurnIds }) => sourceTurnIds))].slice(0, 32)
  }
}

function provenance(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  adapterId: string
  adapterVersion: string
  modelId?: string
  algorithm: string
  algorithmVersion: string
  parameters: readonly (string | number)[]
  now?: () => Date
}): LocalAnalysisProvenance {
  assertFingerprint(input.sourceFingerprint)
  const cacheKey = stableKey([
    input.assetId,
    input.sourceFingerprint.value,
    input.adapterId,
    input.adapterVersion,
    input.modelId ?? '',
    input.algorithm,
    input.algorithmVersion,
    ...input.parameters
  ])
  return {
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    algorithm: input.algorithm,
    algorithmVersion: input.algorithmVersion,
    sourceFingerprint: { ...input.sourceFingerprint },
    local: true,
    networkUsed: false,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    cacheKey,
    execution: 'local'
  }
}

function validateTimedEvidence(
  values: readonly { id: string; startUs: number; endUs: number }[],
  name: string
): void {
  if (values.length > 100_000) throw engineError('invalid_operation', `${name} evidence exceeds the bounded limit`)
  const ids = new Set<string>()
  let previousStart = -1
  for (const value of values) {
    identifier(value.id, `${name} ID`)
    if (ids.has(value.id)) throw engineError('invalid_operation', `${name} IDs must be unique`)
    ids.add(value.id)
    boundedInteger(value.startUs, 0, Number.MAX_SAFE_INTEGER, `${name} start`)
    boundedInteger(value.endUs, 1, Number.MAX_SAFE_INTEGER, `${name} end`)
    if (value.endUs <= value.startUs || value.startUs < previousStart) {
      throw engineError('invalid_operation', `${name} ranges must be non-empty and ordered`)
    }
    previousStart = value.startUs
  }
}

function validateSpeakerDescriptor(value: SpeakerModelDescriptor): void {
  identifier(value.adapterId, 'speaker adapter ID')
  identifier(value.modelId, 'speaker model ID')
  boundedString(value.adapterVersion, 'speaker adapter version', 1, 64)
  boundedString(value.modelVersion, 'speaker model version', 1, 64)
  boundedInteger(value.embeddingDimensions, 1, 65_536, 'speaker embedding dimensions')
}

function validateSpeakerDiarizationAdapterStatus(value: SpeakerDiarizationAdapterStatus): void {
  identifier(value.descriptor.id, 'speaker adapter ID')
  boundedString(value.descriptor.version, 'speaker adapter version', 1, 64)
  if (value.descriptor.execution === 'import') {
    if (value.descriptor.format !== 'kun-speaker-json-v1') {
      throw engineError('invalid_operation', 'Imported speaker adapter requires the bounded Kun speaker JSON format')
    }
    if (value.descriptor.modelId !== undefined || value.descriptor.modelVersion !== undefined) {
      throw engineError('invalid_operation', 'Imported speaker adapter cannot claim a model')
    }
  } else {
    if (!value.descriptor.modelId || !value.descriptor.modelVersion) {
      throw engineError('invalid_operation', 'Local speaker adapter requires model identity and version')
    }
    identifier(value.descriptor.modelId, 'speaker model ID')
    boundedString(value.descriptor.modelVersion, 'speaker model version', 1, 64)
  }
  if (value.outcome === 'unavailable' && !value.remediation.trim()) {
    throw engineError('invalid_operation', 'Unavailable speaker adapter requires remediation')
  }
}

function persistedSpeakerAttribution(value: SpeakerAttribution): SpeakerAttributionEvidence {
  return {
    analysisId: value.analysisId,
    ...(value.status === 'identified' && value.speakerId && value.speakerLabel
      ? { speakerId: value.speakerId, speakerLabel: value.speakerLabel }
      : {}),
    confidence: value.confidence,
    status: value.status,
    sourceTurnIds: [...value.sourceTurnIds]
  }
}

function boundedSpeakerLabel(value: string, name: string): string {
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length < 1 || normalized.length > 128 || containsAsciiControlCharacters(normalized)) {
    throw engineError('invalid_operation', `${name} is invalid`)
  }
  return normalized
}

function validIsoTimestamp(value: string, name: string): string {
  if (!Number.isFinite(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw engineError('invalid_operation', `${name} must be an ISO timestamp`)
  }
  return value
}

function speakerUnavailable(
  code: Extract<SpeakerAdapterCapability, { outcome: 'unavailable' }>['code'],
  retryable: boolean,
  remediation: string
): Extract<SpeakerAdapterCapability, { outcome: 'unavailable' }> {
  return { outcome: 'unavailable', code, retryable, remediation, networkUsedForInference: false }
}

function validateFeatureSeries(values: readonly number[], name: string): void {
  if (values.length < 8 || values.length > 1_000_000) {
    throw engineError('invalid_operation', `${name} requires 8 through 1000000 local feature samples`)
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw engineError('invalid_operation', `${name} must contain finite numbers`)
  }
}

function seededCandidates(maxLag: number, seed: number): number[] {
  const candidates = Array.from({ length: maxLag * 2 + 1 }, (_, index) => index - maxLag)
  let state = seed || 0x6d2b79f5
  const random = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state)
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[candidates[index], candidates[swap]] = [candidates[swap]!, candidates[index]!]
  }
  return candidates
}

function correlationAtLag(
  reference: readonly number[],
  target: readonly number[],
  lag: number
): number | undefined {
  const referenceStart = Math.max(0, -lag)
  const targetStart = Math.max(0, lag)
  const length = Math.min(reference.length - referenceStart, target.length - targetStart)
  if (length < 8) return undefined
  let dotValue = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < length; index += 1) {
    const left = reference[referenceStart + index]!
    const right = target[targetStart + index]!
    dotValue += left * right
    leftMagnitude += left * left
    rightMagnitude += right * right
  }
  if (leftMagnitude <= Number.EPSILON || rightMagnitude <= Number.EPSILON) return undefined
  return dotValue / Math.sqrt(leftMagnitude * rightMagnitude)
}

function normalizedVector(values: readonly number[], name: string): number[] {
  if (values.length < 1 || values.length > 65_536) throw engineError('invalid_operation', `${name} has invalid dimensions`)
  let magnitudeSquared = 0
  for (const value of values) {
    if (!Number.isFinite(value)) throw engineError('invalid_operation', `${name} must contain finite numbers`)
    magnitudeSquared += value * value
  }
  if (magnitudeSquared <= Number.EPSILON) throw engineError('invalid_operation', `${name} cannot be a zero vector`)
  const magnitude = Math.sqrt(magnitudeSquared)
  return values.map((value) => value / magnitude)
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * right[index]!, 0)
}

function stableKey(values: readonly (string | number)[]): string {
  let hash = 0x811c9dc5
  for (const character of values.join('\u0000')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function stableDigest64(values: readonly string[]): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5]
  return seeds.map((seed) => {
    let hash = seed >>> 0
    for (const character of values.join('\u0000')) {
      hash ^= character.codePointAt(0) ?? 0
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function assertFingerprint(value: SourceIdentity): void {
  if (value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/u.test(value.value)) {
    throw engineError('invalid_operation', 'Analysis source fingerprint must be a lowercase SHA-256 digest')
  }
}

function identifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) throw engineError('invalid_operation', `${name} is invalid`)
}

function boundedString(value: string, name: string, minimum: number, maximum: number): void {
  if (value.length < minimum || value.length > maximum) throw engineError('invalid_operation', `${name} is out of bounds`)
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function confidence(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw engineError('invalid_operation', `${name} must be from 0 through 1`)
  return value
}
