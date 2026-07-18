import { describe, expect, it } from 'vitest'
import {
  SpeakerRegistry,
  analyzeAudioSynchronization,
  analyzeBeatEvidence,
  analyzeVadEvidence,
  applyAudioSynchronizationPlan,
  beatEvidenceWindow,
  beatSnapTargets,
  buildSpeakerAttributionPlan,
  diarizeSpeakerEvidence,
  negotiateSpeakerAdapter,
  planAudioSynchronization,
  readMediaIntelligenceEvidence
} from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

const fingerprint = { algorithm: 'sha256' as const, value: 'a'.repeat(64) }

describe('local attributable audio analysis', () => {
  it('creates cached VAD silence evidence and gates low-confidence edit suggestions', () => {
    const record = analyzeVadEvidence({
      assetId: 'asset-1',
      sourceFingerprint: fingerprint,
      frames: [
        { id: 'vad-1', startUs: 0, endUs: 200_000, speechProbability: 0.02 },
        { id: 'vad-2', startUs: 200_000, endUs: 500_000, speechProbability: 0.08 },
        { id: 'vad-3', startUs: 500_000, endUs: 800_000, speechProbability: 0.95 },
        { id: 'vad-4', startUs: 800_000, endUs: 1_100_000, speechProbability: 0.45 }
      ],
      minimumSilenceUs: 250_000,
      suggestionConfidenceThreshold: 0.8,
      now: () => new Date('2026-01-01T00:00:00.000Z')
    })
    expect(record.provenance).toMatchObject({ local: true, networkUsed: false, sourceFingerprint: fingerprint })
    expect(record.silence).toEqual([
      expect.objectContaining({
        sourceRange: { assetId: 'asset-1', startUs: 0, endUs: 500_000 },
        disposition: 'safe-to-suggest'
      }),
      expect.objectContaining({
        sourceRange: { assetId: 'asset-1', startUs: 800_000, endUs: 1_100_000 },
        disposition: 'review-required'
      })
    ])
    expect(Object.isFrozen(record)).toBe(true)
  })

  it('keeps speaker attribution uncertain when registry evidence is weak or ambiguous', () => {
    const descriptor = {
      adapterId: 'kun.local.speaker-fixture', adapterVersion: '1.0.0',
      modelId: 'speaker-fixture', modelVersion: '1.0.0', embeddingDimensions: 2
    }
    expect(negotiateSpeakerAdapter({
      optIn: true, descriptor, installationVerified: true, inferenceBrokerAvailable: false
    })).toMatchObject({ outcome: 'unavailable', code: 'speaker_inference_broker_unavailable' })
    const capability = negotiateSpeakerAdapter({
      optIn: true, descriptor, installationVerified: true, inferenceBrokerAvailable: true
    })
    if (capability.outcome !== 'ready') throw new Error('expected speaker fixture capability')
    const registry = new SpeakerRegistry([
      {
        id: 'speaker-alice', label: 'Alice', embedding: [1, 0],
        adapterId: descriptor.adapterId, modelId: descriptor.modelId,
        sourceEvidenceIds: ['enrollment-alice'], createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'speaker-bob', label: 'Bob', embedding: [0, 1],
        adapterId: descriptor.adapterId, modelId: descriptor.modelId,
        sourceEvidenceIds: ['enrollment-bob'], createdAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    const record = diarizeSpeakerEvidence({
      assetId: 'asset-1', sourceFingerprint: fingerprint, capability, registry,
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, embedding: [0.99, 0.01], adapterConfidence: 0.95 },
        { id: 'turn-uncertain', startUs: 1_000_000, endUs: 2_000_000, embedding: [1, 1], adapterConfidence: 0.9 }
      ],
      threshold: 0.6
    })
    expect(record.turns[0]).toMatchObject({ speakerId: 'speaker-alice', uncertain: false })
    expect(record.turns[1]).toMatchObject({ uncertain: true, reason: 'ambiguous' })
    expect(record.turns[1]).not.toHaveProperty('speakerId')

    const project = makeProject()
    project.captions[0]!.sourceSegmentIds = ['segment-1', 'segment-2']
    project.sequences[0]!.captions = structuredClone(project.captions)
    const plan = buildSpeakerAttributionPlan(project, record)
    expect(plan.transcriptSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ segmentId: 'segment-1', speakerId: 'speaker-alice', uncertain: false }),
      expect.objectContaining({ segmentId: 'segment-2', uncertain: true })
    ]))
    expect(plan.captions[0]).toMatchObject({ captionId: 'caption-1', uncertain: true })
    expect(plan.warnings.length).toBeGreaterThan(0)
  })

  it('publishes cached beat/downbeat markers as timeline snap and Agent-readable evidence', () => {
    const project = makeProject()
    const record = analyzeBeatEvidence({
      assetId: 'asset-1', sourceFingerprint: fingerprint, tempoBpm: 120,
      observations: [
        { id: 'onset-1', timeUs: 500_000, strength: 0.9, beatProbability: 0.92, downbeatProbability: 0.95 },
        { id: 'onset-2', timeUs: 1_000_000, strength: 0.8, beatProbability: 0.9, downbeatProbability: 0.1 },
        { id: 'onset-noise', timeUs: 1_500_000, strength: 0.2, beatProbability: 0.1 }
      ],
      now: () => new Date('2026-01-01T00:00:00.000Z')
    })
    expect(record.markers).toMatchObject([
      { kind: 'downbeat', sourceUs: 500_000 },
      { kind: 'beat', sourceUs: 1_000_000 }
    ])
    expect(beatSnapTargets(project, record)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-1', frame: 15, kind: 'downbeat' }),
      expect.objectContaining({ itemId: 'item-1', frame: 30, kind: 'beat' })
    ]))
    expect(beatEvidenceWindow(record, 0, 1)).toMatchObject({
      total: 2, nextOffset: 1, markers: [{ kind: 'downbeat' }],
      provenance: { local: true, networkUsed: false }
    })
    expect(readMediaIntelligenceEvidence(record, { limit: 1 })).toMatchObject({
      kind: 'beat-grid',
      returned: 1,
      total: 2,
      nextOffset: 1,
      evidence: [{ markerKind: 'downbeat', sourceUs: 500_000, confidence: 0.95 }]
    })
  })

  it('uses seeded correlation, previews one move, applies transactionally, and refuses uncertainty', () => {
    const project = makeProject()
    project.assets.push({
      id: 'asset-audio', name: 'Target.wav', kind: 'audio', mediaHandleId: 'media_audio_sync_0001',
      durationUs: 3_000_000, container: 'wav', audio: { codec: 'pcm', sampleRate: 48_000, channels: 1 }, transcriptIds: []
    })
    project.items.push({
      ...makeItem('item-audio', 30, 0, 2_000_000, 'audio-1'), assetId: 'asset-audio', durationFrames: 60
    })
    project.sequences[0]!.items = structuredClone(project.items)
    const reference = [0.2, 0.8, 0.1, 0.5, 0.9, 0.3, 0.7, 0.05, 0.6, 0.4, 0.85, 0.15, 0.55, 0.25, 0.95, 0.35]
    const target = [0, 0, ...reference]
    const analysis = analyzeAudioSynchronization({
      referenceAssetId: 'asset-1', targetAssetId: 'asset-audio',
      referenceFeatures: reference, targetFeatures: target,
      samplePeriodUs: 100_000, maximumOffsetUs: 500_000, seed: 42,
      threshold: 0.9, minimumSeparation: 0.01,
      referenceFingerprint: fingerprint,
      targetFingerprint: { algorithm: 'sha256', value: 'b'.repeat(64) }
    })
    expect(analysis).toMatchObject({
      outcome: 'ready',
      proposedTargetDeltaUs: -200_000,
      seed: 42
    })
    expect(analysis.id).toBe(`analysis:sync:${analysis.provenance.cacheKey}`)
    const plan = planAudioSynchronization(project, 'item-1', 'item-audio', analysis)
    expect(plan).toMatchObject({
      expectedRevision: 0,
      targetFrameBefore: 30,
      targetFrameAfter: 24,
      deltaFrames: -6,
      operation: { type: 'move-item', itemId: 'item-audio', timelineStartFrame: 24 }
    })
    const applied = applyAudioSynchronizationPlan(project, plan)
    expect(applied.project.items.find(({ id }) => id === 'item-audio')?.timelineStartFrame).toBe(24)
    expect(project.items.find(({ id }) => id === 'item-audio')?.timelineStartFrame).toBe(30)

    const uncertain = analyzeAudioSynchronization({
      referenceAssetId: 'asset-1', targetAssetId: 'asset-audio',
      referenceFeatures: Array(16).fill(1), targetFeatures: Array(18).fill(1),
      samplePeriodUs: 100_000, maximumOffsetUs: 500_000, seed: 42,
      threshold: 0.9, minimumSeparation: 0.03,
      referenceFingerprint: fingerprint,
      targetFingerprint: { algorithm: 'sha256', value: 'b'.repeat(64) }
    })
    expect(uncertain).toMatchObject({ outcome: 'uncertain', refusalReason: 'ambiguous-correlation' })
    const refused = planAudioSynchronization(project, 'item-1', 'item-audio', uncertain)
    expect(refused).not.toHaveProperty('operation')
    expect(() => applyAudioSynchronizationPlan(project, refused)).toThrowError(/uncertain/u)
    expect(readMediaIntelligenceEvidence(uncertain)).toMatchObject({
      kind: 'audio-sync',
      evidence: [{ outcome: 'uncertain', refusalReason: 'ambiguous-correlation', seed: 42 }]
    })
  })
})
