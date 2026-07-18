import { engineError } from './errors.js'
import type {
  AudioSyncAnalysis,
  BeatAnalysisRecord,
  DiarizationRecord,
  VadAnalysisRecord
} from './audio-analysis.js'
import type { DenoiseMetadataRecord } from './denoise-metadata.js'
import type { VisualIndexRecord } from './visual-analysis.js'

export type MediaIntelligenceEvidenceRecord =
  | VisualIndexRecord
  | VadAnalysisRecord
  | DiarizationRecord
  | BeatAnalysisRecord
  | DenoiseMetadataRecord
  | AudioSyncAnalysis

export type MediaIntelligenceEvidenceWindow = {
  schemaVersion: 1
  recordId: string
  kind: 'visual-index' | 'vad' | 'speaker-diarization' | 'beat-grid' | 'denoise-metadata' | 'audio-sync'
  assetIds: string[]
  sourceFingerprints: string[]
  adapter: {
    id: string
    version: string
    modelId?: string
    modelVersion?: string
    algorithm?: string
    algorithmVersion?: string
  }
  local: true
  networkUsed: false
  completeness: 'complete' | 'partial' | 'not-applicable'
  offset: number
  returned: number
  total: number
  nextOffset?: number
  evidence: Array<Record<string, string | number | boolean | string[]>>
}

/** Compact projection intended for bounded Agent/resource reads. */
export function readMediaIntelligenceEvidence(
  record: MediaIntelligenceEvidenceRecord,
  request: { offset?: number; limit?: number } = {}
): MediaIntelligenceEvidenceWindow {
  const offset = boundedInteger(request.offset ?? 0, 0, 1_000_000, 'offset')
  const limit = boundedInteger(request.limit ?? 50, 1, 500, 'limit')
  const projection = projectEvidence(record)
  const evidence = projection.evidence.slice(offset, offset + limit)
  const nextOffset = offset + evidence.length
  return {
    schemaVersion: 1,
    recordId: record.id,
    kind: projection.kind,
    assetIds: projection.assetIds,
    sourceFingerprints: projection.sourceFingerprints,
    adapter: projection.adapter,
    local: true,
    networkUsed: false,
    completeness: projection.completeness,
    offset,
    returned: evidence.length,
    total: projection.evidence.length,
    ...(nextOffset < projection.evidence.length ? { nextOffset } : {}),
    evidence
  }
}

function projectEvidence(record: MediaIntelligenceEvidenceRecord): Omit<MediaIntelligenceEvidenceWindow, 'schemaVersion' | 'recordId' | 'offset' | 'returned' | 'total' | 'nextOffset' | 'local' | 'networkUsed'> {
  if (isVisual(record)) {
    return {
      kind: 'visual-index',
      assetIds: [record.assetId],
      sourceFingerprints: [record.sourceFingerprint.value],
      adapter: {
        id: record.adapter.id,
        version: record.adapter.version,
        modelId: `${record.adapter.modelId}@${record.adapter.modelVersion}`
      },
      completeness: record.completeness,
      evidence: record.samples.map((sample) => ({
        sampleId: sample.id,
        assetId: sample.assetId,
        startUs: sample.startUs,
        endUs: sample.endUs,
        representativeUs: sample.representativeUs,
        ...(sample.confidence === undefined ? {} : { confidence: sample.confidence })
      }))
    }
  }
  const provenance = record.provenance
  const adapter = {
    id: provenance.adapterId,
    version: provenance.adapterVersion,
    ...(provenance.modelId ? { modelId: provenance.modelId } : {}),
    ...(provenance.modelVersion ? { modelVersion: provenance.modelVersion } : {}),
    algorithm: provenance.algorithm,
    algorithmVersion: provenance.algorithmVersion
  }
  if (record.kind === 'vad') {
    return {
      kind: 'vad',
      assetIds: [record.assetId],
      sourceFingerprints: [provenance.sourceFingerprint.value],
      adapter,
      completeness: record.completeness,
      evidence: record.silence.map((silence) => ({
        suggestionId: silence.id,
        assetId: silence.assetId,
        startUs: silence.sourceRange.startUs,
        endUs: silence.sourceRange.endUs,
        confidence: silence.confidence,
        disposition: silence.disposition,
        reason: silence.reason
      }))
    }
  }
  if (record.kind === 'speaker-diarization') {
    return {
      kind: 'speaker-diarization',
      assetIds: [record.assetId],
      sourceFingerprints: [provenance.sourceFingerprint.value],
      adapter,
      completeness: record.completeness,
      evidence: record.turns.map((turn) => ({
        turnId: turn.id,
        assetId: record.assetId,
        startUs: turn.startUs,
        endUs: turn.endUs,
        confidence: turn.confidence,
        uncertain: turn.uncertain,
        ...(turn.speakerId ? { speakerId: turn.speakerId } : {}),
        ...(turn.speakerLabel ? { speakerLabel: turn.speakerLabel } : {}),
        ...(turn.reason ? { reason: turn.reason } : {})
      }))
    }
  }
  if (record.kind === 'beat-grid') {
    return {
      kind: 'beat-grid',
      assetIds: [record.assetId],
      sourceFingerprints: [provenance.sourceFingerprint.value],
      adapter,
      completeness: record.completeness,
      evidence: record.markers.map((marker) => ({
        markerId: marker.id,
        assetId: marker.assetId,
        sourceUs: marker.sourceUs,
        markerKind: marker.kind,
        confidence: marker.confidence,
        strength: marker.strength
      }))
    }
  }
  if (record.kind === 'denoise-metadata') {
    const levels = record.noiseProfile.levels
    return {
      kind: 'denoise-metadata',
      assetIds: [record.assetId],
      sourceFingerprints: [provenance.sourceFingerprint.value],
      adapter,
      completeness: record.completeness,
      evidence: [{
        evidenceKind: 'noise-profile',
        assetId: record.assetId,
        analyzedDurationUs: record.noiseProfile.analyzedDurationUs,
        sampleWindowCount: record.noiseProfile.sampleWindowCount,
        noiseFloorDbfs: levels.noiseFloorDbfs,
        averageRmsDbfs: levels.averageRmsDbfs,
        peakDbfs: levels.peakDbfs,
        estimatedSnrDb: levels.estimatedSnrDb,
        confidence: record.confidence,
        status: record.status,
        recommendedReductionDb: record.recommendation.reductionDb,
        disposition: record.recommendation.disposition,
        metadataOnly: true,
        audioMutation: 'none'
      }, ...record.noiseProfile.spectralBands.map((band) => ({
        evidenceKind: 'spectral-band',
        bandId: band.id,
        lowerFrequencyHz: band.lowerFrequencyHz,
        upperFrequencyHz: band.upperFrequencyHz,
        noiseLevelDbfs: band.noiseLevelDbfs,
        confidence: band.confidence
      }))]
    }
  }
  return {
    kind: 'audio-sync',
    assetIds: [record.referenceAssetId, record.targetAssetId],
    sourceFingerprints: [provenance.sourceFingerprint.value],
    adapter,
    completeness: 'not-applicable',
    evidence: [{
      analysisId: record.id,
      referenceAssetId: record.referenceAssetId,
      targetAssetId: record.targetAssetId,
      proposedTargetDeltaUs: record.proposedTargetDeltaUs,
      confidence: record.confidence,
      separation: record.separation,
      outcome: record.outcome,
      seed: record.seed,
      ...(record.refusalReason ? { refusalReason: record.refusalReason } : {})
    }]
  }
}

function isVisual(record: MediaIntelligenceEvidenceRecord): record is VisualIndexRecord {
  return record.id.startsWith('visual-index:')
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}
