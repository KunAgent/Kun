import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import type { LocalAnalysisProvenance } from './audio-analysis.js'
import type { SourceIdentity } from './schema.js'
import { containsAsciiControlCharacters } from '../text-safety.js'

const MAX_ANALYZED_DURATION_US = 7 * 24 * 60 * 60 * 1_000_000
const MAX_SAMPLE_WINDOWS = 1_000_000
const MAX_SPECTRAL_BANDS = 32
const MAX_FREQUENCY_HZ = 192_000
const MIN_LEVEL_DBFS = -160
const MAX_LEVEL_DBFS = 0
const MAX_REDUCTION_DB = 36

export type DenoiseMetadataAdapterDescriptor = {
  adapterId: string
  adapterVersion: string
  algorithm: string
  algorithmVersion: string
  modelId?: string
  modelVersion?: string
}

export type DenoiseMetadataCapability =
  | {
      outcome: 'ready'
      descriptor: DenoiseMetadataAdapterDescriptor
      local: true
      networkUsed: false
    }
  | {
      outcome: 'unavailable'
      code:
        | 'denoise_metadata_broker_unavailable'
        | 'denoise_metadata_algorithm_unavailable'
        | 'denoise_metadata_model_unverified'
      remediation: string
      retryable: boolean
      local: true
      networkUsed: false
    }

export type DenoiseSpectralBandEvidence = {
  id: string
  lowerFrequencyHz: number
  upperFrequencyHz: number
  noiseLevelDbfs: number
  confidence: number
}

/**
 * Provider-neutral, already measured local evidence. The engine validates and
 * records these values; it never treats metadata construction as audio DSP.
 */
export type DenoiseNoiseProfileEvidence = {
  analyzedDurationUs: number
  sampleWindowCount: number
  noiseFloorDbfs: number
  averageRmsDbfs: number
  peakDbfs: number
  spectralBands: readonly DenoiseSpectralBandEvidence[]
  confidence: number
  recommendedReductionDb: number
  completeness: 'complete' | 'partial'
}

export type DenoiseMetadataRecord = {
  schemaVersion: 1
  id: string
  kind: 'denoise-metadata'
  assetId: string
  provenance: LocalAnalysisProvenance
  noiseProfile: {
    analyzedDurationUs: number
    sampleWindowCount: number
    levels: {
      noiseFloorDbfs: number
      averageRmsDbfs: number
      peakDbfs: number
      estimatedSnrDb: number
    }
    spectralBands: DenoiseSpectralBandEvidence[]
  }
  confidence: number
  confidenceThreshold: number
  status: 'ready' | 'low-confidence'
  recommendation: {
    reductionDb: number
    confidence: number
    disposition: 'preview-suggested' | 'review-required'
    autoApplyAllowed: false
    audioMutation: 'none'
  }
  completeness: 'complete' | 'partial'
  metadataOnly: true
  immutable: true
}

