import { describe, expect, it } from 'vitest'
import {
  createDenoiseMetadataRecord,
  isValidDenoiseMetadataRecord,
  readMediaIntelligenceEvidence,
  type DenoiseMetadataAdapterDescriptor,
  type DenoiseNoiseProfileEvidence
} from '../src/engine/index.js'

const fingerprint = { algorithm: 'sha256' as const, value: 'd'.repeat(64) }
const descriptor: DenoiseMetadataAdapterDescriptor = {
  adapterId: 'kun.fixture.local-noise-profile',
  adapterVersion: '2.1.0',
  algorithm: 'bounded-noise-profile',
  algorithmVersion: '1.3.0',
  modelId: 'noise-profile-small',
  modelVersion: '2026.07'
}
const evidence: DenoiseNoiseProfileEvidence = {
  analyzedDurationUs: 4_000_000,
  sampleWindowCount: 400,
  noiseFloorDbfs: -54.25,
  averageRmsDbfs: -25.5,
  peakDbfs: -3.25,
  spectralBands: [
    { id: 'low', lowerFrequencyHz: 0, upperFrequencyHz: 250, noiseLevelDbfs: -50.5, confidence: 0.92 },
    { id: 'speech', lowerFrequencyHz: 250, upperFrequencyHz: 4_000, noiseLevelDbfs: -57, confidence: 0.88 }
  ],
  confidence: 0.86,
  recommendedReductionDb: 8.5,
  completeness: 'complete'
}

describe('bounded local denoise metadata', () => {
  it('serializes immutable provider-neutral evidence without mutating audio', () => {
    const record = createDenoiseMetadataRecord({
      assetId: 'asset-audio',
      sourceFingerprint: fingerprint,
      descriptor,
      evidence,
      confidenceThreshold: 0.7,
      now: () => new Date('2026-07-14T00:00:00.000Z')
    })
    expect(record).toMatchObject({
      kind: 'denoise-metadata',
      assetId: 'asset-audio',
      status: 'ready',
      confidence: 0.86,
      metadataOnly: true,
      immutable: true,
      provenance: {
        adapterId: descriptor.adapterId,
        adapterVersion: descriptor.adapterVersion,
        algorithm: descriptor.algorithm,
        algorithmVersion: descriptor.algorithmVersion,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        sourceFingerprint: fingerprint,
        local: true,
        networkUsed: false
      },
      noiseProfile: {
        levels: {
          noiseFloorDbfs: -54.25,
          averageRmsDbfs: -25.5,
          peakDbfs: -3.25,
          estimatedSnrDb: 28.75
        }
      },
      recommendation: {
        reductionDb: 8.5,
        disposition: 'preview-suggested',
        autoApplyAllowed: false,
        audioMutation: 'none'
      }
    })
    expect(record.id).toMatch(/^analysis:denoise:[a-f0-9]{64}$/u)
    expect(Object.isFrozen(record)).toBe(true)

    const restored: unknown = JSON.parse(JSON.stringify(record))
    expect(isValidDenoiseMetadataRecord(restored)).toBe(true)
    if (!isValidDenoiseMetadataRecord(restored)) throw new Error('expected valid restored record')
    expect(readMediaIntelligenceEvidence(restored, { offset: 0, limit: 2 })).toMatchObject({
      kind: 'denoise-metadata',
      sourceFingerprints: [fingerprint.value],
      adapter: {
        id: descriptor.adapterId,
        version: descriptor.adapterVersion,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        algorithm: descriptor.algorithm,
        algorithmVersion: descriptor.algorithmVersion
      },
      returned: 2,
      total: 3,
      nextOffset: 2,
      evidence: [
        expect.objectContaining({
          evidenceKind: 'noise-profile',
          recommendedReductionDb: 8.5,
          metadataOnly: true,
          audioMutation: 'none'
        }),
        expect.objectContaining({ evidenceKind: 'spectral-band', bandId: 'low' })
      ]
    })
  })

  it('marks low-confidence recommendations for review instead of making them safe to apply', () => {
    const record = createDenoiseMetadataRecord({
      assetId: 'asset-audio',
      sourceFingerprint: fingerprint,
      descriptor,
      evidence: { ...evidence, confidence: 0.42, completeness: 'partial' },
      confidenceThreshold: 0.7
    })
    expect(record).toMatchObject({
      status: 'low-confidence',
      completeness: 'partial',
      recommendation: {
        reductionDb: 8.5,
        disposition: 'review-required',
        autoApplyAllowed: false,
        audioMutation: 'none'
      }
    })
  })

  it('rejects unbounded, inconsistent, or unverifiable evidence', () => {
    expect(() => createDenoiseMetadataRecord({
      assetId: 'asset-audio', sourceFingerprint: fingerprint, descriptor,
      evidence: { ...evidence, recommendedReductionDb: 36.1 }
    })).toThrowError(/recommendedReductionDb/u)
    expect(() => createDenoiseMetadataRecord({
      assetId: 'asset-audio', sourceFingerprint: fingerprint, descriptor,
      evidence: { ...evidence, noiseFloorDbfs: -10, averageRmsDbfs: -20 }
    })).toThrowError(/noise floor <= average RMS <= peak/u)
    expect(() => createDenoiseMetadataRecord({
      assetId: 'asset-audio', sourceFingerprint: fingerprint,
      descriptor: { ...descriptor, modelVersion: undefined }, evidence
    })).toThrowError(/identity and version/u)
    expect(() => createDenoiseMetadataRecord({
      assetId: 'asset-audio',
      sourceFingerprint: { algorithm: 'sha256', value: 'not-a-digest' },
      descriptor,
      evidence
    })).toThrowError(/fingerprint/u)

    const valid = createDenoiseMetadataRecord({
      assetId: 'asset-audio', sourceFingerprint: fingerprint, descriptor, evidence
    })
    const corrupted = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>
    corrupted.metadataOnly = false
    expect(isValidDenoiseMetadataRecord(corrupted)).toBe(false)
  })
})
