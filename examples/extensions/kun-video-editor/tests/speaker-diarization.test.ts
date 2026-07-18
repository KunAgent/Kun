import { describe, expect, it } from 'vitest'
import {
  SpeakerIdentityRegistry,
  applySpeakerAttributionPlan,
  buildSpeakerAttributionPlan,
  defaultSpeakerDiarizationAdapterRegistry,
  importSpeakerDiarizationEvidence,
  VideoProjectSchema
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

const fingerprint = { algorithm: 'sha256' as const, value: 'a'.repeat(64) }
const now = () => new Date('2026-07-14T00:00:00.000Z')

function identities(): SpeakerIdentityRegistry {
  return new SpeakerIdentityRegistry([
    {
      id: 'speaker-alice',
      label: 'Alice',
      aliases: ['Host'],
      sourceEvidenceIds: ['enrollment-alice'],
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    },
    {
      id: 'speaker-bob',
      label: 'Bob',
      aliases: [],
      sourceEvidenceIds: ['enrollment-bob'],
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    }
  ])
}

describe('provider-neutral speaker diarization', () => {
  it('registers an honest import adapter and an actionable unavailable local model', () => {
    const adapters = defaultSpeakerDiarizationAdapterRegistry({
      localDescriptor: {
        adapterId: 'kun.local.pyannote',
        adapterVersion: '1.0.0',
        modelId: 'speaker-diarization',
        modelVersion: '3.1.0',
        embeddingDimensions: 512
      },
      localInstallationVerified: false,
      localInferenceBrokerAvailable: false
    }).list()
    expect(adapters).toEqual([
      expect.objectContaining({
        descriptor: { id: 'kun.imported-speaker-labels', execution: 'import', format: 'kun-speaker-json-v1', version: '1.0.0' },
        outcome: 'ready',
        local: true,
        networkUsed: false
      }),
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: 'kun.local.pyannote', execution: 'local-model' }),
        outcome: 'unavailable',
        code: 'speaker_model_unverified',
        local: true,
        networkUsed: false
      })
    ])
  })

  it('normalizes imported identities and preserves unknown, overlap, and weak evidence without asserting a speaker', () => {
    const adapter = defaultSpeakerDiarizationAdapterRegistry().requireReady('kun.imported-speaker-labels')
    const record = importSpeakerDiarizationEvidence({
      assetId: 'asset-1',
      sourceFingerprint: fingerprint,
      adapter,
      identities: identities(),
      confidenceThreshold: 0.7,
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: 'speaker-alice', confidence: 0.98 },
        { id: 'turn-weak', startUs: 1_000_000, endUs: 2_000_000, status: 'identified', speakerId: 'speaker-bob', confidence: 0.4 },
        { id: 'turn-overlap', startUs: 2_000_000, endUs: 3_000_000, status: 'overlap', overlapSpeakerIds: ['speaker-alice', 'speaker-bob'], confidence: 0.9 },
        { id: 'turn-unknown', startUs: 3_000_000, endUs: 4_000_000, status: 'unknown', confidence: 0.8 }
      ],
      now
    })
    expect(record).toMatchObject({
      kind: 'speaker-diarization',
      uncertainTurnCount: 3,
      provenance: {
        adapterId: 'kun.imported-speaker-labels',
        execution: 'import',
        local: true,
        networkUsed: false,
        sourceFingerprint: fingerprint
      }
    })
    expect(record.turns).toEqual([
      expect.objectContaining({ status: 'identified', speakerId: 'speaker-alice', speakerLabel: 'Alice', uncertain: false }),
      expect.objectContaining({ status: 'uncertain', reason: 'import-low-confidence', uncertain: true }),
      expect.objectContaining({ status: 'overlap', reason: 'overlap', uncertain: true, overlapSpeakerIds: ['speaker-alice', 'speaker-bob'] }),
      expect.objectContaining({ status: 'unknown', reason: 'unknown-speaker', uncertain: true })
    ])
    expect(record.turns.slice(1).every((turn) => turn.speakerId === undefined)).toBe(true)
    expect(Object.isFrozen(record)).toBe(true)
  })

  it('persists revision-fenced transcript and caption attribution while downgrading uncertainty', () => {
    const project = makeProject()
    project.assets[0]!.sourceIdentity = fingerprint
    project.captions[0]!.sourceTranscriptId = 'transcript-1'
    project.captions[0]!.sourceSegmentIds = ['segment-1', 'segment-2']
    project.sequences[0]!.captions = structuredClone(project.captions)
    const record = importSpeakerDiarizationEvidence({
      assetId: 'asset-1',
      sourceFingerprint: fingerprint,
      adapter: defaultSpeakerDiarizationAdapterRegistry().requireReady('kun.imported-speaker-labels'),
      identities: identities(),
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: 'speaker-alice', confidence: 0.98 },
        { id: 'turn-unknown', startUs: 1_000_000, endUs: 2_000_000, status: 'unknown', confidence: 0.9 }
      ],
      now
    })
    const plan = buildSpeakerAttributionPlan(project, record)
    expect(plan.transcriptSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ segmentId: 'segment-1', status: 'identified', speakerLabel: 'Alice' }),
      expect.objectContaining({ segmentId: 'segment-2', status: 'unknown', uncertain: true })
    ]))
    expect(plan.captions[0]).toMatchObject({ status: 'unknown', uncertain: true })
    const applied = applySpeakerAttributionPlan(project, plan)
    expect(applied).toMatchObject({
      attributedTranscriptSegmentCount: 2,
      attributedCaptionCount: 1,
      identifiedCount: 1,
      uncertainCount: 2
    })
    expect(applied.project.transcripts[0]!.segments[0]!.speakerAttribution).toMatchObject({
      analysisId: record.id,
      status: 'identified',
      speakerId: 'speaker-alice',
      speakerLabel: 'Alice'
    })
    expect(applied.project.transcripts[0]!.segments[1]!.speakerAttribution).toMatchObject({
      analysisId: record.id,
      status: 'unknown'
    })
    expect(applied.project.transcripts[0]!.segments[1]!.speakerAttribution).not.toHaveProperty('speakerId')
    expect(applied.project.captions[0]!.speakerAttribution).toMatchObject({ status: 'unknown' })
    expect(applied.project.sequences[0]!.captions[0]!.speakerAttribution).toEqual(
      applied.project.captions[0]!.speakerAttribution
    )
    expect(() => VideoProjectSchema.parse(applied.project)).not.toThrow()
    expect(project.transcripts[0]!.segments[0]!.speakerAttribution).toBeUndefined()
    expect(() => applySpeakerAttributionPlan({ ...project, currentRevision: 1 }, plan)).toThrowError(/stale/u)
  })

  it('rejects unregistered identities and malformed overlap evidence', () => {
    const adapter = defaultSpeakerDiarizationAdapterRegistry().requireReady('kun.imported-speaker-labels')
    expect(() => importSpeakerDiarizationEvidence({
      assetId: 'asset-1', sourceFingerprint: fingerprint, adapter, identities: identities(),
      turns: [{ id: 'turn-impostor', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: 'speaker-mallory', confidence: 1 }]
    })).toThrowError(/not registered/u)
    expect(() => importSpeakerDiarizationEvidence({
      assetId: 'asset-1', sourceFingerprint: fingerprint, adapter, identities: identities(),
      turns: [{ id: 'turn-overlap', startUs: 0, endUs: 1_000_000, status: 'overlap', overlapSpeakerIds: ['speaker-alice'], confidence: 1 }]
    })).toThrowError(/2 through 8/u)
  })

  it('scopes caption attribution to its source transcript when segment IDs repeat', () => {
    const project = makeProject()
    project.transcripts.push({
      id: 'transcript-2',
      assetId: 'asset-1',
      language: 'en',
      provenance: 'json',
      segments: [
        { id: 'segment-1', startUs: 2_000_000, endUs: 3_000_000, text: 'Second transcript' },
        { id: 'segment-shadowed', startUs: 2_000_000, endUs: 3_000_000, text: 'Attributed duplicate' }
      ]
    })
    project.transcripts[0]!.segments.push({
      id: 'segment-shadowed', startUs: 4_000_000, endUs: 5_000_000, text: 'Duplicate without evidence'
    })
    project.assets[0]!.transcriptIds = ['transcript-1', 'transcript-2']
    project.captions = [
      {
        ...project.captions[0]!,
        id: 'caption-first',
        sourceTranscriptId: 'transcript-1',
        sourceSegmentIds: ['segment-1']
      },
      {
        ...project.captions[0]!,
        id: 'caption-second',
        sourceTranscriptId: 'transcript-2',
        sourceSegmentIds: ['segment-1']
      },
      {
        ...project.captions[0]!,
        id: 'caption-ambiguous',
        sourceSegmentIds: ['segment-1']
      },
      {
        ...project.captions[0]!,
        id: 'caption-shadowed',
        sourceSegmentIds: ['segment-shadowed']
      }
    ]
    const record = importSpeakerDiarizationEvidence({
      assetId: 'asset-1',
      sourceFingerprint: fingerprint,
      adapter: defaultSpeakerDiarizationAdapterRegistry().requireReady('kun.imported-speaker-labels'),
      identities: identities(),
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: 'speaker-alice', confidence: 0.98 },
        { id: 'turn-bob', startUs: 2_000_000, endUs: 3_000_000, status: 'identified', speakerId: 'speaker-bob', confidence: 0.97 }
      ],
      now
    })

    const plan = buildSpeakerAttributionPlan(project, record)
    expect(plan.captions).toEqual(expect.arrayContaining([
      expect.objectContaining({ captionId: 'caption-first', speakerId: 'speaker-alice', speakerLabel: 'Alice' }),
      expect.objectContaining({ captionId: 'caption-second', speakerId: 'speaker-bob', speakerLabel: 'Bob' })
    ]))
    expect(plan.captions.some(({ captionId }) => captionId === 'caption-ambiguous')).toBe(false)
    expect(plan.captions.some(({ captionId }) => captionId === 'caption-shadowed')).toBe(false)
    expect(plan.warnings).toContain(
      'Caption caption-ambiguous references ambiguous segment segment-1; sourceTranscriptId is required.'
    )
    expect(plan.warnings).toContain(
      'Caption caption-shadowed references ambiguous segment segment-shadowed; sourceTranscriptId is required.'
    )
  })
})