export function createDenoiseMetadataRecord(input: {
  assetId: string
  sourceFingerprint: SourceIdentity
  descriptor: DenoiseMetadataAdapterDescriptor
  evidence: DenoiseNoiseProfileEvidence
  confidenceThreshold?: number
  now?: () => Date
}): DenoiseMetadataRecord {
  validateIdentifier(input.assetId, 'assetId')
  validateSourceFingerprint(input.sourceFingerprint)
  validateDescriptor(input.descriptor)
  const confidenceThreshold = boundedConfidence(
    input.confidenceThreshold ?? 0.7,
    'denoise confidence threshold'
  )
  const evidence = normalizeEvidence(input.evidence)
  const cacheKey = createHash('sha256').update(JSON.stringify({
    assetId: input.assetId,
    sourceFingerprint: input.sourceFingerprint,
    descriptor: input.descriptor,
    evidence,
    confidenceThreshold
  })).digest('hex')
  const status = evidence.confidence >= confidenceThreshold ? 'ready' : 'low-confidence'
  const provenance: LocalAnalysisProvenance = {
    adapterId: input.descriptor.adapterId,
    adapterVersion: input.descriptor.adapterVersion,
    ...(input.descriptor.modelId === undefined ? {} : {
      modelId: input.descriptor.modelId,
      modelVersion: input.descriptor.modelVersion
    }),
    algorithm: input.descriptor.algorithm,
    algorithmVersion: input.descriptor.algorithmVersion,
    sourceFingerprint: structuredClone(input.sourceFingerprint),
    local: true,
    networkUsed: false,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    cacheKey,
    execution: 'local'
  }
  return deepFreeze({
    schemaVersion: 1,
    id: `analysis:denoise:${cacheKey}`,
    kind: 'denoise-metadata',
    assetId: input.assetId,
    provenance,
    noiseProfile: {
      analyzedDurationUs: evidence.analyzedDurationUs,
      sampleWindowCount: evidence.sampleWindowCount,
      levels: {
        noiseFloorDbfs: evidence.noiseFloorDbfs,
        averageRmsDbfs: evidence.averageRmsDbfs,
        peakDbfs: evidence.peakDbfs,
        estimatedSnrDb: rounded(evidence.averageRmsDbfs - evidence.noiseFloorDbfs)
      },
      spectralBands: evidence.spectralBands.map((band) => ({ ...band }))
    },
    confidence: evidence.confidence,
    confidenceThreshold,
    status,
    recommendation: {
      reductionDb: evidence.recommendedReductionDb,
      confidence: evidence.confidence,
      disposition: status === 'ready' ? 'preview-suggested' : 'review-required',
      autoApplyAllowed: false,
      audioMutation: 'none'
    },
    completeness: evidence.completeness,
    metadataOnly: true,
    immutable: true
  })
}

export function isValidDenoiseMetadataAdapterDescriptor(
  value: unknown
): value is DenoiseMetadataAdapterDescriptor {
  try {
    const descriptor = objectValue(value, 'denoise adapter descriptor')
    validateDescriptor({
      adapterId: stringValue(descriptor.adapterId, 'adapterId'),
      adapterVersion: stringValue(descriptor.adapterVersion, 'adapterVersion'),
      algorithm: stringValue(descriptor.algorithm, 'algorithm'),
      algorithmVersion: stringValue(descriptor.algorithmVersion, 'algorithmVersion'),
      ...(descriptor.modelId === undefined ? {} : {
        modelId: stringValue(descriptor.modelId, 'modelId'),
        modelVersion: stringValue(descriptor.modelVersion, 'modelVersion')
      })
    })
    return true
  } catch {
    return false
  }
}

/** Validates JSON-restored records before the Host lists or pages evidence. */
export function isValidDenoiseMetadataRecord(value: unknown): value is DenoiseMetadataRecord {
  try {
    const record = objectValue(value, 'denoise record')
    if (
      record.schemaVersion !== 1 || record.kind !== 'denoise-metadata' ||
      record.metadataOnly !== true || record.immutable !== true
    ) return false
    const id = stringValue(record.id, 'denoise record ID')
    const assetId = stringValue(record.assetId, 'denoise asset ID')
    validateIdentifier(assetId, 'assetId')
    const provenance = objectValue(record.provenance, 'denoise provenance')
    validateDescriptor({
      adapterId: stringValue(provenance.adapterId, 'adapterId'),
      adapterVersion: stringValue(provenance.adapterVersion, 'adapterVersion'),
      algorithm: stringValue(provenance.algorithm, 'algorithm'),
      algorithmVersion: stringValue(provenance.algorithmVersion, 'algorithmVersion'),
      ...(provenance.modelId === undefined ? {} : {
        modelId: stringValue(provenance.modelId, 'modelId'),
        modelVersion: stringValue(provenance.modelVersion, 'modelVersion')
      })
    })
    if (provenance.local !== true || provenance.networkUsed !== false || provenance.execution !== 'local') return false
    validateSourceFingerprint(objectValue(provenance.sourceFingerprint, 'source fingerprint') as SourceIdentity)
    const cacheKey = stringValue(provenance.cacheKey, 'cacheKey')
    if (!/^[a-f0-9]{64}$/u.test(cacheKey) || id !== `analysis:denoise:${cacheKey}`) return false
    if (!Number.isFinite(Date.parse(stringValue(provenance.createdAt, 'createdAt')))) return false
    const profile = objectValue(record.noiseProfile, 'noise profile')
    const levels = objectValue(profile.levels, 'noise levels')
    const spectralBands = arrayValue(profile.spectralBands, 'spectral bands')
    const evidence = normalizeEvidence({
      analyzedDurationUs: numberValue(profile.analyzedDurationUs, 'analyzedDurationUs'),
      sampleWindowCount: numberValue(profile.sampleWindowCount, 'sampleWindowCount'),
      noiseFloorDbfs: numberValue(levels.noiseFloorDbfs, 'noiseFloorDbfs'),
      averageRmsDbfs: numberValue(levels.averageRmsDbfs, 'averageRmsDbfs'),
      peakDbfs: numberValue(levels.peakDbfs, 'peakDbfs'),
      spectralBands: spectralBands.map((band) => {
        const candidate = objectValue(band, 'spectral band')
        return {
          id: stringValue(candidate.id, 'spectral band ID'),
          lowerFrequencyHz: numberValue(candidate.lowerFrequencyHz, 'lowerFrequencyHz'),
          upperFrequencyHz: numberValue(candidate.upperFrequencyHz, 'upperFrequencyHz'),
          noiseLevelDbfs: numberValue(candidate.noiseLevelDbfs, 'noiseLevelDbfs'),
          confidence: numberValue(candidate.confidence, 'band confidence')
        }
      }),
      confidence: numberValue(record.confidence, 'confidence'),
      recommendedReductionDb: numberValue(
        objectValue(record.recommendation, 'recommendation').reductionDb,
        'recommendedReductionDb'
      ),
      completeness: record.completeness === 'partial' ? 'partial' : 'complete'
    })
    if (record.completeness !== 'complete' && record.completeness !== 'partial') return false
    if (numberValue(levels.estimatedSnrDb, 'estimatedSnrDb') !== rounded(evidence.averageRmsDbfs - evidence.noiseFloorDbfs)) return false
    const confidenceThreshold = boundedConfidence(
      numberValue(record.confidenceThreshold, 'confidenceThreshold'),
      'confidenceThreshold'
    )
    const status = evidence.confidence >= confidenceThreshold ? 'ready' : 'low-confidence'
    if (record.status !== status) return false
    const recommendation = objectValue(record.recommendation, 'recommendation')
    return recommendation.confidence === evidence.confidence &&
      recommendation.disposition === (status === 'ready' ? 'preview-suggested' : 'review-required') &&
      recommendation.autoApplyAllowed === false &&
      recommendation.audioMutation === 'none'
  } catch {
    return false
  }
}

function normalizeEvidence(value: DenoiseNoiseProfileEvidence): DenoiseNoiseProfileEvidence & {
  spectralBands: DenoiseSpectralBandEvidence[]
} {
  const analyzedDurationUs = boundedInteger(
    value.analyzedDurationUs,
    1,
    MAX_ANALYZED_DURATION_US,
    'analyzedDurationUs'
  )
  const sampleWindowCount = boundedInteger(value.sampleWindowCount, 1, MAX_SAMPLE_WINDOWS, 'sampleWindowCount')
  const noiseFloorDbfs = boundedLevel(value.noiseFloorDbfs, 'noiseFloorDbfs')
  const averageRmsDbfs = boundedLevel(value.averageRmsDbfs, 'averageRmsDbfs')
  const peakDbfs = boundedLevel(value.peakDbfs, 'peakDbfs')
  if (noiseFloorDbfs > averageRmsDbfs || averageRmsDbfs > peakDbfs) {
    throw engineError('invalid_operation', 'Denoise levels must satisfy noise floor <= average RMS <= peak')
  }
  if (!Array.isArray(value.spectralBands) || value.spectralBands.length > MAX_SPECTRAL_BANDS) {
    throw engineError('invalid_operation', `Denoise spectral profile supports at most ${MAX_SPECTRAL_BANDS} bands`)
  }
  const ids = new Set<string>()
  let previousUpperHz = 0
  const spectralBands = value.spectralBands.map((band) => {
    validateIdentifier(band.id, 'spectral band ID')
    if (ids.has(band.id)) throw engineError('invalid_operation', 'Denoise spectral band IDs must be unique')
    ids.add(band.id)
    const lowerFrequencyHz = boundedInteger(band.lowerFrequencyHz, 0, MAX_FREQUENCY_HZ - 1, 'lowerFrequencyHz')
    const upperFrequencyHz = boundedInteger(band.upperFrequencyHz, 1, MAX_FREQUENCY_HZ, 'upperFrequencyHz')
    if (upperFrequencyHz <= lowerFrequencyHz || lowerFrequencyHz < previousUpperHz) {
      throw engineError('invalid_operation', 'Denoise spectral bands must be ordered, non-empty, and non-overlapping')
    }
    previousUpperHz = upperFrequencyHz
    return {
      id: band.id,
      lowerFrequencyHz,
      upperFrequencyHz,
      noiseLevelDbfs: boundedLevel(band.noiseLevelDbfs, `noiseLevelDbfs for ${band.id}`),
      confidence: rounded(boundedConfidence(band.confidence, `confidence for ${band.id}`))
    }
  })
  const confidence = rounded(boundedConfidence(value.confidence, 'denoise confidence'))
  const recommendedReductionDb = rounded(boundedNumber(
    value.recommendedReductionDb,
    0,
    MAX_REDUCTION_DB,
    'recommendedReductionDb'
  ))
  if (value.completeness !== 'complete' && value.completeness !== 'partial') {
    throw engineError('invalid_operation', 'Denoise completeness must be complete or partial')
  }
  return {
    analyzedDurationUs,
    sampleWindowCount,
    noiseFloorDbfs: rounded(noiseFloorDbfs),
    averageRmsDbfs: rounded(averageRmsDbfs),
    peakDbfs: rounded(peakDbfs),
    spectralBands,
    confidence,
    recommendedReductionDb,
    completeness: value.completeness
  }
}

function validateDescriptor(value: DenoiseMetadataAdapterDescriptor): void {
  validateIdentifier(value.adapterId, 'denoise adapter ID')
  boundedString(value.adapterVersion, 1, 64, 'denoise adapter version')
  validateIdentifier(value.algorithm, 'denoise algorithm')
  boundedString(value.algorithmVersion, 1, 64, 'denoise algorithm version')
  if ((value.modelId === undefined) !== (value.modelVersion === undefined)) {
    throw engineError('invalid_operation', 'Denoise model identity and version must be supplied together')
  }
  if (value.modelId !== undefined) {
    validateIdentifier(value.modelId, 'denoise model ID')
    boundedString(value.modelVersion!, 1, 64, 'denoise model version')
  }
}

function validateSourceFingerprint(value: SourceIdentity): void {
  if (value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/u.test(value.value)) {
    throw engineError('invalid_operation', 'Denoise source fingerprint must be a lowercase SHA-256 digest')
  }
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw engineError('invalid_operation', `${name} is invalid`)
  }
}

function boundedString(value: string, minimum: number, maximum: number, name: string): string {
  if (value.length < minimum || value.length > maximum || containsAsciiControlCharacters(value)) {
    throw engineError('invalid_operation', `${name} is out of bounds`)
  }
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function boundedLevel(value: number, name: string): number {
  return boundedNumber(value, MIN_LEVEL_DBFS, MAX_LEVEL_DBFS, name)
}

function boundedConfidence(value: number, name: string): number {
  return boundedNumber(value, 0, 1, name)
}

function boundedNumber(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be from ${minimum} through ${maximum}`)
  }
  return value
}

function rounded(value: number): number {
  return Number(value.toFixed(6))
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw engineError('invalid_operation', `${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw engineError('invalid_operation', `${name} must be an array`)
  return value
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') throw engineError('invalid_operation', `${name} must be a string`)
  return value
}

function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number') throw engineError('invalid_operation', `${name} must be a number`)
  return value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
